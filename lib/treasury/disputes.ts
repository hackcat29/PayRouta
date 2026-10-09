// Disputes (chargebacks) on payments taken through a platform account.
//
//   opened  merchant-available, then merchant-reserve, then
//           merchant-receivable (owed) → merchant-dispute-hold;
//           the provider's dispute fee: available / receivable → funds-clearing
//   won     merchant-dispute-hold → merchant-available
//   lost    merchant-dispute-hold → funds-clearing (the cardholder keeps it)
//
// Disputes are only ever created or changed from the provider's own
// dispute record (disputeStatus), never from a webhook payload.
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { z } from "zod";
import { atomic, audit, json } from "../portal/service";
import type { Tx } from "../payments/service";
import type { Posting } from "../payments/journal";
import { platformBalance, postFunds, recoverReceivable } from "./ledger";
import { platformAdapter } from "./platforms/registry";
import type { DisputeSnapshot } from "./platforms/contract";

const nonzero = (l: Posting[]) => l.filter((p) => p.debit !== "0" || p.credit !== "0");
const take = (want: bigint, have: bigint) => (have <= 0n ? 0n : want < have ? want : have);

// Records or advances a dispute from the provider's snapshot. Idempotent:
// replays of the same state change nothing.
export async function applyDispute(platformAccountId: string, snapshot: DisputeSnapshot, now = new Date()) {
  return atomic(async (tx) => {
    const existing = await tx.platformDispute.findUnique({
      where: { platformAccountId_providerDisputeRef: { platformAccountId, providerDisputeRef: snapshot.reference } },
    });
    const dispute = existing ?? (await open(tx, platformAccountId, snapshot, now));
    if (!dispute || dispute.state !== "Open" || snapshot.state === "Open") return dispute;
    const base = {
      orgId: dispute.orgId,
      environment: dispute.environment,
      platformAccountId,
      asset: dispute.asset,
      effectiveAt: now,
    };
    const amount = dispute.amountMinor.toFixed(0);
    await postFunds(
      tx,
      {
        ...base,
        source: `dispute-${snapshot.state.toLowerCase()}:${dispute.id}`,
        purpose: snapshot.state === "Won" ? "Dispute won: held funds returned to the merchant" : "Dispute lost: funds go to the cardholder",
      },
      [
        { account: "merchant-dispute-hold", debit: amount, credit: "0" },
        snapshot.state === "Won"
          ? { account: "merchant-available", debit: "0", credit: amount }
          : { account: "funds-clearing", debit: "0", credit: amount },
      ],
    );
    const updated = await tx.platformDispute.update({ where: { id: dispute.id }, data: { state: snapshot.state } });
    if (snapshot.state === "Won") await recoverReceivable(tx, { ...base, now });
    await audit(tx, dispute.orgId, "worker", "treasury.dispute.state", dispute.id, { from: "Open", to: snapshot.state }, true);
    await tx.notification.create({
      data: {
        orgId: dispute.orgId,
        message: snapshot.state === "Won" ? "A dispute was decided in your favour" : "A dispute was lost; the amount went to the customer",
        href: "/merchant/disputes",
      },
    });
    return updated;
  });
}

async function open(tx: Tx, platformAccountId: string, s: DisputeSnapshot, now: Date) {
  const payment = await tx.platformPayment.findFirst({
    where: {
      platformAccountId,
      OR: [
        ...(s.paymentRef ? [{ providerPaymentRef: s.paymentRef }] : []),
        ...(s.paymentReference ? [{ reference: s.paymentReference }] : []),
      ],
    },
  });
  // The payment's provider id is learnt when its funds become available; a
  // dispute arriving first is retried until then.
  if (!payment) throw new PortalError("DISPUTE_PAYMENT_NOT_FOUND", 503);
  if (s.currency !== payment.asset.match(/^fiat:([A-Z]{3}):$/)?.[1]) throw new PortalError("DISPUTE_CURRENCY_MISMATCH", 409);
  const key = { orgId: payment.orgId, environment: payment.environment, platformAccountId, asset: payment.asset };
  const available = await platformBalance(tx, { ...key, account: "merchant-available" });
  const reserve = await platformBalance(tx, { ...key, account: "merchant-reserve" });
  const fromAvailable = take(s.amountMinor, available);
  const fromReserve = take(s.amountMinor - fromAvailable, reserve);
  const owed = s.amountMinor - fromAvailable - fromReserve;
  const dispute = await tx.platformDispute.create({
    data: {
      attemptId: payment.attemptId,
      orgId: payment.orgId,
      environment: payment.environment,
      platformAccountId,
      providerDisputeRef: s.reference,
      asset: payment.asset,
      amountMinor: s.amountMinor.toString(),
      feeMinor: s.feeMinor.toString(),
      fromAvailableMinor: fromAvailable.toString(),
      fromReserveMinor: fromReserve.toString(),
      fromReceivableMinor: owed.toString(),
      state: "Open",
      reason: s.reason?.slice(0, 200),
      evidenceDueBy: s.evidenceDueBy,
    },
  });
  const base = { ...key, effectiveAt: now };
  await postFunds(tx, { ...base, source: `dispute:${dispute.id}`, purpose: "Dispute opened: amount held from the merchant" }, nonzero([
    { account: "merchant-available", debit: fromAvailable.toString(), credit: "0" },
    { account: "merchant-reserve", debit: fromReserve.toString(), credit: "0" },
    { account: "merchant-receivable", debit: owed.toString(), credit: "0" },
    { account: "merchant-dispute-hold", debit: "0", credit: s.amountMinor.toString() },
  ]));
  if (s.feeMinor > 0n) {
    const left = available - fromAvailable;
    const feeFromAvailable = take(s.feeMinor, left);
    await postFunds(tx, { ...base, source: `dispute-fee:${dispute.id}`, purpose: "Provider dispute fee, passed on to the merchant" }, nonzero([
      { account: "merchant-available", debit: feeFromAvailable.toString(), credit: "0" },
      { account: "merchant-receivable", debit: (s.feeMinor - feeFromAvailable).toString(), credit: "0" },
      { account: "funds-clearing", debit: "0", credit: s.feeMinor.toString() },
    ]));
  }
  await audit(tx, payment.orgId, "worker", "treasury.dispute.opened", dispute.id, {
    amountMinor: s.amountMinor.toString(),
    owedByMerchant: owed.toString(),
  }, true);
  await tx.notification.create({
    data: { orgId: payment.orgId, message: "A customer disputed a payment; the amount is on hold", href: "/merchant/disputes" },
  });
  return dispute;
}

// Re-reads a dispute from the provider (prompted by a webhook or sweep) and
// keeps the provider-side funds in step on fund-holding rails.
export async function refreshDispute(platformAccountId: string, reference: string, now = new Date()) {
  const platform = await db.platformAccount.findUniqueOrThrow({ where: { id: platformAccountId } });
  const adapter = platformAdapter(platform);
  if (!adapter.disputeStatus) return null;
  const snapshot = await adapter.disputeStatus({ reference });
  if (!snapshot) return null;
  const dispute = await applyDispute(platformAccountId, snapshot, now);
  if (!dispute) return null;
  const payment = await db.platformPayment.findUniqueOrThrow({ where: { attemptId: dispute.attemptId }, include: { link: true } });
  const covered = BigInt(dispute.fromAvailableMinor.toFixed(0)) + BigInt(dispute.fromReserveMinor.toFixed(0));
  // The provider debited PayRouta's platform balance: pull what the
  // merchant's balance covered out of its sub-account while the dispute is
  // open, and send the full amount back if it is won.
  // Provider calls carry the dispute id as idempotency key, so a retry after
  // a failure repeats them safely; fundsHeld records that the hold happened.
  if (dispute.state === "Open" && !dispute.fundsHeld && adapter.holdDisputeFunds && payment.providerTransferRef && covered > 0n) {
    await adapter.holdDisputeFunds({
      providerAccountId: payment.link.providerAccountId!,
      transferRef: payment.providerTransferRef,
      amountMinor: covered,
      disputeId: dispute.id,
    });
    await db.platformDispute.update({ where: { id: dispute.id }, data: { fundsHeld: true } });
  }
  if (dispute.state === "Won" && dispute.fundsHeld && adapter.releaseDisputeFunds) {
    await adapter.releaseDisputeFunds({
      providerAccountId: payment.link.providerAccountId!,
      amountMinor: BigInt(dispute.amountMinor.toFixed(0)),
      currency: snapshot.currency,
      disputeId: dispute.id,
    });
    await db.platformDispute.update({ where: { id: dispute.id }, data: { fundsHeld: false } });
  }
  return dispute;
}

export const disputeEvidenceSchema = z
  .object({
    productDescription: z.string().trim().min(20).max(5000),
    customerName: z.string().trim().max(200).optional(),
    customerEmail: z.email().max(200).optional(),
    customerPhone: z.string().trim().regex(/^\+?[0-9 ()-]{6,20}$/).optional(),
    serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    shippingCarrier: z.string().trim().max(100).optional(),
    shippingTrackingNumber: z.string().trim().max(100).optional(),
    shippingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    deliveryAddress: z.string().trim().max(500).optional(),
    refundPolicy: z.string().trim().max(5000).optional(),
    explanation: z.string().trim().max(10000).optional(),
  })
  .strict();

// The merchant's answer to a dispute: sent to the provider (which forwards it
// to the card network) and then recorded. Once only, while the dispute is
// open and before its deadline.
export async function submitDisputeEvidence(
  input: { orgId: string; environment: string; disputeId: string; evidence: unknown; actorId: string },
  now = new Date(),
) {
  const evidence = disputeEvidenceSchema.parse(input.evidence);
  const dispute = await db.platformDispute.findUnique({ where: { id: input.disputeId }, include: { platformAccount: true } });
  if (!dispute || dispute.orgId !== input.orgId || dispute.environment !== input.environment)
    throw new PortalError("DISPUTE_NOT_FOUND", 404);
  if (dispute.state !== "Open") throw new PortalError("DISPUTE_CLOSED", 409);
  if (dispute.evidenceSubmittedAt) throw new PortalError("EVIDENCE_ALREADY_SUBMITTED", 409);
  if (dispute.evidenceDueBy && dispute.evidenceDueBy <= now) throw new PortalError("EVIDENCE_DEADLINE_PASSED", 409);
  const adapter = platformAdapter(dispute.platformAccount);
  if (!adapter.submitDisputeEvidence) throw new PortalError("EVIDENCE_NOT_SUPPORTED_ON_RAIL", 409);
  await adapter.submitDisputeEvidence({ reference: dispute.providerDisputeRef, disputeId: dispute.id, evidence });
  return atomic(async (tx) => {
    const updated = await tx.platformDispute.update({
      where: { id: dispute.id },
      data: { evidence: json(evidence), evidenceSubmittedAt: now, evidenceSubmittedBy: input.actorId },
    });
    await audit(tx, dispute.orgId, input.actorId, "treasury.dispute.evidence", dispute.id, { fields: Object.keys(evidence) }, true);
    return updated;
  });
}
