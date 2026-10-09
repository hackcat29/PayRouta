Object.assign(process.env,{ NODE_ENV: "test" });
process.env.PAYMENT_TEST_LEGACY_METHODS = "enabled";
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { secretManager } from "../../lib/portal/adapters";
import { json } from "../../lib/portal/service";
import { signature } from "../../lib/payments/contracts";
import { baseProfile } from "../../lib/partners/conformance";
import { fingerprint, type KybProfile } from "../../lib/partners/kyb";
import {
  disclosure,
  processEvent,
  provision,
  refreshStatus,
  sweepPartners,
} from "../../lib/partners/service";
import {
  confirm,
  createIntent,
  createSession,
  customerAction,
  methods,
  refreshAttempt,
  selectMethod,
} from "../../lib/payments/service";
import { dispatch, poll } from "../../lib/payments/processing";
import { databaseSecretStore, rotateSecrets } from "../../lib/portal/secret-store";
import { POST as eventRoute } from "../../app/api/partners/[partnerId]/events/[environment]/route";

let webhookSecret: string;

before(async () => {
  if (
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") ||
    process.env.PORTAL_MODE !== "local"
  )
    throw new Error("Requires isolated local fixtures");
  webhookSecret = `sbx-${randomUUID()}`;
  const ref = await secretManager.put(webhookSecret);
  await connection({ reviewSeconds: 3600, webhookSecretRef: ref });
});
after(() => db.$disconnect());

async function connection(config: Record<string, unknown>) {
  const existing = await db.partnerConnection.findUnique({
    where: { partnerId_environment: { partnerId: "sandbox", environment: "sandbox" } },
  });
  const merged = { ...((existing?.config as object) ?? {}), ...config };
  await db.partnerConnection.upsert({
    where: { partnerId_environment: { partnerId: "sandbox", environment: "sandbox" } },
    create: { partnerId: "sandbox", environment: "sandbox", config: json(merged), enabled: true, updatedBy: "test" },
    update: { config: json(merged), enabled: true },
  });
}

// A fictional merchant with a saved profile, consent and queued application,
// exactly as requestPartnerAccounts would leave them.
async function merchant(profile: KybProfile = baseProfile, opts: { staleConsent?: boolean } = {}) {
  const org = await db.organization.create({ data: { name: `Partner test ${randomUUID()}`, fictional: true } });
  await db.merchantConfig.create({
    data: { orgId: org.id, returnOrigin: "http://127.0.0.1:3000", environment: "sandbox" },
  });
  const saved = await db.merchantKybProfile.create({
    data: { orgId: org.id, version: 1, data: json(profile), fingerprint: fingerprint(profile), createdBy: "test" },
  });
  const d = disclosure("sandbox", 1, saved.fingerprint);
  const consent = await db.partnerConsent.create({
    data: {
      orgId: org.id,
      partnerId: "sandbox",
      environment: "sandbox",
      profileVersion: 1,
      fields: json(d.fields),
      disclosureFingerprint: opts.staleConsent ? "0".repeat(64) : d.fingerprint,
      grantedBy: "test",
    },
  });
  const application = await db.partnerApplication.create({
    data: { orgId: org.id, partnerId: "sandbox", environment: "sandbox", consentId: consent.id, profileVersion: 1 },
  });
  return { orgId: org.id, consentId: consent.id, applicationId: application.id, profileId: saved.id };
}

test("provisioning screens, discloses only declared fields, and records evidence", async () => {
  await connection({ reviewSeconds: 3600 });
  const m = await merchant();
  await provision(m.applicationId);
  const a = await db.partnerApplication.findUniqueOrThrow({ where: { id: m.applicationId } });
  assert.equal(a.state, "Action required");
  assert.match(a.accountRef ?? "", /^sbx_ok_/);
  assert.deepEqual(a.requirements, ["complete-hosted-onboarding"]);
  assert.equal(a.integrationId, null);
  const screening = await db.merchantScreening.findFirstOrThrow({ where: { orgId: m.orgId } });
  assert.equal(screening.verdict, "clear");
  assert.equal(screening.provider, "sandbox-fixture");
  const submitted = await db.audit.findFirstOrThrow({
    where: { orgId: m.orgId, action: "partner.application.submitted" },
  });
  const meta = submitted.metadata as { fields: string[]; disclosedFingerprint: string };
  assert.deepEqual(meta.fields, ["businessType", "country", "legalName", "representative", "supportEmail", "website"]);
  assert.equal(meta.disclosedFingerprint, a.disclosedFingerprint);
  // Provisioning is idempotent once the application has left the queue.
  await provision(m.applicationId);
  assert.equal((await db.partnerApplication.findUniqueOrThrow({ where: { id: m.applicationId } })).accountRef, a.accountRef);
});

test("approval re-read from the provider binds a merchant-owned integration once", async () => {
  await connection({ reviewSeconds: 3600 });
  const m = await merchant();
  await provision(m.applicationId);
  await connection({ reviewSeconds: 0 });
  await refreshStatus(m.applicationId);
  await refreshStatus(m.applicationId);
  const a = await db.partnerApplication.findUniqueOrThrow({ where: { id: m.applicationId } });
  assert.equal(a.state, "Approved");
  assert.ok(a.approvedAt && a.integrationId);
  const integrations = await db.integration.findMany({ where: { orgId: m.orgId } });
  assert.equal(integrations.length, 1);
  assert.deepEqual(integrations[0].config, {
    adapter: "sandbox",
    mode: "PARTNER",
    ownership: "merchant",
    accountId: a.providerAccountId,
    partnerApplicationId: a.id,
  });
  assert.ok(await db.notification.findFirst({ where: { orgId: m.orgId, message: "Sandbox partner: Approved" } }));
});

test("provider rejection is recorded without binding", async () => {
  await connection({ reviewSeconds: 0 });
  const m = await merchant({ ...baseProfile, legalName: "Harbor [reject] Ltd" });
  await provision(m.applicationId);
  const a = await db.partnerApplication.findUniqueOrThrow({ where: { id: m.applicationId } });
  assert.equal(a.state, "Rejected");
  assert.equal(a.integrationId, null);
});

test("screening match stops disclosure; review holds until a manual decision", async () => {
  const flagged = await merchant({
    ...baseProfile,
    owners: [{ givenName: "Flagged", familyName: "[sanctioned]", country: "GB", ownershipPercent: 100 }],
  });
  await provision(flagged.applicationId);
  let a = await db.partnerApplication.findUniqueOrThrow({ where: { id: flagged.applicationId } });
  assert.equal(a.state, "Failed");
  assert.equal(a.reason, "PAYROUTA_SCREENING_MATCH");
  assert.equal(a.accountRef, null);
  const audit = await db.audit.findFirstOrThrow({
    where: { orgId: flagged.orgId, action: "partner.application.failed" },
  });
  assert.equal(audit.internal, true);

  await connection({ reviewSeconds: 3600 });
  const held = await merchant({ ...baseProfile, tradingName: "Harbor [review]" });
  await provision(held.applicationId);
  a = await db.partnerApplication.findUniqueOrThrow({ where: { id: held.applicationId } });
  assert.equal(a.state, "Queued");
  assert.equal(a.reason, "PAYROUTA_SCREENING_REVIEW");
  await db.merchantScreening.create({
    data: { orgId: held.orgId, profileVersion: 1, provider: "manual-review", verdict: "clear", results: json([]), createdBy: "test" },
  });
  await provision(held.applicationId);
  a = await db.partnerApplication.findUniqueOrThrow({ where: { id: held.applicationId } });
  assert.equal(a.state, "Action required");
});

test("revoked or outdated consent prevents any disclosure", async () => {
  const revoked = await merchant();
  await db.partnerConsent.update({ where: { id: revoked.consentId }, data: { revokedAt: new Date(), revokedBy: "test" } });
  await provision(revoked.applicationId);
  let a = await db.partnerApplication.findUniqueOrThrow({ where: { id: revoked.applicationId } });
  assert.equal(a.state, "Disconnected");
  assert.equal(a.accountRef, null);

  const stale = await merchant(baseProfile, { staleConsent: true });
  await provision(stale.applicationId);
  a = await db.partnerApplication.findUniqueOrThrow({ where: { id: stale.applicationId } });
  assert.equal(a.state, "Failed");
  assert.equal(a.reason, "CONSENT_OUTDATED");
  assert.equal(await db.merchantScreening.count({ where: { orgId: stale.orgId } }), 0);
});

test("profiles, screenings and consents cannot be rewritten", async () => {
  const m = await merchant();
  await provision(m.applicationId);
  await assert.rejects(db.merchantKybProfile.update({ where: { id: m.profileId }, data: { createdBy: "x" } }), /immutable/);
  await assert.rejects(db.merchantKybProfile.delete({ where: { id: m.profileId } }), /immutable/);
  await assert.rejects(db.merchantScreening.updateMany({ where: { orgId: m.orgId }, data: { verdict: "match" } }), /immutable/);
  await assert.rejects(db.partnerConsent.update({ where: { id: m.consentId }, data: { fields: json(["taxId"]) } }), /revoked once/);
  await db.partnerConsent.update({ where: { id: m.consentId }, data: { revokedAt: new Date(), revokedBy: "test" } });
  await assert.rejects(
    db.partnerConsent.update({ where: { id: m.consentId }, data: { revokedAt: new Date(), revokedBy: "again" } }),
    /revoked once/,
  );
  await assert.rejects(db.partnerConsent.delete({ where: { id: m.consentId } }), /immutable/);
});

test("signed events are deduplicated and only queue an authenticated re-read", async () => {
  await connection({ reviewSeconds: 3600 });
  const m = await merchant();
  await provision(m.applicationId);
  const a = await db.partnerApplication.findUniqueOrThrow({ where: { id: m.applicationId } });
  const eventId = `evt_${randomUUID()}`;
  const send = (body: string, sig?: string) => {
    const ts = String(Math.floor(Date.now() / 1000));
    return eventRoute(
      new Request("http://127.0.0.1:3000/api/partners/sandbox/events/sandbox", {
        method: "POST",
        headers: {
          "payrouta-event-id": eventId,
          "payrouta-timestamp": ts,
          "payrouta-signature": sig ?? signature(webhookSecret, ts, eventId, body),
        },
        body,
      }),
      { params: Promise.resolve({ partnerId: "sandbox", environment: "sandbox" }) },
    );
  };
  const body = JSON.stringify({ type: "account.updated", accountRef: a.accountRef });
  assert.equal((await send(body, "f".repeat(64))).status, 401);
  const first = await send(body);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { accepted: true });
  assert.deepEqual(await (await send(body)).json(), { accepted: true, duplicate: true });
  assert.equal((await send(body.replace("updated", "changed"))).status, 409);

  const row = await db.partnerEvent.findFirstOrThrow({ where: { eventId } });
  await processEvent(row.id);
  assert.equal((await db.partnerEvent.findUniqueOrThrow({ where: { id: row.id } })).state, "Processed");
  assert.ok(await db.job.findUnique({ where: { key: `partner-status:${a.id}:event:${row.id}` } }));
  // The event itself changed nothing.
  assert.equal((await db.partnerApplication.findUniqueOrThrow({ where: { id: a.id } })).state, "Action required");
});

test("sweep queues re-reads for open applications", async () => {
  await connection({ reviewSeconds: 3600 });
  const m = await merchant();
  await provision(m.applicationId);
  // The sweep takes the oldest 100 eligible applications first; make this one
  // the oldest so the test does not depend on what else is in the database.
  await db.partnerApplication.update({
    where: { id: m.applicationId },
    data: { lastCheckedAt: new Date(Date.now() - 3600000), updatedAt: new Date(0) },
  });
  const now = new Date();
  assert.ok((await sweepPartners(now)) >= 1);
  assert.ok(
    await db.job.findUnique({
      where: { key: `partner-status:${m.applicationId}:sweep:${Math.floor(now.getTime() / 600000)}` },
    }),
  );
});

// ---------------------------------------------------------------------------
// Payments through a merchant-owned partner account (fictional sandbox partner)

async function approvedMerchant() {
  await connection({ reviewSeconds: 0 });
  const m = await merchant();
  await provision(m.applicationId);
  const a = await db.partnerApplication.findUniqueOrThrow({ where: { id: m.applicationId } });
  assert.equal(a.state, "Approved");
  assert.ok(a.integrationId && a.paymentsEnabled);
  return m;
}

async function checkout(orgId: string, amount: string, currency: string, precision: number) {
  const fiat = { kind: "fiat", identifier: currency, network: "" };
  const intent = await createIntent(orgId, `partner-pay-${randomUUID()}`, {
    reference: `order-${randomUUID().slice(0, 8)}`,
    amount,
    asset: fiat,
    precision,
    methods: ["card"],
    settlement: fiat,
    returnUrl: "http://127.0.0.1:3000/done",
  });
  const s = await createSession(orgId, intent.id);
  return { intent, s };
}

test("a payment runs on the merchant's own partner account, end to end", async () => {
  const m = await approvedMerchant();
  const { intent, s } = await checkout(m.orgId, "25.00", "GBP", 2);
  const offered = await methods(s.sessionId, s.token);
  const card = offered.methods.find((x) => x.method === "card");
  assert.equal(card?.status, "AVAILABLE");
  assert.equal(card?.explanation, "Through your Sandbox partner account");
  const route = await selectMethod(s.sessionId, s.token, "card");
  assert.equal(route.providerFeeMinor, null, "PayRouta quotes no fee for the merchant's own contract");
  const { attemptId } = await confirm(s.sessionId, s.token, route.routeId);
  const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId! } });
  assert.equal(attempt.providerOrgId, m.orgId, "executes in the merchant's own organisation");
  assert.match(attempt.profileId, /^partner:/);

  await dispatch(attemptId!);
  let a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId! } });
  assert.equal(a.state, "Requires action");
  assert.equal((a.action as { kind: string; provider: string }).kind, "sandbox");
  assert.equal((a.action as { provider: string }).provider, "Sandbox partner");

  assert.deepEqual(await refreshAttempt(s.sessionId, s.token), { queued: true });
  await customerAction(s.sessionId, s.token);
  await poll(attemptId!);
  a = await db.paymentAttempt.findUniqueOrThrow({ where: { id: attemptId! } });
  assert.equal(a.state, "Confirmed");
  assert.equal((await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } })).state, "Confirmed");
  assert.equal(await db.job.count({ where: { key: `settle:${attemptId}` } }), 0, "the provider settles directly");
  assert.equal(await db.journalEntry.count({ where: { source: `payment:${intent.id}` } }), 1);
});

test("an amount whose precision does not match its currency never reaches a provider", async () => {
  const m = await approvedMerchant();
  // JPY has no minor unit; "100.00" at precision 2 is refused at intent
  // creation. Partner adapters refuse it again independently (conformance).
  await assert.rejects(checkout(m.orgId, "100.00", "JPY", 2), /AMOUNT_PRECISION_INVALID/);
  assert.equal(await db.paymentIntent.count({ where: { orgId: m.orgId } }), 0);
});

test("a revoked partner account stops being offered at checkout", async () => {
  const m = await approvedMerchant();
  await db.partnerApplication.update({
    where: { id: m.applicationId },
    data: { state: "Disconnected" },
  });
  const { s } = await checkout(m.orgId, "25.00", "GBP", 2);
  const offered = await methods(s.sessionId, s.token);
  assert.notEqual(offered.methods.find((x) => x.method === "card")?.status, "AVAILABLE");
  await assert.rejects(selectMethod(s.sessionId, s.token, "card"), /NOT_AVAILABLE/);
});

test("database secret store: envelope encryption, reference binding, revocation", async () => {
  const saved = { keys: process.env.SECRET_MASTER_KEYS, active: process.env.SECRET_ACTIVE_KEY_ID };
  process.env.SECRET_MASTER_KEYS = `t1:${randomBytes(32).toString("base64")}`;
  delete process.env.SECRET_ACTIVE_KEY_ID;
  try {
    const a = await databaseSecretStore.put("first-secret-value");
    const b = await databaseSecretStore.put("second-secret-value");
    assert.equal(await databaseSecretStore.get(a), "first-secret-value");
    const rowA = await db.secret.findUniqueOrThrow({ where: { id: a } });
    assert.equal(Buffer.from(rowA.ciphertext!).toString("utf8").includes("first"), false);
    // Swapping ciphertext between references fails the integrity check.
    await db.secret.update({ where: { id: b }, data: { iv: rowA.iv, tag: rowA.tag, ciphertext: rowA.ciphertext } });
    await assert.rejects(databaseSecretStore.get(b), /integrity/);
    await databaseSecretStore.revoke(a);
    await assert.rejects(databaseSecretStore.get(a), /revoked/);
    // Rotation re-encrypts live secrets under the new active key.
    const c = await databaseSecretStore.put("third-secret-value");
    process.env.SECRET_MASTER_KEYS += `,t2:${randomBytes(32).toString("base64")}`;
    process.env.SECRET_ACTIVE_KEY_ID = "t2";
    await db.secret.delete({ where: { id: b } });
    assert.ok((await rotateSecrets()) >= 1);
    assert.equal((await db.secret.findUniqueOrThrow({ where: { id: c } })).keyId, "t2");
    assert.equal(await databaseSecretStore.get(c), "third-secret-value");
  } finally {
    process.env.SECRET_MASTER_KEYS = saved.keys;
    if (saved.active) process.env.SECRET_ACTIVE_KEY_ID = saved.active;
    else delete process.env.SECRET_ACTIVE_KEY_ID;
    if (!saved.keys) delete process.env.SECRET_MASTER_KEYS;
  }
});
