// Subscriptions and usage billing (docs/subscriptions.md). The merchant bills;
// the customer pays each invoice at a hosted page, from any wallet and token
// the merchant accepts (and by fiat methods that are on). Nothing is pulled
// from a customer's wallet: an unpaid invoice makes the subscription past
// due, and still unpaid at the next renewal, cancels it.
//
//   create        Incomplete, with the first period's invoice; Active once
//                 paid (usage-only plans are Active at once)
//   each period   one invoice: next period's price + last period's usage
//   unpaid        PastDue after graceDays; Canceled at the next renewal
//   cancel        now, or at period end with a final usage invoice
//
// Events (webhooks): subscription.created, subscription.active,
// subscription.past_due, subscription.canceled, invoice.created,
// invoice.paid. Their objectId is the subscription or invoice id.
import { merchantBrand } from "../merchant/branding";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../portal/db";
import { atomic, audit, json } from "../portal/service";
import { PortalError } from "../portal/domain";
import { rateLimit } from "../portal/access";
import { mail } from "../portal/adapters";
import { queue, type Tx } from "../payments/service";
import { createUniversalCheckout } from "../payments/universal";
import { page, pagination } from "../merchant/service";
import { merchantMember } from "../merchant/access";
import { cryptoOptions, linkMethodsOn, newSlug } from "../merchant/payment-links";
import { renderInvoiceEmail } from "../email/templates/transactional";
import {
  cancelInput,
  graceDays,
  invoiceLines,
  periodEnd,
  periodIndex,
  planInput,
  subscriptionInput,
  toMinor,
  usageInput,
  type Interval,
  type Meter,
} from "./billing";

type Scope = { orgId: string; environment: string };


function origin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new PortalError("PORTAL_ORIGIN_NOT_CONFIGURED", 503);
  return new URL(value).origin;
}
export const invoiceUrl = (slug: string) => `${origin()}/pay/invoice/${slug}`;

// ---------- Plans ----------

export async function createPlan(scope: Scope, raw: unknown, actor: string) {
  await rateLimit(`subscription-plan:${scope.orgId}`, 30);
  const input = planInput.parse(raw);
  toMinor(input.amount, input.currency);
  const on = await linkMethodsOn(scope.orgId, scope.environment);
  if (input.methods.some((m) => !on.has(m))) throw new PortalError("PAYMENT_LINK_METHOD_NOT_ON", 409);
  if (input.crypto) {
    if (input.currency !== "USD") throw new PortalError("PAYMENT_LINK_CRYPTO_REQUIRES_USD", 409);
    if (!(await cryptoOptions(scope.orgId, scope.environment)).length)
      throw new PortalError("PAYMENT_LINK_CRYPTO_NOT_CONFIGURED", 409);
  }
  return atomic(async (tx) => {
    const plan = await tx.subscriptionPlan.create({
      data: {
        ...scope,
        name: input.name,
        amount: input.amount,
        currency: input.currency,
        interval: input.interval,
        intervalCount: input.intervalCount,
        meters: json(input.meters),
        methods: input.methods,
        crypto: input.crypto,
        createdBy: actor,
      },
    });
    await audit(tx, scope.orgId, actor, "merchant.subscription_plan.created", plan.id, { environment: scope.environment });
    return planView(plan);
  });
}

type PlanRow = Awaited<ReturnType<typeof db.subscriptionPlan.findFirstOrThrow>>;
export function planView(p: PlanRow) {
  return {
    id: p.id,
    name: p.name,
    amount: p.amount,
    currency: p.currency,
    interval: p.interval as Interval,
    intervalCount: p.intervalCount,
    meters: p.meters as Meter[],
    methods: p.methods as string[],
    crypto: p.crypto,
    active: p.active,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listPlans(scope: Scope) {
  const plans = await db.subscriptionPlan.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 100 });
  return plans.map(planView);
}

export async function setPlanActive(scope: Scope, id: string, active: boolean, actor: string) {
  return atomic(async (tx) => {
    const plan = await tx.subscriptionPlan.findFirst({ where: { ...scope, id } });
    if (!plan) throw new PortalError("NOT_FOUND", 404);
    await tx.subscriptionPlan.update({ where: { id }, data: { active } });
    await audit(tx, scope.orgId, actor, active ? "merchant.subscription_plan.enabled" : "merchant.subscription_plan.disabled", id, {});
    return { id, active };
  });
}

// ---------- Events ----------

// Subscription events go through the same signed webhook delivery as
// payment events; objectId names the subscription or invoice.
async function emit(tx: Tx, scope: Scope, type: string, objectId: string, data: Record<string, unknown>) {
  const version = (await tx.merchantEvent.count({ where: { intentId: objectId, type } })) + 1;
  const id = randomUUID();
  const e = await tx.merchantEvent.create({
    data: {
      id,
      intentId: objectId,
      orgId: scope.orgId,
      environment: scope.environment,
      type,
      version,
      payload: json({
        id,
        type,
        schemaVersion: "1",
        objectId,
        objectVersion: version,
        environment: scope.environment,
        occurredAt: new Date().toISOString(),
        ...data,
      }),
    },
  });
  await tx.merchantDelivery.create({ data: { eventId: e.id } });
  await queue(tx, scope.orgId, "payment-delivery", `delivery:${e.id}`, { eventId: e.id });
}

// ---------- Subscriptions ----------

const full = { plan: true, customer: true, invoices: { orderBy: { number: "desc" as const }, take: 24 } };
type SubRow = Awaited<ReturnType<typeof db.subscription.findFirstOrThrow<{ include: typeof full }>>>;
type InvoiceRow = SubRow["invoices"][number];

export function invoiceView(i: InvoiceRow) {
  return {
    id: i.id,
    number: i.number,
    amount: i.amount,
    currency: i.currency,
    state: i.state,
    lines: i.lines as { description: string; quantity: string; unitAmount: string; amount: string }[],
    periodStart: i.periodStart.toISOString(),
    periodEnd: i.periodEnd.toISOString(),
    dueAt: i.dueAt.toISOString(),
    paidAt: i.paidAt?.toISOString() ?? null,
    paymentId: i.paymentId,
    url: invoiceUrl(i.slug),
    createdAt: i.createdAt.toISOString(),
  };
}

export function subscriptionView(s: SubRow) {
  return {
    id: s.id,
    state: s.state,
    plan: { id: s.plan.id, name: s.plan.name, amount: s.plan.amount, currency: s.plan.currency, interval: s.plan.interval, intervalCount: s.plan.intervalCount },
    customer: { id: s.customer.id, email: s.customer.email, name: s.customer.name, reference: s.customer.reference },
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    canceledAt: s.canceledAt?.toISOString() ?? null,
    metadata: s.metadata as Record<string, string>,
    latestInvoice: s.invoices[0] ? invoiceView(s.invoices[0]) : null,
    createdAt: s.createdAt.toISOString(),
  };
}

const eventData = (s: SubRow) => ({ subscription: subscriptionView(s) });

export async function createSubscription(scope: Scope, raw: unknown, actor: string) {
  await rateLimit(`subscription-create:${scope.orgId}`, 60);
  const input = subscriptionInput.parse(raw);
  const now = new Date();
  const created = await atomic(async (tx) => {
    const plan = await tx.subscriptionPlan.findFirst({ where: { ...scope, id: input.plan, active: true } });
    if (!plan) throw new PortalError("SUBSCRIPTION_PLAN_NOT_FOUND", 404);
    const email = input.customer.email.toLowerCase();
    const customer = await tx.billingCustomer.upsert({
      where: { orgId_environment_email: { ...scope, email } },
      create: { ...scope, email, name: input.customer.name, reference: input.customer.reference },
      update: {
        ...(input.customer.name ? { name: input.customer.name } : {}),
        ...(input.customer.reference ? { reference: input.customer.reference } : {}),
      },
    });
    const end = periodEnd(now, plan.interval as Interval, plan.intervalCount, 0);
    const first = invoiceLines({ ...plan, meters: plan.meters as Meter[] }, [], { base: true });
    const sub = await tx.subscription.create({
      data: {
        ...scope,
        planId: plan.id,
        customerId: customer.id,
        state: first.totalMinor > 0n ? "Incomplete" : "Active",
        currentPeriodStart: now,
        currentPeriodEnd: end,
        metadata: json(input.metadata),
        createdBy: actor,
        createdAt: now,
      },
    });
    let invoice: InvoiceRow | null = null;
    if (first.totalMinor > 0n) invoice = await openInvoice(tx, sub, plan, first, now, end, 1);
    await queue(tx, scope.orgId, "subscription-renew", `subscription-renew:${sub.id}:${end.toISOString()}`, { subscriptionId: sub.id, periodEnd: end.toISOString() }, end);
    await audit(tx, scope.orgId, actor, "merchant.subscription.created", sub.id, { environment: scope.environment });
    const row = await tx.subscription.findUniqueOrThrow({ where: { id: sub.id }, include: full });
    await emit(tx, scope, "subscription.created", sub.id, eventData(row));
    if (row.state === "Active") await emit(tx, scope, "subscription.active", sub.id, eventData(row));
    return { row, invoice };
  });
  if (created.invoice) await notify(created.invoice.id, false);
  return subscriptionView(created.row);
}

async function openInvoice(
  tx: Tx,
  sub: { id: string; orgId: string; environment: string },
  plan: { currency: string },
  bill: ReturnType<typeof invoiceLines>,
  periodStart: Date,
  periodEndAt: Date,
  number: number,
) {
  const now = new Date();
  // Due after graceDays, or by the period's end when the period is shorter.
  const dueAt = new Date(now.getTime() + Math.min(graceDays * 86400000, Math.max(periodEndAt.getTime() - periodStart.getTime(), 3600000)));
  const invoice = await tx.subscriptionInvoice.create({
    data: {
      subscriptionId: sub.id,
      orgId: sub.orgId,
      environment: sub.environment,
      number,
      slug: newSlug(14),
      periodStart,
      periodEnd: periodEndAt,
      amount: bill.total,
      currency: plan.currency,
      lines: json(bill.lines),
      dueAt,
    },
  });
  const scope = { orgId: sub.orgId, environment: sub.environment };
  await queue(tx, sub.orgId, "subscription-overdue", `subscription-overdue:${invoice.id}`, { invoiceId: invoice.id }, dueAt);
  await emit(tx, scope, "invoice.created", invoice.id, { subscriptionId: sub.id, invoice: invoiceView(invoice) });
  return invoice;
}

// Newest first; `state` and `reference` (the customer's email) filter, and
// `cursor` pages like every other list in the API.
export async function listSubscriptions(scope: Scope, params: URLSearchParams = new URLSearchParams()) {
  const p = pagination(params);
  const rows = await db.subscription.findMany({
    where: {
      ...scope,
      ...p.after,
      ...(p.state ? { state: p.state } : {}),
      ...(p.reference ? { customer: { email: p.reference.toLowerCase() } } : {}),
    },
    include: full,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: p.limit + 1,
  });
  const result = page(rows, p.limit);
  return { data: result.data.map(subscriptionView), nextCursor: result.nextCursor };
}

export async function getSubscription(scope: Scope, id: string) {
  const s = await db.subscription.findFirst({ where: { ...scope, id }, include: full });
  if (!s) throw new PortalError("NOT_FOUND", 404);
  const usage = await db.usageRecord.groupBy({
    by: ["meter"],
    where: { subscriptionId: id, invoiceId: null },
    _count: true,
  });
  const records = await db.usageRecord.findMany({
    where: { subscriptionId: id, invoiceId: null },
    select: { meter: true, quantity: true },
  });
  const meters = (s.plan.meters as Meter[]).map((m) => {
    const q = invoiceLines({ ...s.plan, amount: "0", meters: [{ ...m, includedUnits: "0" }] }, records, { base: false });
    return {
      meter: m.key,
      name: m.name,
      quantity: q.lines[0]?.quantity ?? "0",
      records: usage.find((u) => u.meter === m.key)?._count ?? 0,
    };
  });
  return { ...subscriptionView(s), invoices: s.invoices.map(invoiceView), usageThisPeriod: meters };
}

export async function recordUsage(scope: Scope, id: string, raw: unknown, headerKey?: string) {
  await rateLimit(`subscription-usage:${id}`, 600);
  const input = usageInput.parse(raw);
  const key = input.idempotencyKey ?? headerKey;
  if (!key || !/^[\w.:-]{8,120}$/.test(key)) throw new PortalError("IDEMPOTENCY_KEY_REQUIRED", 400);
  const sub = await db.subscription.findFirst({ where: { ...scope, id }, include: { plan: true } });
  if (!sub) throw new PortalError("NOT_FOUND", 404);
  if (sub.state === "Canceled") throw new PortalError("SUBSCRIPTION_CANCELED", 409);
  if (!(sub.plan.meters as Meter[]).some((m) => m.key === input.meter)) throw new PortalError("SUBSCRIPTION_METER_UNKNOWN", 400);
  const existing = await db.usageRecord.findUnique({ where: { subscriptionId_idempotencyKey: { subscriptionId: id, idempotencyKey: key } } });
  if (existing) return usageView(existing);
  // Without a time, usage counts in the current period (which, after a test
  // mode advance, may start later than now).
  const occurredAt = input.occurredAt
    ? new Date(input.occurredAt)
    : new Date(Math.max(Date.now(), sub.currentPeriodStart.getTime()));
  if (occurredAt < sub.currentPeriodStart) throw new PortalError("SUBSCRIPTION_USAGE_PERIOD_CLOSED", 409);
  if (occurredAt.getTime() > Date.now() + 5 * 60000 && occurredAt > sub.currentPeriodStart)
    throw new PortalError("SUBSCRIPTION_USAGE_IN_FUTURE", 400);
  try {
    return usageView(
      await db.usageRecord.create({
        data: { subscriptionId: id, meter: input.meter, quantity: input.quantity, occurredAt, idempotencyKey: key },
      }),
    );
  } catch {
    const again = await db.usageRecord.findUnique({ where: { subscriptionId_idempotencyKey: { subscriptionId: id, idempotencyKey: key } } });
    if (again) return usageView(again);
    throw new PortalError("SERVICE_UNAVAILABLE", 503);
  }
}

const usageView = (u: { id: string; meter: string; quantity: string; occurredAt: Date; idempotencyKey: string }) => ({
  id: u.id,
  meter: u.meter,
  quantity: u.quantity,
  occurredAt: u.occurredAt.toISOString(),
  idempotencyKey: u.idempotencyKey,
});

export async function cancelSubscription(scope: Scope, id: string, raw: unknown, actor: string) {
  const { atPeriodEnd } = cancelInput.parse(raw ?? {});
  const result = await atomic(async (tx) => {
    const s = await tx.subscription.findFirst({ where: { ...scope, id }, include: full });
    if (!s) throw new PortalError("NOT_FOUND", 404);
    if (s.state === "Canceled") return { row: s, invoice: null };
    if (atPeriodEnd) {
      await tx.subscription.update({ where: { id }, data: { cancelAtPeriodEnd: true } });
      await audit(tx, scope.orgId, actor, "merchant.subscription.cancel_scheduled", id, {});
      return { row: await tx.subscription.findUniqueOrThrow({ where: { id }, include: full }), invoice: null };
    }
    // Now: bill the usage so far, then stop.
    const invoice = await billUsage(tx, s, new Date());
    await voidOpen(tx, id, invoice?.id);
    await tx.subscription.update({ where: { id }, data: { state: "Canceled", canceledAt: new Date() } });
    await audit(tx, scope.orgId, actor, "merchant.subscription.canceled", id, {});
    const row = await tx.subscription.findUniqueOrThrow({ where: { id }, include: full });
    await emit(tx, scope, "subscription.canceled", id, { ...eventData(row), reason: "requested" });
    return { row, invoice };
  });
  if (result.invoice) await notify(result.invoice.id, false);
  return subscriptionView(result.row);
}

// A canceled subscription's unpaid invoices can no longer be paid, except
// its final usage invoice.
async function voidOpen(tx: Tx, subscriptionId: string, keep?: string) {
  await tx.subscriptionInvoice.updateMany({
    where: { subscriptionId, state: "Open", ...(keep ? { id: { not: keep } } : {}) },
    data: { state: "Void" },
  });
}

// A final invoice for unbilled usage up to `until`; null when there's none.
async function billUsage(tx: Tx, s: SubRow, until: Date) {
  const usage = await tx.usageRecord.findMany({ where: { subscriptionId: s.id, invoiceId: null, occurredAt: { lt: until } } });
  const bill = invoiceLines({ ...s.plan, meters: s.plan.meters as Meter[] }, usage, { base: false });
  if (bill.totalMinor <= 0n) return null;
  const number = (await tx.subscriptionInvoice.count({ where: { subscriptionId: s.id } })) + 1;
  const invoice = await openInvoice(tx, s, s.plan, bill, s.currentPeriodStart, until, number);
  await tx.usageRecord.updateMany({ where: { id: { in: usage.map((u) => u.id) } }, data: { invoiceId: invoice.id } });
  return invoice;
}

// ---------- Billing cycle (worker jobs) ----------

// The period ending at `expectedEnd` closes: invoice the next period's price
// and the closed period's usage, or end the subscription.
export async function renew(subscriptionId: string, expectedEnd: string) {
  const result = await atomic(async (tx) => {
    const s = await tx.subscription.findUnique({ where: { id: subscriptionId }, include: full });
    if (!s || s.state === "Canceled" || s.currentPeriodEnd.toISOString() !== expectedEnd) return null;
    const scope = { orgId: s.orgId, environment: s.environment };
    const closedEnd = s.currentPeriodEnd;
    const now = new Date();
    const overdue = await tx.subscriptionInvoice.count({
      where: { subscriptionId: s.id, state: "Open", dueAt: { lte: now } },
    });
    const ending = s.cancelAtPeriodEnd || overdue > 0;
    const usage = await tx.usageRecord.findMany({ where: { subscriptionId: s.id, invoiceId: null, occurredAt: { lt: closedEnd } } });
    const bill = invoiceLines({ ...s.plan, meters: s.plan.meters as Meter[] }, usage, { base: !ending });
    const interval = s.plan.interval as Interval;
    const nextEnd = periodEnd(s.createdAt, interval, s.plan.intervalCount, periodIndex(s.createdAt, interval, s.plan.intervalCount, closedEnd) + 1);
    let invoice: InvoiceRow | null = null;
    if (bill.totalMinor > 0n) {
      const number = (await tx.subscriptionInvoice.count({ where: { subscriptionId: s.id } })) + 1;
      invoice = ending
        ? await openInvoice(tx, s, s.plan, bill, s.currentPeriodStart, closedEnd, number)
        : await openInvoice(tx, s, s.plan, bill, closedEnd, nextEnd, number);
      await tx.usageRecord.updateMany({ where: { id: { in: usage.map((u) => u.id) } }, data: { invoiceId: invoice.id } });
    }
    if (ending) {
      await voidOpen(tx, s.id, invoice?.id);
      await tx.subscription.update({ where: { id: s.id }, data: { state: "Canceled", canceledAt: now } });
      const row = await tx.subscription.findUniqueOrThrow({ where: { id: s.id }, include: full });
      await emit(tx, scope, "subscription.canceled", s.id, { ...eventData(row), reason: s.cancelAtPeriodEnd ? "requested" : "unpaid" });
    } else {
      await tx.subscription.update({ where: { id: s.id }, data: { currentPeriodStart: closedEnd, currentPeriodEnd: nextEnd } });
      await queue(tx, s.orgId, "subscription-renew", `subscription-renew:${s.id}:${nextEnd.toISOString()}`, { subscriptionId: s.id, periodEnd: nextEnd.toISOString() }, nextEnd);
    }
    return { invoice };
  });
  if (result?.invoice) await notify(result.invoice.id, false);
}

// An invoice reached its due date unpaid: the subscription is past due.
export async function overdue(invoiceId: string) {
  const changed = await atomic(async (tx) => {
    const invoice = await tx.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.state !== "Open" || invoice.dueAt > new Date()) return false;
    const s = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId }, include: full });
    if (s.state !== "Active") return true;
    await tx.subscription.update({ where: { id: s.id }, data: { state: "PastDue" } });
    const row = await tx.subscription.findUniqueOrThrow({ where: { id: s.id }, include: full });
    await emit(tx, { orgId: s.orgId, environment: s.environment }, "subscription.past_due", s.id, { ...eventData(row), invoiceId });
    return true;
  });
  if (changed) await notify(invoiceId, true);
}

// A payment for an invoice was confirmed (lib/payments/service.ts queues
// this from the payment.confirmed event).
export async function invoicePaid(invoiceId: string, paymentId: string) {
  await atomic(async (tx) => {
    const invoice = await tx.subscriptionInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice || invoice.state !== "Open") return;
    const scope = { orgId: invoice.orgId, environment: invoice.environment };
    const paid = await tx.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: { state: "Paid", paidAt: new Date(), paymentId },
    });
    await emit(tx, scope, "invoice.paid", invoiceId, { subscriptionId: invoice.subscriptionId, invoice: invoiceView(paid) });
    const s = await tx.subscription.findUniqueOrThrow({ where: { id: invoice.subscriptionId } });
    const stillOverdue = await tx.subscriptionInvoice.count({
      where: { subscriptionId: s.id, state: "Open", dueAt: { lte: new Date() } },
    });
    if ((s.state === "Incomplete" || s.state === "PastDue") && !stillOverdue) {
      await tx.subscription.update({ where: { id: s.id }, data: { state: "Active" } });
      const row = await tx.subscription.findUniqueOrThrow({ where: { id: s.id }, include: full });
      await emit(tx, scope, "subscription.active", s.id, eventData(row));
    }
  });
}

// Test mode: close the current period now, as the renewal job would at its
// end, so merchants can see a renewal (and its usage invoice) without waiting.
export async function advanceTestPeriod(scope: Scope, id: string) {
  if (scope.environment !== "sandbox") throw new PortalError("SANDBOX_ONLY", 409);
  const s = await db.subscription.findFirst({ where: { ...scope, id } });
  if (!s) throw new PortalError("NOT_FOUND", 404);
  if (s.state === "Canceled") throw new PortalError("SUBSCRIPTION_CANCELED", 409);
  await renew(id, s.currentPeriodEnd.toISOString());
  return getSubscription(scope, id);
}

// ---------- The customer's side ----------

// Emails the customer their invoice (live mode only: test mode never mails
// customers; the merchant shares the link from the dashboard).
async function notify(invoiceId: string, reminder: boolean) {
  const invoice = await db.subscriptionInvoice.findUnique({
    where: { id: invoiceId },
    include: { subscription: { include: { customer: true, plan: true } } },
  });
  if (!invoice || invoice.environment !== "production" || invoice.state !== "Open") return;
  if (reminder && invoice.remindedAt) return;
  const org = await db.organization.findUnique({ where: { id: invoice.orgId }, select: { name: true } });
  try {
    await mail.send(invoice.subscription.customer.email, {
      ...renderInvoiceEmail({
        merchant: org?.name ?? "Your merchant",
        plan: invoice.subscription.plan.name,
        amount: formatMoney(invoice.amount, invoice.currency),
        due: invoice.dueAt.toUTCString().slice(5, 16),
        url: invoiceUrl(invoice.slug),
        reminder,
      }),
      tag: "subscription-invoice",
      idempotencyKey: `invoice/${invoice.id}/${reminder ? "reminder" : "new"}`,
    });
    if (reminder) await db.subscriptionInvoice.update({ where: { id: invoiceId }, data: { remindedAt: new Date() } });
  } catch (error) {
    console.warn(JSON.stringify({ event: "subscription.invoice_mail_failed", invoiceId, error: String(error).slice(0, 200) }));
  }
}

export function formatMoney(amount: string, currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

// What the hosted invoice page shows.
export async function publicInvoice(slug: string) {
  if (!/^[A-Za-z0-9]{10,20}$/.test(slug)) return null;
  const invoice = await db.subscriptionInvoice.findUnique({
    where: { slug },
    include: { subscription: { include: { plan: true } } },
  });
  if (!invoice || invoice.state === "Void") return null;
  const org = await db.organization.findUnique({ where: { id: invoice.orgId }, select: { name: true } });
  return {
    slug: invoice.slug,
    merchant: org?.name ?? "Merchant",
    ...(await merchantBrand(invoice.orgId)),
    plan: invoice.subscription.plan.name,
    number: invoice.number,
    amount: invoice.amount,
    currency: invoice.currency,
    lines: invoice.lines as { description: string; quantity: string; unitAmount: string; amount: string }[],
    state: invoice.state,
    periodStart: invoice.periodStart,
    periodEnd: invoice.periodEnd,
    dueAt: invoice.dueAt,
    environment: invoice.environment,
    crypto: invoice.subscription.plan.crypto && invoice.currency === "USD",
  };
}

// The customer pressed Pay: reuse the invoice's open checkout, or open one.
export async function startInvoiceCheckout(slug: string, visitor: { ip: string; country?: string | null }) {
  await rateLimit(`invoice-pay:${slug}:${visitor.ip}`, 20);
  const invoice = await db.subscriptionInvoice.findUnique({
    where: { slug },
    include: { subscription: { include: { plan: true } } },
  });
  if (!invoice || invoice.state !== "Open") throw new PortalError("INVOICE_NOT_PAYABLE", 409);
  if (invoice.checkoutPath && invoice.checkoutExpiresAt && invoice.checkoutExpiresAt.getTime() > Date.now() + 120000)
    return `${origin()}${invoice.checkoutPath}`;
  const plan = invoice.subscription.plan;
  const on = await linkMethodsOn(invoice.orgId, invoice.environment);
  const methods = (plan.methods as string[]).filter((m) => on.has(m));
  const crypto = plan.crypto && invoice.currency === "USD" ? await cryptoOptions(invoice.orgId, invoice.environment) : [];
  if (!methods.length && !crypto.length) throw new PortalError("INVOICE_PAYMENT_NOT_AVAILABLE", 409);
  const config = await db.merchantConfig.findUnique({ where: { orgId: invoice.orgId }, select: { country: true } });
  const country = visitor.country && /^[A-Z]{2}$/.test(visitor.country) && visitor.country !== "XX" ? visitor.country : config?.country ?? "US";
  const checkout = await createUniversalCheckout(invoice.orgId, invoice.environment, `invoice-${invoice.id}-${randomUUID().slice(0, 12)}`, {
    reference: `Invoice ${invoice.number} · ${plan.name}`.slice(0, 100),
    payerCountry: country,
    amount: invoice.amount,
    currency: invoice.currency,
    methods,
    ...(crypto.length ? { crypto: { options: crypto } } : {}),
    returnUrl: invoiceUrl(invoice.slug),
    metadata: { subscription_invoice: invoice.id },
  });
  await db.subscriptionInvoice.update({
    where: { id: invoice.id },
    data: { checkoutPath: checkout.checkoutPath, checkoutExpiresAt: new Date(checkout.expiresAt) },
  });
  return `${origin()}${checkout.checkoutPath}`;
}

// ---------- Dashboard ----------

// Dashboard commands, as the signed-in merchant in its current environment.
export async function subscriptionCommand(raw: { action?: string; orgId?: unknown; id?: unknown; input?: unknown }, headers: Headers) {
  const orgId = z.string().min(1).parse(raw.orgId);
  const { config, session } = await merchantMember(orgId, "configure", headers);
  const scope = { orgId, environment: config.environment };
  const actor = session.user.id;
  const id = () => z.string().min(1).max(100).parse(raw.id);
  if (raw.action === "subscription-plan") return createPlan(scope, raw.input, actor);
  if (raw.action === "subscription-plan-active") return setPlanActive(scope, id(), z.boolean().parse(raw.input), actor);
  if (raw.action === "subscription-create") return createSubscription(scope, raw.input, actor);
  if (raw.action === "subscription-cancel") return cancelSubscription(scope, id(), raw.input ?? {}, actor);
  if (raw.action === "subscription-usage") return recordUsage(scope, id(), raw.input, `dashboard-${randomUUID()}`);
  if (raw.action === "subscription-advance") return advanceTestPeriod(scope, id());
  throw new PortalError("UNKNOWN_ACTION", 400);
}
