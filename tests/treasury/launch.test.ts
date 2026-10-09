// The launch scope, enforced exactly as on a running server (no legacy test
// switch): fiat checkout is open only through a Live merchant's PayRouta
// platform accounts.
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.PAYMENT_TEST_LEGACY_METHODS;
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { atomic, json } from "../../lib/portal/service";
import { baseProfile } from "../../lib/partners/conformance";
import { fingerprint } from "../../lib/partners/kyb";
import { enforceLaunchScope } from "../../lib/payments/launch";
import { submitMerchantAccount, transitionMerchantAccount } from "../../lib/treasury/merchant-account";
import { acceptMerchantTerms, saveVerificationDetails } from "../../lib/treasury/verification";
import { openPlatformLink, provisionLink } from "../../lib/treasury/links";
import { confirm, createIntent, createSession, customerAction, methods, selectMethod } from "../../lib/payments/service";
import { dispatch, poll } from "../../lib/payments/processing";

let entityId: string;
let platformId: string;
const gbp = { kind: "fiat", identifier: "GBP", network: "" };

before(async () => {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") || process.env.PORTAL_MODE !== "local")
    throw new Error("Requires isolated local fixtures");
  assert.equal(enforceLaunchScope(), true, "this suite runs with the launch scope enforced");
  const entity = await db.legalEntity.create({ data: { name: `PayRouta Launch ${randomUUID()}`, jurisdiction: "US-DE", updatedBy: "test" } });
  entityId = entity.id;
  platformId = (
    await db.platformAccount.create({
      data: {
        legalEntityId: entity.id,
        provider: "sandbox-platform",
        environment: "sandbox",
        custody: "partner-held",
        merchantCountries: json(["GB"]),
        config: json({}),
        enabled: true,
        updatedBy: "test",
      },
    })
  ).id;
});
after(() => db.$disconnect());

async function merchant(live: boolean) {
  const org = await db.organization.create({ data: { name: `Launch test ${randomUUID()}`, fictional: true } });
  await db.merchantConfig.create({ data: { orgId: org.id, returnOrigin: "http://127.0.0.1:3000", environment: "sandbox" } });
  await db.merchantKybProfile.create({
    data: { orgId: org.id, version: 1, data: json(baseProfile), fingerprint: fingerprint(baseProfile), createdBy: "test" },
  });
  await db.merchantScreening.create({
    data: { orgId: org.id, profileVersion: 1, provider: "sandbox-fixture", verdict: "clear", results: json([]), createdBy: "test" },
  });
  const address = { line1: "1 Dock Street", city: "London", postalCode: "E1 1AA", country: "GB" };
  await atomic(async (tx) => {
    await saveVerificationDetails(
      tx,
      org.id,
      {
        businessPhone: "+442071234567",
        representative: { dateOfBirth: "1985-04-12", address },
        owners: baseProfile.owners.map(() => ({ dateOfBirth: "1979-01-30", address })),
        payoutAccount: { country: "GB", currency: "GBP", holderName: baseProfile.legalName, holderType: "company", accountNumber: "GB82WEST12345698765432" },
      },
      baseProfile,
      "test",
    );
    await acceptMerchantTerms(tx, org.id, "test", { ip: "127.0.0.1", userAgent: "test" });
    await submitMerchantAccount(tx, org.id, "sandbox", "test");
  });
  if (!live) return org.id;
  const review = (version: number, to: string, decision?: object) =>
    atomic((tx) =>
      transitionMerchantAccount(tx, { orgId: org.id, environment: "sandbox", expectedVersion: version, to: to as never, reason: `Launch test ${to}`, decision: decision as never }, "ops"),
    );
  await review(1, "Underwriting");
  const link = await atomic((tx) => openPlatformLink(tx, { orgId: org.id, environment: "sandbox", platformAccountId: platformId }, "ops"));
  await provisionLink(link.id);
  await review(2, "Live", {
    legalEntityId: entityId,
    riskTier: "standard",
    terms: {
      reserve: { basisPoints: 0, holdDays: 0 },
      payout: { schedule: "daily", delayDays: 0 },
      taxMode: "merchant-seller",
      limits: { currency: "GBP", maximumMinor: "500000", dailyMaximumMinor: "5000000" },
    },
  });
  return org.id;
}

const fiatIntent = (orgId: string, methodList: string[]) =>
  createIntent(orgId, `launch-${randomUUID()}`, {
    reference: `order-${randomUUID().slice(0, 8)}`,
    amount: "25.00",
    asset: gbp,
    precision: 2,
    methods: methodList,
    settlement: gbp,
    returnUrl: "http://127.0.0.1:3000/done",
  });

test("launch scope: a Live merchant's platform rails take card payments end to end", async () => {
  const orgId = await merchant(true);
  const intent = await fiatIntent(orgId, ["card"]);
  const s = await createSession(orgId, intent.id);
  const offered = await methods(s.sessionId, s.token);
  assert.deepEqual(
    offered.methods.map((m: { method: string; status: string }) => [m.method, m.status]),
    [["card", "AVAILABLE"]],
  );
  const route = await selectMethod(s.sessionId, s.token, "card");
  const { attemptId } = await confirm(s.sessionId, s.token, route.routeId);
  assert.match((await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId! } })).profileId, /^platform:/);
  await dispatch(attemptId!);
  await customerAction(s.sessionId, s.token);
  await poll(attemptId!);
  assert.equal((await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).state, "Confirmed");
});

test("launch scope: fiat stays closed without a Live merchant or for methods no platform offers", async () => {
  const pending = await merchant(false);
  await assert.rejects(fiatIntent(pending, ["card"]), /PAYMENT_METHOD_COMING_SOON/);
  const live = await merchant(true);
  // The sandbox platform offers card and bank transfer only.
  await assert.rejects(fiatIntent(live, ["card", "mobile-money"]), /PAYMENT_METHOD_COMING_SOON/);
  await assert.rejects(
    createIntent(live, `launch-${randomUUID()}`, {
      reference: "order-x",
      amount: "25.00",
      asset: gbp,
      precision: 2,
      methods: ["card"],
      settlement: gbp,
      returnUrl: "http://127.0.0.1:3000/done",
      scenario: "fallback",
    }),
    /SCENARIO_NOT_SUPPORTED/,
    "simulator scenarios stay closed",
  );
});
