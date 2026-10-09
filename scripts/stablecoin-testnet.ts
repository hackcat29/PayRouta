import "dotenv/config";
import assert from "node:assert/strict";
import { deliver } from "../lib/payments/delivery";
import { settle } from "../lib/payments/processing";
import { createECDH, randomUUID } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { db } from "../lib/portal/db";
import { localMode, secretManager } from "../lib/portal/adapters";
import { json } from "../lib/portal/service";
import {
  createIntent,
  createSession,
  methods,
  selectMethod,
  confirm,
  progress,
} from "../lib/payments/service";
import { dispatch, reconcile } from "../lib/payments/processing";
const file = ".local/portal/stablecoin-testnet.json";
async function main() {
  if (
    !localMode() ||
    !["127.0.0.1", "localhost"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    )
  )
    throw new Error("Local testnet fixture only");
  if (process.argv.includes("--observe") || process.argv.includes("--verify")) {
    const fixture = JSON.parse(await readFile(file, "utf8"));
    await reconcile(fixture.attemptId);
    const result = await db.paymentIntent.findUniqueOrThrow({
      where: { id: fixture.intentId },
    });
    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: fixture.attemptId },
    });
    const allocations = await db.settlementAllocation.findMany({
      where: { intentId: fixture.intentId },
      include: { settlement: true },
    });
    const claim = await db.depositClaim.findUnique({
      where: { attemptId: fixture.attemptId },
    });
    const match = await db.paymentReconciliation.findFirst({
      where: { intentId: fixture.intentId },
      orderBy: { createdAt: "desc" },
    });
    if (process.argv.includes("--verify")) {
      // Verification may notify only the fixed loopback fictional receiver.
      const config = await db.merchantConfig.findUniqueOrThrow({
        where: { orgId: result.orgId },
      });
      const org = await db.organization.findUniqueOrThrow({
        where: { id: result.orgId },
      });
      if (
        result.orgId !== "payment-demo-merchant" ||
        !org.fictional ||
        config.environment !== "sandbox" ||
        config.webhookUrl !== "local://payment-receiver"
      )
        throw new Error(
          "Verification requires the fixed local fictional receiver; external delivery is prohibited",
        );
      assert.equal(result.state, "Confirmed");
      assert.equal(attempt.state, "Confirmed");
      assert.equal(result.environment, "sandbox");
      assert.equal(result.selectedMethod, "stablecoin");
      assert.equal(result.amount, "1.000000");
      assert.ok(claim);
      assert.equal(claim.amount, "1.000000");
      assert.equal(allocations.length, 1);
      assert.equal(allocations[0].settlement.gross, "1000000");
      assert.equal(allocations[0].settlement.net, "1000000");
      assert.equal(allocations[0].settlement.fee, "0");
      assert.equal(match?.result, "Exact match");
      await settle(fixture.attemptId);
      await reconcile(fixture.attemptId);
      assert.equal(
        await db.settlementAllocation.count({
          where: { intentId: fixture.intentId },
        }),
        1,
      );
      assert.equal(
        await db.depositClaim.count({
          where: { attemptId: fixture.attemptId },
        }),
        1,
      );
      const fee = await db.paymentFee.findUniqueOrThrow({
        where: { intentId: fixture.intentId },
      });
      assert.equal(fee.amountMinor.toFixed(0), "0");
      assert.equal(fee.billable, false);
      const entries = await db.journalEntry.findMany({
        where: {
          source: {
            in: [
              `payment:${fixture.intentId}`,
              `settlement:${allocations[0].settlementId}:${fixture.intentId}`,
              `settlement-detail:${allocations[0].settlementId}:${fixture.intentId}`,
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
          intentId: fixture.intentId,
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
        "Verified: finalized transfer, one claim/settlement, idempotent replay, balanced journals, zero sandbox fee and signed loopback webhook delivery.",
      );
    }
    console.log(
      JSON.stringify(
        {
          state: result.state,
          attemptState: attempt.state,
          settlement: allocations.map((a) => a.settlement.state),
          reconciliation: match?.result,
          transaction: claim?.txHash,
          explorer: claim
            ? `https://sepolia.basescan.org/tx/${claim.txHash}`
            : null,
        },
        null,
        2,
      ),
    );
    return;
  }
  const orgId = "payment-demo-merchant",
    config = await db.merchantConfig.findUniqueOrThrow({ where: { orgId } });
  if (config.environment !== "sandbox")
    throw new Error("Sandbox merchant required");
  const wallet = createECDH("secp256k1");
  wallet.generateKeys();
  const address =
    "0x" +
    Buffer.from(keccak_256(wallet.getPublicKey().subarray(1)))
      .subarray(12)
      .toString("hex");
  // Testnet receive-wallet recovery material goes only to the encrypted local vault.
  const recoveryRef = await secretManager.put(
    wallet.getPrivateKey().toString("hex"),
  );
  const asset = {
    kind: "blockchain",
    network: "eip155:84532",
    identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  };
  const latest = await db.integration.findFirst({
    where: { orgId, environment: "sandbox" },
    orderBy: { version: "desc" },
  });
  const integration = await db.integration.create({
    data: {
      orgId,
      environment: "sandbox",
      version: (latest?.version || 0) + 1,
      config: json({
        mode: "NATIVE",
        adapter: "erc20-deposit",
        environment: "sandbox",
        network: asset.network,
        identifier: asset.identifier,
        addresses: [address],
        logBlockRange: 1000,
        publicTestnetRpc: true,
        accountId: `test-wallet-${address}`,
      }),
    },
  });
  const intent = await createIntent(orgId, `testnet-${randomUUID()}`, {
    reference: `Base Sepolia test ${new Date().toISOString()}`,
    amount: "1.000000",
    asset,
    precision: 6,
    methods: ["stablecoin"],
    settlement: asset,
    returnUrl: config.returnOrigin + "/merchant/payments?orgId=" + orgId,
    metadata: { test: "real-chain-mvp" },
  });
  const session = await createSession(orgId, intent.id);
  await methods(session.sessionId, session.token);
  const route = await selectMethod(
    session.sessionId,
    session.token,
    "stablecoin",
  );
  const attempt = await confirm(
    session.sessionId,
    session.token,
    route.routeId,
  );
  await mkdir(".local/portal", { recursive: true, mode: 0o700 });
  await writeFile(
    file,
    JSON.stringify(
      {
        intentId: intent.id,
        attemptId: attempt.attemptId,
        integrationId: integration.id,
        sessionId: session.sessionId,
        token: session.token,
        address,
        recoveryRef,
        checkout: config.returnOrigin + session.checkoutPath,
        expiresAt: intent.expiresAt.toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await dispatch(attempt.attemptId);
  const p = await progress(session.sessionId, session.token);
  if (p.attemptState !== "Requires action")
    throw new Error(`Instructions not ready: ${p.attemptState}`);
  await mkdir(".local/portal", { recursive: true, mode: 0o700 });
  const checkout = config.returnOrigin + session.checkoutPath;
  await writeFile(
    file,
    JSON.stringify(
      {
        intentId: intent.id,
        attemptId: attempt.attemptId,
        integrationId: integration.id,
        sessionId: session.sessionId,
        token: session.token,
        address,
        recoveryRef,
        checkout,
        expiresAt: p.expiresAt,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    JSON.stringify(
      {
        checkout,
        amount: "1.000000 test USDC",
        network: "Base Sepolia (84532)",
        address,
        contract: asset.identifier.slice(6),
        expiresAt: p.expiresAt,
      },
      null,
      2,
    ),
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
