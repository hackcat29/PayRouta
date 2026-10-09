// Money movements for payments taken through a platform account
// (docs/AGGREGATOR.md §4).
//
//   confirmed         funds-clearing → merchant-pending (net) + fee-collected
//   provider releases merchant-pending → merchant-available + merchant-reserve
//                     (less any processing fee the merchant bears)
//   split settlement  merchant-available → funds-clearing (the provider paid
//                     the merchant's bank directly)
//   reserve due       merchant-reserve → merchant-available
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { atomic } from "../portal/service";
import { assetKey, minor } from "../payments/contracts";
import { exception, type Posting } from "../payments/journal";
import { queue, type Tx } from "../payments/service";
import type { PaymentAttempt, PaymentIntent } from "../generated/prisma/client";
import { platformBalance, postFunds, recoverReceivable } from "./ledger";
import { accrueFee } from "../payments/billing";
import { merchantTerms } from "./terms";
import { withheldFee } from "./execution";
import { platformAdapter, platformModule } from "./platforms/registry";

const lines = (...l: Posting[]) =>
  l.filter((p) => BigInt(p.debit) > 0n || BigInt(p.credit) > 0n);

// Called inside applyFact's transaction when a platform payment confirms.
export async function recordPlatformPayment(
  tx: Tx,
  attempt: PaymentAttempt,
  intent: PaymentIntent,
  binding: { platformAccountId: string; linkId: string },
  reference: string,
  now: Date,
) {
  const platform = await tx.platformAccount.findUniqueOrThrow({ where: { id: binding.platformAccountId } });
  const { feeCollection } = platformModule(platform.provider).manifest;
  await accrueFee(tx, intent, now, feeCollection);
  const gross = minor(intent.amount, intent.precision);
  const fee = feeCollection === "withheld" ? withheldFee(intent) : 0n;
  const asset = assetKey(intent.asset as { kind: string; identifier: string; network: string });
  await postFunds(
    tx,
    {
      orgId: intent.orgId,
      environment: intent.environment,
      platformAccountId: binding.platformAccountId,
      source: `payment:${intent.id}`,
      asset,
      purpose: "Provider confirms payment into the merchant's sub-account; PayRouta fee withheld",
      effectiveAt: now,
    },
    lines(
      { account: "funds-clearing", debit: gross.toString(), credit: "0" },
      { account: "merchant-pending", debit: "0", credit: (gross - fee).toString() },
      { account: "fee-collected", debit: "0", credit: fee.toString() },
    ),
  );
  await tx.platformPayment.upsert({
    where: { attemptId: attempt.id },
    create: {
      attemptId: attempt.id,
      intentId: intent.id,
      orgId: intent.orgId,
      environment: intent.environment,
      platformAccountId: binding.platformAccountId,
      linkId: binding.linkId,
      asset,
      reference,
      grossMinor: gross.toString(),
      feeMinor: fee.toString(),
    },
    update: {},
  });
  await queue(tx, intent.orgId, "treasury-availability", `treasury-availability:${attempt.id}`, {
    attemptId: attempt.id,
  });
}

async function later(tx: Tx | typeof db, orgId: string, kind: string, attemptId: string, at: Date) {
  await queue(tx as Tx, orgId, kind, `${kind}:${attemptId}:${at.getTime()}`, { attemptId }, at);
}

// Moves the merchant's share from pending to available once the provider
// has transferred it and its availability date has passed, holding back the
// merchant's rolling reserve.
export async function recordAvailability(attemptId: string, now = new Date()) {
  let p = await db.platformPayment.findUniqueOrThrow({
    where: { attemptId },
    include: { platformAccount: true, link: true },
  });
  if (p.state !== "Pending") return;
  const manifest = platformModule(p.platformAccount.provider).manifest;
  if (!p.availableAt) {
    const funds = await platformAdapter(p.platformAccount).fundsAvailability({
      reference: p.reference,
      providerAccountId: p.link.providerAccountId!,
      feeMinor: BigInt(p.feeMinor.toFixed(0)),
    });
    if (!funds) throw new PortalError("PLATFORM_FUNDS_NOT_YET_TRANSFERRED", 503);
    const expected = BigInt(p.grossMinor.toFixed(0)) - BigInt(p.feeMinor.toFixed(0));
    // Only a provider whose processing fee comes out of the merchant's share
    // may deliver less than PayRouta booked, and never nothing or more.
    const processing = expected - funds.netMinor;
    const acceptable =
      processing === 0n ||
      (manifest.merchantBearsProcessingFee && processing > 0n && funds.netMinor > 0n);
    if (!acceptable) {
      // The provider moved a different amount than PayRouta booked: stop and
      // leave it for reconciliation rather than guessing.
      await atomic((tx) =>
        exception(tx, p.intentId, "PLATFORM_NET_MISMATCH", {
          expected: expected.toString(),
          provider: funds.netMinor.toString(),
          paymentRef: funds.paymentRef,
          transferRef: funds.transferRef ?? null,
        }, now),
      );
      return;
    }
    p = await db.platformPayment.update({
      where: { attemptId },
      data: {
        providerPaymentRef: funds.paymentRef,
        providerTransferRef: funds.transferRef ?? null,
        availableAt: funds.availableAt,
        providerFeeMinor: processing.toString(),
      },
      include: { platformAccount: true, link: true },
    });
  }
  const availableAt = p.availableAt!;
  if (availableAt > now) return later(db, p.orgId, "treasury-availability", attemptId, availableAt);
  await atomic(async (tx) => {
    const current = await tx.platformPayment.findUniqueOrThrow({ where: { attemptId } });
    if (current.state !== "Pending") return;
    const account = await tx.merchantAccount.findUniqueOrThrow({
      where: { orgId_environment: { orgId: p.orgId, environment: p.environment } },
    });
    const terms = merchantTerms.parse(account.terms);
    const booked = BigInt(p.grossMinor.toFixed(0)) - BigInt(p.feeMinor.toFixed(0));
    const processing = BigInt(p.providerFeeMinor.toFixed(0));
    const net = booked - processing;
    // Split settlement leaves nothing to hold back (the live gate requires a
    // zero reserve for those rails).
    const reserve = manifest.holdsFunds ? (net * BigInt(terms.reserve.basisPoints)) / 10000n : 0n;
    await postFunds(
      tx,
      {
        orgId: p.orgId,
        environment: p.environment,
        platformAccountId: p.platformAccountId,
        source: `available:${attemptId}`,
        asset: p.asset,
        purpose: "Provider funds available in the merchant's sub-account; rolling reserve held",
        effectiveAt: now,
      },
      lines(
        { account: "merchant-pending", debit: booked.toString(), credit: "0" },
        { account: "funds-clearing", debit: "0", credit: processing.toString() },
        { account: "merchant-available", debit: "0", credit: (net - reserve).toString() },
        { account: "merchant-reserve", debit: "0", credit: reserve.toString() },
      ),
    );
    if (!manifest.holdsFunds)
      await postFunds(
        tx,
        {
          orgId: p.orgId,
          environment: p.environment,
          platformAccountId: p.platformAccountId,
          source: `settled-direct:${attemptId}`,
          asset: p.asset,
          purpose: "Provider settles the merchant's share directly to the merchant's bank",
          effectiveAt: now,
        },
        [
          { account: "merchant-available", debit: net.toString(), credit: "0" },
          { account: "funds-clearing", debit: "0", credit: net.toString() },
        ],
      );
    const releaseAt = new Date(availableAt.getTime() + terms.reserve.holdDays * 86400000);
    await tx.platformPayment.update({
      where: { attemptId },
      data: {
        reserveMinor: reserve.toString(),
        state: reserve > 0n ? "Available" : "Released",
        reserveReleaseAt: reserve > 0n ? releaseAt : null,
        settledDirectly: !manifest.holdsFunds,
      },
    });
    if (reserve > 0n) await later(tx, p.orgId, "treasury-reserve-release", attemptId, releaseAt);
    // Newly available funds first repay anything the merchant owes.
    if (manifest.holdsFunds)
      await recoverReceivable(tx, {
        orgId: p.orgId,
        environment: p.environment,
        platformAccountId: p.platformAccountId,
        asset: p.asset,
        now,
      });
  });
}

export async function releaseReserve(attemptId: string, now = new Date()) {
  const p = await db.platformPayment.findUniqueOrThrow({ where: { attemptId } });
  if (p.state !== "Available") return;
  if (p.reserveReleaseAt! > now)
    return later(db, p.orgId, "treasury-reserve-release", attemptId, p.reserveReleaseAt!);
  await atomic(async (tx) => {
    const current = await tx.platformPayment.findUniqueOrThrow({ where: { attemptId } });
    if (current.state !== "Available") return;
    // A dispute may already have used part of the reserve at this platform.
    const held = await platformBalance(tx, {
      orgId: p.orgId,
      environment: p.environment,
      platformAccountId: p.platformAccountId,
      asset: p.asset,
      account: "merchant-reserve",
    });
    const due = BigInt(current.reserveMinor!.toFixed(0));
    const reserve = (due < held ? due : held > 0n ? held : 0n).toString();
    if (reserve === "0") {
      await tx.platformPayment.update({ where: { attemptId }, data: { state: "Released" } });
      return;
    }
    await postFunds(
      tx,
      {
        orgId: p.orgId,
        environment: p.environment,
        platformAccountId: p.platformAccountId,
        source: `reserve-release:${attemptId}`,
        asset: p.asset,
        purpose: "Rolling reserve released to the merchant's available balance",
        effectiveAt: now,
      },
      [
        { account: "merchant-reserve", debit: reserve, credit: "0" },
        { account: "merchant-available", debit: "0", credit: reserve },
      ],
    );
    await tx.platformPayment.update({ where: { attemptId }, data: { state: "Released" } });
    await recoverReceivable(tx, { ...p, now });
  });
}
