// Refunds of payments taken through a platform account.
//
//   requested  merchant-available (what it covers) + merchant-receivable
//              (the shortfall, owed by the merchant) → funds-clearing
//   failed     the same entry reversed
//
// The merchant funds every refund in full; PayRouta's fee is not returned.
// On fund-holding rails the provider takes the refund from the merchant's
// sub-account (Stripe: reverse_transfer); on split-settlement rails it may
// come from PayRouta's own balance, which is why the shortfall is booked as
// owed and recovered by set-off (ledger.ts recoverReceivable).
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { atomic, audit } from "../portal/service";
import { queue, type Tx } from "../payments/service";
import { platformBalance, postFunds } from "./ledger";
import { requireFundsAccess } from "./merchant-account";
import { platformAdapter } from "./platforms/registry";
import type { RefundState } from "./platforms/contract";

const currencyOf = (asset: string) => asset.match(/^fiat:([A-Z]{3}):$/)?.[1] ?? null;

export async function requestRefund(
  tx: Tx,
  input: { orgId: string; environment: string; intentId: string; amountMinor?: bigint; reason?: string; initiatedBy: string; now: Date },
) {
  const payment = await tx.platformPayment.findUnique({
    where: { intentId: input.intentId },
    include: { refunds: true, platformAccount: true },
  });
  if (!payment || payment.orgId !== input.orgId || payment.environment !== input.environment)
    throw new PortalError("PAYMENT_NOT_FOUND", 404);
  await requireFundsAccess(tx, { ...input, platformAccountId: payment.platformAccountId, operation: "refund" });
  if (!platformAdapter(payment.platformAccount).createRefund) throw new PortalError("REFUND_NOT_SUPPORTED_ON_RAIL", 409);
  const gross = BigInt(payment.grossMinor.toFixed(0));
  const refunded = payment.refunds
    .filter((r) => r.state !== "Failed")
    .reduce((n, r) => n + BigInt(r.amountMinor.toFixed(0)), 0n);
  const amount = input.amountMinor ?? gross - refunded;
  if (amount <= 0n || refunded + amount > gross) throw new PortalError("REFUND_EXCEEDS_PAYMENT", 409);
  const available = await platformBalance(tx, {
    ...input,
    platformAccountId: payment.platformAccountId,
    asset: payment.asset,
    account: "merchant-available",
  });
  const fromAvailable = available > amount ? amount : available > 0n ? available : 0n;
  const refund = await tx.platformRefund.create({
    data: {
      attemptId: payment.attemptId,
      orgId: payment.orgId,
      environment: payment.environment,
      platformAccountId: payment.platformAccountId,
      asset: payment.asset,
      amountMinor: amount.toString(),
      fromAvailableMinor: fromAvailable.toString(),
      fromReceivableMinor: (amount - fromAvailable).toString(),
      reason: input.reason?.slice(0, 500),
      initiatedBy: input.initiatedBy,
    },
  });
  await postFunds(
    tx,
    {
      orgId: payment.orgId,
      environment: payment.environment,
      platformAccountId: payment.platformAccountId,
      source: `refund:${refund.id}`,
      asset: payment.asset,
      purpose: "Refund to the customer, funded by the merchant",
      effectiveAt: input.now,
    },
    [
      { account: "merchant-available", debit: fromAvailable.toString(), credit: "0" },
      { account: "merchant-receivable", debit: (amount - fromAvailable).toString(), credit: "0" },
      { account: "funds-clearing", debit: "0", credit: amount.toString() },
    ].filter((l) => l.debit !== "0" || l.credit !== "0"),
  );
  await queue(tx, payment.orgId, "treasury-refund-dispatch", `treasury-refund-dispatch:${refund.id}`, { refundId: refund.id });
  await audit(tx, payment.orgId, input.initiatedBy, "treasury.refund.requested", refund.id, {
    intentId: input.intentId,
    amountMinor: amount.toString(),
    owedByMerchant: (amount - fromAvailable).toString(),
  }, true);
  return refund;
}

async function applyOutcome(refundId: string, outcome: { state: RefundState; reference?: string; failureCode?: string }, now = new Date()) {
  await atomic(async (tx) => {
    const r = await tx.platformRefund.findUniqueOrThrow({ where: { id: refundId } });
    if (["Succeeded", "Failed"].includes(r.state) || r.state === outcome.state) {
      if (outcome.reference && !r.providerRefundRef)
        await tx.platformRefund.update({ where: { id: r.id }, data: { providerRefundRef: outcome.reference } });
      return;
    }
    if (outcome.state === "Failed")
      await postFunds(
        tx,
        {
          orgId: r.orgId,
          environment: r.environment,
          platformAccountId: r.platformAccountId,
          source: `refund-failed:${r.id}`,
          asset: r.asset,
          purpose: "Refund failed; the merchant's funds are restored",
          effectiveAt: now,
        },
        [
          { account: "funds-clearing", debit: r.amountMinor.toFixed(0), credit: "0" },
          { account: "merchant-available", debit: "0", credit: r.fromAvailableMinor.toFixed(0) },
          { account: "merchant-receivable", debit: "0", credit: r.fromReceivableMinor.toFixed(0) },
        ].filter((l) => l.debit !== "0" || l.credit !== "0"),
      );
    await tx.platformRefund.update({
      where: { id: r.id },
      data: {
        state: outcome.state,
        providerRefundRef: outcome.reference ?? r.providerRefundRef,
        failureCode: outcome.failureCode?.slice(0, 100) ?? r.failureCode,
      },
    });
    await audit(tx, r.orgId, "worker", "treasury.refund.state", r.id, { from: r.state, to: outcome.state }, true);
  });
}

async function context(refundId: string) {
  const r = await db.platformRefund.findUniqueOrThrow({
    where: { id: refundId },
    include: { payment: { include: { link: true } }, platformAccount: true },
  });
  return { r, adapter: platformAdapter(r.platformAccount) };
}

export async function dispatchRefund(refundId: string, now = new Date()) {
  const { r, adapter } = await context(refundId);
  if (r.state !== "Queued" || !adapter.createRefund) return;
  let result;
  try {
    // The refund id is the idempotency key: a retried job never refunds twice.
    result = await adapter.createRefund({
      providerAccountId: r.payment.link.providerAccountId!,
      reference: r.payment.reference,
      paymentRef: r.payment.providerPaymentRef ?? undefined,
      refundId: r.id,
      amountMinor: BigInt(r.amountMinor.toFixed(0)),
      currency: currencyOf(r.asset)!,
    });
  } catch (error) {
    if (error instanceof PortalError && error.status === 422)
      return applyOutcome(r.id, { state: "Failed", failureCode: error.message }, now);
    throw error;
  }
  await applyOutcome(r.id, result, now);
}

export async function refreshRefund(refundId: string, now = new Date()) {
  const { r, adapter } = await context(refundId);
  if (r.state !== "Pending" || !r.providerRefundRef || !adapter.refundStatus) return;
  const status = await adapter.refundStatus({ providerAccountId: r.payment.link.providerAccountId!, reference: r.providerRefundRef });
  if (status) await applyOutcome(r.id, status, now);
}
