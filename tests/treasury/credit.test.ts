// Credit at checkout under the launch scope, exactly as on a running server:
// a Live merchant with a card rail and a (fictional) lender. The customer
// sees the lender's plans, must choose one, and the lender is paid out on the
// chosen plan.
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.PAYMENT_TEST_LEGACY_METHODS;
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { enforceLaunchScope } from "../../lib/payments/launch";
import { liveMerchant as liveMerchantFixture, sandboxEntity } from "../fixtures/live-merchant";
import {
  confirm,
  createIntent,
  createSession,
  creditOffers,
  customerAction,
  methods,
  selectMethod,
} from "../../lib/payments/service";
import { dispatch, poll } from "../../lib/payments/processing";

let entityId: string;
let cardId: string;
let lenderId: string;
const gbp = { kind: "fiat", identifier: "GBP", network: "" };

before(async () => {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") || process.env.PORTAL_MODE !== "local")
    throw new Error("Requires isolated local fixtures");
  assert.equal(enforceLaunchScope(), true);
  const setup = await sandboxEntity("Credit", ["sandbox-platform", "sandbox-credit"]);
  entityId = setup.entityId;
  cardId = setup.accounts["sandbox-platform"];
  lenderId = setup.accounts["sandbox-credit"];
});
after(() => db.$disconnect());

const liveMerchant = (withLender = true) =>
  liveMerchantFixture(entityId, withLender ? [cardId, lenderId] : [cardId]);

const creditIntent = (orgId: string, reference = `order-${randomUUID().slice(0, 8)}`) =>
  createIntent(orgId, `credit-${randomUUID()}`, {
    reference,
    payerCountry: "GB",
    amount: "120.00",
    asset: gbp,
    precision: 2,
    methods: ["card", "bnpl"],
    settlement: gbp,
    returnUrl: "http://127.0.0.1:3000/done",
  });

test("credit: the customer sees the lender's plans and pays on the chosen one", async () => {
  const orgId = await liveMerchant();
  const intent = await creditIntent(orgId);
  const s = await createSession(orgId, intent.id);
  const offered = await methods(s.sessionId, s.token);
  assert.deepEqual(
    offered.methods.map((m: { method: string; status: string }) => [m.method, m.status]),
    [["card", "AVAILABLE"], ["bnpl", "AVAILABLE"]],
  );
  const { offers } = await creditOffers(s.sessionId, s.token);
  assert.deepEqual(offers.map((o) => o.id), ["sbxc-p4", "sbxc-pl30", "sbxc-m3"]);
  const m3 = offers.find((o) => o.id === "sbxc-m3")!;
  assert.equal(m3.lender, "Sandbox Credit (fictional lender)");
  assert.equal(m3.totalMinor, "12540");
  assert.equal(m3.currency, "GBP");
  assert.ok(!("profileId" in m3), "route profiles never reach the customer");

  await assert.rejects(selectMethod(s.sessionId, s.token, "bnpl"), /CREDIT_PLAN_REQUIRED/);
  await assert.rejects(selectMethod(s.sessionId, s.token, "bnpl", new Date(), "0000000000.sbxc-m3"), /CREDIT_PLAN_NO_LONGER_OFFERED/);
  const route = await selectMethod(s.sessionId, s.token, "bnpl", new Date(), m3.key);
  assert.equal(route.credit?.id, "sbxc-m3");
  const stored = await db.paymentRoute.findUniqueOrThrow({ where: { id: route.routeId } });
  assert.equal((stored.snapshot as { credit: { offerId: string } }).credit.offerId, "sbxc-m3");
  const lenderLink = await db.merchantPlatformLink.findFirstOrThrow({ where: { orgId, platformAccountId: lenderId } });
  assert.equal(stored.profileId, `platform:${lenderLink.id}`);

  const { attemptId } = await confirm(s.sessionId, s.token, route.routeId);
  await dispatch(attemptId!);
  const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId! } });
  assert.equal(attempt.state, "Requires action");
  assert.equal((attempt.action as { kind: string }).kind, "sandbox");
  await customerAction(s.sessionId, s.token);
  await poll(attemptId!);
  assert.equal((await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).state, "Confirmed");
});

test("credit: a lender's decline leaves the checkout open for another method", async () => {
  const orgId = await liveMerchant();
  const intent = await creditIntent(orgId, "order-[decline]");
  const s = await createSession(orgId, intent.id);
  await methods(s.sessionId, s.token);
  const { offers } = await creditOffers(s.sessionId, s.token);
  const route = await selectMethod(s.sessionId, s.token, "bnpl", new Date(), offers[0].key);
  const { attemptId } = await confirm(s.sessionId, s.token, route.routeId);
  await dispatch(attemptId!);
  assert.equal((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId! } })).state, "Rejected");
  assert.equal((await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).state, "Open");
});

test("credit: without a lender, credit is not offered and has no plans", async () => {
  const orgId = await liveMerchant(false);
  await assert.rejects(creditIntent(orgId), /PAYMENT_METHOD_COMING_SOON/);
});
