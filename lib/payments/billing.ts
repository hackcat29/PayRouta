import { db } from "../portal/db";
import { atomic, json } from "../portal/service";
import { PortalError } from "../portal/domain";
import type { PaymentIntent } from "../generated/prisma/client";
import type { Tx } from "./service";
import { calculateFee, feeSnapshotSchema } from "./pricing";
import { exception, post } from "./journal";

// "withheld": taken at source through a platform account, so already
// collected; "invoice": billed on the monthly statement.
export async function accrueFee(
  tx: Tx,
  intent: PaymentIntent,
  now: Date,
  collection: "invoice" | "withheld" = "invoice",
) {
  if (await tx.paymentFee.findUnique({ where: { intentId: intent.id } }))
    return;
  // Existing intents predate this release. Never impose new terms retroactively.
  if (!intent.feeSnapshot) {
    if (intent.environment === "production")
      await exception(
        tx,
        intent.id,
        "PAYMENT_FEE_TERMS_MISSING",
        {
          nextAction:
            "Review pre-pricing payment; do not apply new fees retroactively",
        },
        now,
      );
    return;
  }
  const snapshot = feeSnapshotSchema.parse(intent.feeSnapshot);
  if (
    !snapshot.free &&
    (snapshot.schedule?.asset !==
      `${(intent.asset as { kind: string }).kind}:${(intent.asset as { identifier: string }).identifier}:${(intent.asset as { network: string }).network}` ||
      (snapshot.schedule.orgId && snapshot.schedule.orgId !== intent.orgId))
  )
    throw new PortalError("FEE_SNAPSHOT_SCOPE_MISMATCH", 409);
  const f = calculateFee(
    snapshot,
    intent.selectedMethod!,
    intent.amount,
    intent.precision,
  );
  const fee = await tx.paymentFee.create({
    data: {
      intentId: intent.id,
      orgId: intent.orgId,
      environment: intent.environment,
      method: intent.selectedMethod!,
      currency: f.currency,
      precision: f.precision,
      amountMinor: f.amountMinor,
      billable: !snapshot.free,
      collection,
      terms: json(snapshot),
      effectiveAt: now,
    },
  });
  if (!snapshot.free && BigInt(f.amountMinor) > 0n && collection === "invoice")
    await post(
      tx,
      {
        orgId: intent.orgId,
        environment: intent.environment,
        source: `platform-fee:${fee.intentId}`,
        asset: `fiat:${f.currency}:`,
        book: "payrouta-platform-accrual",
        purpose:
          "Platform fee receivable; billed monthly, not deducted from provider settlement",
        effectiveAt: now,
      },
      [
        { account: "platform-receivable", debit: f.amountMinor, credit: "0" },
        { account: "platform-fee-revenue", debit: "0", credit: f.amountMinor },
      ],
    );
}
export function billingWindow(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new PortalError("INVALID_BILLING_MONTH");
  const from = new Date(`${month}-01T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCMonth(to.getUTCMonth() + 1);
  return { from, to };
}
export async function feeTotals(
  orgId: string,
  environment: string,
  month: string,
) {
  const { from, to } = billingWindow(month);
  const groups = await db.paymentFee.groupBy({
    by: ["currency", "precision"],
    where: {
      orgId,
      environment,
      billable: true,
      collection: "invoice",
      effectiveAt: { gte: from, lt: to },
    },
    _sum: { amountMinor: true },
    _count: true,
  });
  return groups.map((g) => ({
    currency: g.currency,
    precision: g.precision,
    amountMinor: g._sum.amountMinor?.toFixed(0) ?? "0",
    payments: g._count,
  }));
}
// Closed-month usage statements are immutable pretax records, not tax invoices or receipts.
export async function closeStatement(
  orgId: string,
  month: string,
  currency: string,
  precision: number,
  now = new Date(),
) {
  const { from, to } = billingWindow(month);
  if (to > now) throw new PortalError("BILLING_MONTH_NOT_CLOSED", 409);
  return atomic(async (tx) => {
    const where = {
      orgId_environment_month_currency_precision: {
        orgId,
        environment: "production",
        month,
        currency,
        precision,
      },
    };
    const old = await tx.billingStatement.findUnique({ where });
    if (old) return old;
    const fees = await tx.paymentFee.findMany({
      where: {
        orgId,
        environment: "production",
        billable: true,
        collection: "invoice",
        currency,
        precision,
        effectiveAt: { gte: from, lt: to },
      },
      orderBy: [{ effectiveAt: "asc" }, { intentId: "asc" }],
      take: 10001,
    });
    if (!fees.length) throw new PortalError("NO_BILLABLE_PAYMENTS", 409);
    if (fees.length > 10000)
      throw new PortalError("BILLING_STATEMENT_REQUIRES_BATCH_EXPORT", 409);
    return tx.billingStatement.create({
      data: {
        orgId,
        environment: "production",
        month,
        currency,
        precision,
        amountMinor: fees
          .reduce((n, f) => n + BigInt(f.amountMinor.toFixed(0)), 0n)
          .toString(),
        lines: json(
          fees.map((f) => ({
            intentId: f.intentId,
            method: f.method,
            amountMinor: f.amountMinor.toFixed(0),
            effectiveAt: f.effectiveAt.toISOString(),
            terms: f.terms,
          })),
        ),
        createdAt: now,
      },
    });
  });
}
