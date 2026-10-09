import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "../lib/portal/db";
import { localMode } from "../lib/portal/adapters";
import { reconcile, settle } from "../lib/payments/processing";
import { deliver } from "../lib/payments/delivery";
import { minor } from "../lib/payments/contracts";
import { isTestnet, transactionExplorer } from "../lib/blockchain/chains";
import { onchainMethod } from "../lib/blockchain/crypto-assets";
export async function verifyTestnetPayment(intentId: string, verify = false) {
  if (
    !localMode() ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")
  )
    throw new Error("Isolated local testnet database required");
  const initial = await db.paymentIntent.findUniqueOrThrow({
    where: { id: intentId },
  });
  const org = await db.organization.findUniqueOrThrow({
    where: { id: initial.orgId },
  });
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId: initial.orgId },
  });
  const asset = initial.asset as { network: string };
  if (
    initial.orgId !== "payment-demo-merchant" ||
    !org.fictional ||
    initial.environment !== "sandbox" ||
    config.environment !== "sandbox" ||
    config.webhookUrl !== "local://payment-receiver" ||
    !isTestnet(asset.network)
  )
    throw new Error(
      "Only the fictional testnet merchant and fixed loopback webhook receiver may be verified",
    );
  const attempt = await db.paymentAttempt.findFirst({
    where: { intentId },
    orderBy: { number: "desc" },
  });
  if (!attempt) {
    console.log(
      JSON.stringify({
        state: initial.state,
        network: asset.network,
        awaiting: "Customer choice and payment",
      }),
    );
    return;
  }
  await reconcile(attempt.id);
  const result = await db.paymentIntent.findUniqueOrThrow({
    where: { id: intentId },
  });
  const current = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  const claim = await db.depositClaim.findUnique({
    where: { attemptId: attempt.id },
  });
  if (verify) {
    assert.equal(result.state, "Confirmed");
    assert.equal(current.state, "Confirmed");
    const paymentAsset = result.asset as {
      network: string;
      identifier: string;
    };
    assert.equal(
      result.selectedMethod,
      onchainMethod(paymentAsset.network, paymentAsset.identifier),
    );
    assert.ok(claim);
    assert.equal(
      minor(claim.amount, result.precision),
      minor(result.amount, result.precision),
    );
    await settle(attempt.id);
    await reconcile(attempt.id);
    const allocations = await db.settlementAllocation.findMany({
      where: { intentId },
      include: { settlement: true },
    });
    assert.equal(allocations.length, 1);
    const settlement = allocations[0].settlement;
    assert.equal(settlement.state, "Completed");
    assert.equal(
      settlement.gross,
      minor(result.amount, result.precision).toString(),
    );
    assert.equal(settlement.net, settlement.gross);
    assert.equal(settlement.fee, "0");
    assert.equal(
      await db.depositClaim.count({ where: { attemptId: attempt.id } }),
      1,
    );
    const match = await db.paymentReconciliation.findFirst({
      where: { intentId },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(match?.result, "Exact match");
    const fee = await db.paymentFee.findUniqueOrThrow({ where: { intentId } });
    assert.equal(fee.amountMinor.toFixed(0), "0");
    assert.equal(fee.billable, false);
    const entries = await db.journalEntry.findMany({
      where: {
        source: {
          in: [
            `payment:${intentId}`,
            `settlement:${settlement.id}:${intentId}`,
            `settlement-detail:${settlement.id}:${intentId}`,
          ],
        },
      },
      include: { postings: true },
    });
    assert.equal(entries.length, 3);
    for (const entry of entries)
      assert.equal(
        entry.postings.reduce(
          (n, p) =>
            n + BigInt(p.debit.toFixed(0)) - BigInt(p.credit.toFixed(0)),
          0n,
        ),
        0n,
      );
    const events = await db.merchantEvent.findMany({
      where: {
        intentId,
        type: { in: ["payment.confirmed", "settlement.completed"] },
      },
    });
    assert.equal(events.length, 2);
    for (const event of events) {
      await deliver(event.id);
      assert.equal(
        (
          await db.merchantDelivery.findUniqueOrThrow({
            where: { eventId: event.id },
          })
        ).state,
        "Delivered",
      );
    }
    console.log(
      "Verified: finalized exact transfer, one claim and settlement, idempotent replay, balanced journals, zero sandbox fee, signed loopback webhooks.",
    );
  }
  const allocations = await db.settlementAllocation.findMany({
    where: { intentId },
    include: { settlement: true },
  });
  const match = await db.paymentReconciliation.findFirst({
    where: { intentId },
    orderBy: { createdAt: "desc" },
  });
  console.log(
    JSON.stringify(
      {
        state: result.state,
        attemptState: current.state,
        network: asset.network,
        settlement: allocations.map((a) => a.settlement.state),
        reconciliation: match?.result,
        transaction: claim?.txHash,
        explorer: claim
          ? transactionExplorer(asset.network, claim.txHash)
          : null,
      },
      null,
      2,
    ),
  );
}
