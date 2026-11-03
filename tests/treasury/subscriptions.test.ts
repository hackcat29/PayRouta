// Subscriptions end to end against PostgreSQL: subscribe, pay the first
// invoice through checkout, record usage, renew, go past due, cancel.
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.PAYMENT_TEST_LEGACY_METHODS;
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/portal/db";
import { enforceLaunchScope } from "../../lib/payments/launch";
import { confirm, customerAction, methods, selectMethod } from "../../lib/payments/service";
import { dispatch, poll } from "../../lib/payments/processing";
import { workOnce } from "../../lib/portal/worker";
import {
  advanceTestPeriod,
  cancelSubscription,
  createPlan,
  createSubscription,
  getSubscription,
  overdue,
  publicInvoice,
  recordUsage,
  renew,
  startInvoiceCheckout,
} from "../../lib/subscriptions/service";
import { liveMerchant, sandboxEntity } from "../fixtures/live-merchant";

let scope: { orgId: string; environment: string };

before(async () => {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") || process.env.PORTAL_MODE !== "local")
    throw new Error("Requires isolated local fixtures");
  assert.equal(enforceLaunchScope(), true);
  const { entityId, accounts } = await sandboxEntity("Subscriptions", ["sandbox-platform"]);
  const orgId = await liveMerchant(entityId, [accounts["sandbox-platform"]], "GBP");
  scope = { orgId, environment: "sandbox" };
});
after(() => db.$disconnect());

// Pays an invoice as a customer would: Pay, card, complete the test payment.
async function payInvoice(slug: string) {
  const url = new URL(await startInvoiceCheckout(slug, { ip: "203.0.113.9", country: "GB" }));
  const id = url.pathname.split("/")[2];
  const token = url.hash.slice(1);
  await methods(id, token);
  const route = await selectMethod(id, token, "card");
  const { attemptId } = await confirm(id, token, route.routeId);
  await dispatch(attemptId!);
  await customerAction(id, token);
  await poll(attemptId!);
  const invoice = await db.subscriptionInvoice.findUniqueOrThrow({ where: { slug } });
  // The payment.confirmed event queues the invoice's paid job.
  const job = await db.job.findFirstOrThrow({ where: { kind: "subscription-paid", key: { startsWith: `subscription-paid:${invoice.id}:` } } });
  await workOnce(job.key);
}

const plan = () =>
  createPlan(
    scope,
    {
      name: "Studio",
      amount: "20",
      currency: "GBP",
      interval: "month",
      methods: ["card"],
      meters: [{ key: "renders", name: "Renders", unitAmount: "0.5", includedUnits: "10" }],
    },
    "test",
  );

test("subscriptions: the first invoice activates it; each renewal bills the next period and the last period's usage", async () => {
  const p = await plan();
  const sub = await createSubscription(scope, { plan: p.id, customer: { email: "Ada@Example.com", name: "Ada" } }, "test");
  assert.equal(sub.state, "Incomplete");
  assert.equal(sub.customer.email, "ada@example.com");
  assert.equal(sub.latestInvoice?.amount, "20.00");
  const slug = sub.latestInvoice!.url.split("/").pop()!;
  assert.equal((await publicInvoice(slug))?.state, "Open");

  // Reopening the page reuses the open checkout.
  const a = await startInvoiceCheckout(slug, { ip: "203.0.113.8" });
  assert.equal(await startInvoiceCheckout(slug, { ip: "203.0.113.8" }), a);

  await payInvoice(slug);
  let s = await getSubscription(scope, sub.id);
  assert.equal(s.state, "Active");
  assert.equal(s.invoices[0].state, "Paid");
  assert.ok(s.invoices[0].paymentId);
  await assert.rejects(startInvoiceCheckout(slug, { ip: "203.0.113.8" }), /INVOICE_NOT_PAYABLE/);

  // Usage: idempotent by key; unknown meters refused.
  const first = await recordUsage(scope, sub.id, { meter: "renders", quantity: "14" }, "usage-key-0001");
  assert.equal((await recordUsage(scope, sub.id, { meter: "renders", quantity: "14" }, "usage-key-0001")).id, first.id);
  await recordUsage(scope, sub.id, { meter: "renders", quantity: "2", idempotencyKey: "usage-key-0002" });
  await assert.rejects(recordUsage(scope, sub.id, { meter: "seats", quantity: "1" }, "usage-key-0003"), /SUBSCRIPTION_METER_UNKNOWN/);
  await assert.rejects(recordUsage(scope, sub.id, { meter: "renders", quantity: "1" }), /IDEMPOTENCY_KEY_REQUIRED/);
  assert.equal((await getSubscription(scope, sub.id)).usageThisPeriod[0].quantity, "16");

  // Renewal: £20 for the next period + (16 - 10) × £0.50 for the last.
  s = await advanceTestPeriod(scope, sub.id);
  const renewal = s.invoices[0];
  assert.equal(renewal.number, 2);
  assert.deepEqual(
    renewal.lines.map((l) => [l.description, l.amount]),
    [
      ["Studio", "20.00"],
      ["Renders", "3.00"],
    ],
  );
  assert.equal(renewal.amount, "23.00");
  assert.equal(s.currentPeriodStart, sub.currentPeriodEnd);
  assert.equal(s.usageThisPeriod[0].quantity, "0", "usage starts over");
  // A stale renewal job for the old period does nothing.
  await renew(sub.id, sub.currentPeriodEnd);
  assert.equal((await getSubscription(scope, sub.id)).invoices.length, 2);

  // Unpaid past its due date: past due, and cancelled at the next renewal.
  await db.subscriptionInvoice.update({ where: { id: renewal.id }, data: { dueAt: new Date(Date.now() - 1000) } });
  await overdue(renewal.id);
  assert.equal((await getSubscription(scope, sub.id)).state, "PastDue");
  s = await advanceTestPeriod(scope, sub.id);
  assert.equal(s.state, "Canceled");
  assert.equal(s.invoices.find((i) => i.id === renewal.id)?.state, "Void", "unpaid invoices of a cancelled subscription are voided");
  const events = await db.merchantEvent.findMany({ where: { orgId: scope.orgId, intentId: sub.id }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(
    events.map((e) => e.type),
    ["subscription.created", "subscription.active", "subscription.past_due", "subscription.canceled"],
  );
  assert.equal((events.at(-1)!.payload as { reason: string }).reason, "unpaid");
});

test("subscriptions: cancelling now invoices the usage so far; at period end, after the final usage invoice", async () => {
  const p = await createPlan(
    scope,
    { name: "Usage", amount: "0", currency: "GBP", interval: "month", methods: ["card"], meters: [{ key: "calls", name: "Calls", unitAmount: "0.01" }] },
    "test",
  );
  const now = await createSubscription(scope, { plan: p.id, customer: { email: "now@example.com" } }, "test");
  assert.equal(now.state, "Active", "usage-only plans start active");
  assert.equal(now.latestInvoice, null);
  await recordUsage(scope, now.id, { meter: "calls", quantity: "250" }, "calls-now-0001");
  const canceled = await cancelSubscription(scope, now.id, {}, "test");
  assert.equal(canceled.state, "Canceled");
  assert.equal(canceled.latestInvoice?.amount, "2.50");
  assert.equal(canceled.latestInvoice?.state, "Open", "the final usage invoice stays payable");
  await assert.rejects(recordUsage(scope, now.id, { meter: "calls", quantity: "1" }, "calls-now-0002"), /SUBSCRIPTION_CANCELED/);

  const later = await createSubscription(scope, { plan: p.id, customer: { email: "later@example.com" } }, "test");
  await recordUsage(scope, later.id, { meter: "calls", quantity: "100" }, "calls-later-01");
  const scheduled = await cancelSubscription(scope, later.id, { atPeriodEnd: true }, "test");
  assert.equal(scheduled.state, "Active");
  assert.equal(scheduled.cancelAtPeriodEnd, true);
  const ended = await advanceTestPeriod(scope, later.id);
  assert.equal(ended.state, "Canceled");
  assert.equal(ended.invoices[0].amount, "1.00");
  assert.equal(ended.invoices.length, 1, "no new period is billed");
});

test("subscriptions: plans only offer ways to pay that are on, and tenants stay apart", async () => {
  await assert.rejects(
    createPlan(scope, { name: "x", amount: "5", currency: "GBP", interval: "month", methods: ["mobile-money"] }, "test"),
    /PAYMENT_LINK_METHOD_NOT_ON/,
  );
  await assert.rejects(
    createPlan(scope, { name: "x", amount: "5", currency: "GBP", interval: "month", crypto: true }, "test"),
    /PAYMENT_LINK_CRYPTO_REQUIRES_USD/,
  );
  const p = await plan();
  const sub = await createSubscription(scope, { plan: p.id, customer: { email: "tenant@example.com" } }, "test");
  const other = { orgId: "another-merchant", environment: "sandbox" };
  await assert.rejects(getSubscription(other, sub.id), /NOT_FOUND/);
  await assert.rejects(createSubscription(other, { plan: p.id, customer: { email: "x@example.com" } }, "test"), /SUBSCRIPTION_PLAN_NOT_FOUND/);
  await assert.rejects(advanceTestPeriod({ ...scope, environment: "production" }, sub.id), /SANDBOX_ONLY/);
});
