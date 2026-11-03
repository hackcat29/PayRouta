Object.assign(process.env,{ NODE_ENV: "test" });
process.env.PAYMENT_TEST_LEGACY_METHODS = "enabled";
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../../lib/portal/db";
import { paymentFixtures } from "../../scripts/payment-fixtures";
import { hash } from "../../lib/payments/contracts";
import { GET, POST } from "../../app/api/v1/[...path]/route";
let orgId: string;
let secret: string;
let keyId: string;
before(async () => {
  if (
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") ||
    process.env.PORTAL_MODE !== "local"
  )
    throw new Error("Requires isolated local fixtures");
  orgId = await paymentFixtures();
  secret = `pr_sandbox_${randomBytes(32).toString("base64url")}`;
  const key = await db.merchantApiKey.create({
    data: {
      orgId,
      environment: "sandbox",
      prefix: secret.slice(0, 22),
      verifier: hash(secret),
      permissions: ["payments:read", "payments:write", "settlements:read"],
    },
  });
  keyId = key.id;
});
after(() => db.$disconnect());
async function call(
  method: string,
  path: string,
  body?: unknown,
  key = randomUUID(),
  env = "sandbox",
) {
  const request = new Request(`http://127.0.0.1:3000/api/v1/${path}`, {
    method,
    headers: {
      authorization: `Bearer ${secret}`,
      "payrouta-environment": env,
      "idempotency-key": key,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return (method === "GET" ? GET : POST)(request, {
    params: Promise.resolve({ path: path.split("?")[0].split("/") }),
  });
}
const fiat = { kind: "fiat", identifier: "NGN", network: "" };
const input = {
  reference: "merchant-contract",
  amount: "100.00",
  asset: fiat,
  precision: 2,
  methods: ["bank-transfer"],
  settlement: fiat,
  returnUrl: "http://127.0.0.1:3000/",
};
test("merchant API: scopes, environments, public projection, idempotency, session retry, pagination and revocation", async () => {
  const key = randomUUID();
  const first = await call("POST", "payment-intents", input, key);
  assert.equal(first.status, 201);
  const payment = await first.json();
  assert.equal(payment.amount, "100.00");
  assert.equal(payment.orgId, undefined);
  assert.equal(payment.key, undefined);
  assert.equal(
    (await (await call("POST", "payment-intents", input, key)).json()).id,
    payment.id,
  );
  assert.equal(
    (await call("POST", "payment-intents", { ...input, amount: "101.00" }, key))
      .status,
    409,
  );
  assert.equal(
    (
      await call(
        "GET",
        `payments/${payment.id}`,
        undefined,
        undefined,
        "production",
      )
    ).status,
    403,
  );
  assert.equal((await call("GET", "configuration")).status, 403);
  assert.equal((await call("GET", "payments/foreign-intent")).status, 404);
  assert.equal((await call("GET", "payments?limit=101")).status, 400);
  const page = await (await call("GET", "payments?limit=1")).json();
  assert.equal(page.data.length, 1);
  assert.equal(
    (await call("GET", "payments?from=2026-09-22&to=2026-09-21")).status,
    400,
  );
  const future = await (
    await call("GET", "payments?from=2099-01-01&to=2099-01-02")
  ).json();
  assert.equal(future.data.length, 0);
  const telemetry = await import("../../lib/merchant/telemetry");
  const metrics = await telemetry.operationalMetrics("sandbox");
  assert.equal(metrics.unbalancedEntries, "0");
  assert.equal(typeof metrics.inbox.pending, "number");
  await db.merchantApiKey.update({
    where: { id: keyId },
    data: {
      permissions: [
        "payments:read",
        "payments:write",
        "settlements:read",
        "configuration:read",
      ],
    },
  });
  const configured = await call("GET", "configuration");
  assert.equal(configured.status, 200);
  const configuration = await configured.json();
  assert.equal(configuration.liveExecutionEnabled, false);
  assert.ok(Array.isArray(configuration.permittedMethods));
  assert.equal(configuration.webhookSecretRef, undefined);
  assert.equal(configuration.providerAllowlist, undefined);
  const sessionKey = randomUUID();
  const s1 = await (
    await call(
      "POST",
      "checkout-sessions",
      { intentId: payment.id },
      sessionKey,
    )
  ).json();
  assert.ok(s1.checkoutPath);
  const s2 = await (
    await call(
      "POST",
      "checkout-sessions",
      { intentId: payment.id },
      sessionKey,
    )
  ).json();
  assert.equal(s1.checkoutPath, s2.checkoutPath);
  const limited = await (
    await call("GET", `checkout-sessions/${s1.id}`)
  ).json();
  assert.equal(limited.verifier, undefined);
  assert.equal(limited.checkoutPath, undefined);
  assert.equal(limited.tokenRef, undefined);
  await db.merchantApiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });
  assert.equal((await call("GET", "payments")).status, 401);
});
test("risk: concurrent reservation admits one intent; hold persists without reservation", async () => {
  const { createIntent } = await import("../../lib/payments/service");
  const { atomic } = await import("../../lib/portal/service");
  const { enforceRisk } = await import("../../lib/merchant/policy");
  const { fingerprint } = await import("../../lib/portal/registry");
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId },
  });
  const asset = `fiat:NGN:`;
  const isolatedOrgId = `risk-test-${randomUUID()}`;
  await db.organization.create({
    data: {
      id: isolatedOrgId,
      name: "Fictional isolated risk test",
      fictional: true,
    },
  });
  await db.merchantConfig.create({
    data: {
      ...config,
      providerAllowlist: config.providerAllowlist as string[],
      swapSettlement: undefined,
      orgId: isolatedOrgId,
      riskPolicy: {},
      application: {},
      liveScope: {},
    },
  });
  const reservationDay = "2099-01-01";
  const now = new Date(`${reservationDay}T00:00:00Z`);
  const values = await Promise.all([
    createIntent(isolatedOrgId, randomUUID(), input),
    createIntent(isolatedOrgId, randomUUID(), input),
  ]);
  try {
    await db.merchantConfig.update({
      where: { orgId: isolatedOrgId },
      data: {
        riskPolicy: {
          version: randomUUID(),
          limits: [{ asset, maximum: "10000", dailyMaximum: "10000" }],
        },
      },
    });
    const outcomes = await Promise.all(
      values.map((i) => atomic((tx) => enforceRisk(tx, i, now, true))),
    );
    assert.equal(outcomes.filter((o) => o.decision === "Allow").length, 1);
    assert.equal(
      await db.merchantReservation.count({
        where: { intentId: { in: values.map((i) => i.id) } },
      }),
      1,
    );
    await db.merchantConfig.update({
      where: { orgId: isolatedOrgId },
      data: {
        riskPolicy: {
          version: randomUUID(),
          limits: [
            {
              asset,
              maximum: "10000",
              dailyMaximum: "100000",
              reviewAbove: "9999",
            },
          ],
        },
      },
    });
    const held = await createIntent(isolatedOrgId, randomUUID(), {
      ...input,
      reference: fingerprint(randomUUID()),
    });
    const outcome = await atomic((tx) => enforceRisk(tx, held, now, true));
    assert.equal(outcome.decision, "Hold for review");
    assert.equal(
      await db.merchantReservation.count({ where: { intentId: held.id } }),
      0,
    );
    assert.equal(
      await db.paymentException.count({
        where: { intentId: held.id, code: "MERCHANT_POLICY_REVIEW" },
      }),
      1,
    );
  } finally {
    await db.merchantConfig.update({
      where: { orgId: isolatedOrgId },
      data: { riskPolicy: config.riskPolicy as object },
    });
  }
});

test("crypto: live with a name, a country, the terms and a clear check; no review or documents", async () => {
  const { cryptoBlockers } = await import("../../lib/merchant/go-live");
  const { acceptMerchantTerms } = await import("../../lib/treasury/verification");
  const { fingerprint, kybProfileSchema } = await import("../../lib/partners/kyb");
  const { atomic, json } = await import("../../lib/portal/service");
  const org = await db.organization.create({ data: { name: `Crypto seller ${randomUUID()}`, fictional: false } });
  await db.merchantConfig.create({ data: { orgId: org.id, returnOrigin: "http://127.0.0.1:3000", country: "NG" } });
  assert.deepEqual(await cryptoBlockers(db, org.id), ["CRYPTO_REQUIREMENTS_DUE", "MERCHANT_SCREENING_REQUIRED"]);
  const profile = kybProfileSchema.parse({ legalName: "Ada Obi", businessType: "individual", country: "NG" });
  await db.merchantKybProfile.create({
    data: { orgId: org.id, version: 1, data: json(profile), fingerprint: fingerprint(profile), createdBy: "test" },
  });
  await atomic((tx) => acceptMerchantTerms(tx, org.id, "test", { ip: "127.0.0.1", userAgent: "test" }));
  assert.deepEqual(await cryptoBlockers(db, org.id), ["MERCHANT_SCREENING_REQUIRED"], "waits for the sanctions check");
  const screened = (verdict: string) =>
    db.merchantScreening.create({
      data: { orgId: org.id, profileVersion: 1, provider: "manual-review", verdict, results: json([]), createdBy: "test" },
    });
  // The merchant's own NEAR Intents account, with no live scope approved.
  const { stablecoinCandidates } = await import("../../lib/payments/stablecoin-routes");
  await db.merchantConfig.update({ where: { orgId: org.id }, data: { environment: "production" } });
  const usdcBase = { kind: "blockchain", network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
  const account = `shop${randomBytes(6).toString("hex")}.near`;
  const owner = await db.intentsAccount.create({
    data: { orgId: org.id, environment: "production", accountId: account, standard: "nep413", proof: json({}), createdBy: "test" },
  });
  await db.integration.create({
    data: {
      orgId: org.id,
      environment: "production",
      version: 1,
      config: json({ mode: "NATIVE", adapter: "near-intents-deposit", environment: "production", network: usdcBase.network, identifier: usdcBase.identifier, account, intentsAccountId: owner.id }),
    },
  });
  assert.equal((await stablecoinCandidates(org.id, "production", usdcBase)).length, 0, "not before the check");
  await screened("clear");
  assert.deepEqual(await cryptoBlockers(db, org.id), [], "no documents, no review");
  assert.equal((await stablecoinCandidates(org.id, "production", usdcBase)).length, 1, "routable without a live scope");
  await screened("match");
  assert.equal((await stablecoinCandidates(org.id, "production", usdcBase)).length, 0);
  assert.deepEqual(await cryptoBlockers(db, org.id), ["MERCHANT_RESTRICTED"]);
  const fictional = await db.organization.create({ data: { name: `Fictional ${randomUUID()}`, fictional: true } });
  assert.deepEqual(await cryptoBlockers(db, fictional.id), ["FICTIONAL_ORGANIZATION"]);
});
