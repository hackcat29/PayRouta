import test from "node:test";
import assert from "node:assert/strict";
import { conformanceChecks, baseProfile } from "../lib/partners/conformance";
import { partnerHarnesses } from "./fixtures/partners";
import { buildRegistry, validateManifest } from "../lib/partners/registry";
import { sandboxPartner, sandboxManifest } from "../lib/partners/adapters/sandbox";
import { assertLinkHost, merchantOwned } from "../lib/partners/contract";
import { fingerprint, kybProfileSchema, projectProfile } from "../lib/partners/kyb";
import { paypalSnapshot } from "../lib/partners/adapters/paypal";
import { aggregate, sandboxScreening, screenProfile } from "../lib/partners/screening";

for (const harness of partnerHarnesses)
  for (const check of conformanceChecks(harness))
    test(`partner conformance [${harness.module.manifest.id}]: ${check.name}`, () => check.run());

test("registry refuses a module that would make PayRouta liable (payfac model)", () => {
  const platformLiable = {
    ...sandboxPartner,
    manifest: {
      ...sandboxManifest,
      id: "platform-liable",
      ownership: { ...sandboxManifest.ownership, lossesBorneBy: "platform" as const },
    },
  };
  assert.throws(() => buildRegistry([platformLiable]), /not-merchant-owned/);
  for (const key of [
    "merchantContractsDirectly",
    "merchantHasOwnLogin",
    "settlesToMerchant",
    "portableOnExit",
  ] as const)
    assert.equal(merchantOwned({ ...sandboxManifest.ownership, [key]: false }), false);
});

test("registry refuses unknown fields, duplicate ids and production link hosts with ports", () => {
  assert.ok(
    validateManifest({ ...sandboxManifest, sharedFields: ["legalName", "passportNumber" as never] }).includes(
      "sharedFields:unknown",
    ),
  );
  assert.ok(
    validateManifest({ ...sandboxManifest, sandboxOnly: false, linkHosts: ["pay.example:8443"] }).includes(
      "linkHosts:port",
    ),
  );
  assert.throws(() => buildRegistry([sandboxPartner, sandboxPartner]), /Duplicate/);
});

test("onboarding links: https on declared hosts only, no credentials, no lookalikes", () => {
  const m = { ...sandboxManifest, sandboxOnly: false, linkHosts: ["connect.stripe.com"] };
  assert.equal(assertLinkHost(m, "https://connect.stripe.com/setup/x"), "https://connect.stripe.com/setup/x");
  for (const bad of [
    "http://connect.stripe.com/setup/x",
    "https://connect.stripe.com.evil.example/x",
    "https://user:pw@connect.stripe.com/x",
    "javascript:alert(1)",
    "not a url",
  ])
    assert.throws(() => assertLinkHost(m, bad));
});

test("KYB profile: no sensitive identity fields accepted; registration is asked for by requirements", () => {
  assert.throws(() => kybProfileSchema.parse({ ...baseProfile, passportNumber: "A1" }));
  assert.throws(() => kybProfileSchema.parse({ ...baseProfile, bankAccount: "0123" }));
  // A company can save without a registration number; fiat asks for it
  // (lib/merchant/requirements.ts).
  assert.doesNotThrow(() => kybProfileSchema.parse({ ...baseProfile, registrationNumber: undefined }));
  assert.throws(() => kybProfileSchema.parse({ ...baseProfile, website: "http://harbor.example" }));
  assert.throws(() =>
    kybProfileSchema.parse({
      ...baseProfile,
      owners: [
        { givenName: "A", familyName: "B", country: "GB", ownershipPercent: 60 },
        { givenName: "C", familyName: "D", country: "GB", ownershipPercent: 50 },
      ],
    }),
  );
});

test("projection keeps only declared fields; fingerprints are key-order independent", () => {
  const p = projectProfile(baseProfile, ["legalName", "website"]);
  assert.deepEqual(Object.keys(p).sort(), ["legalName", "website"]);
  assert.equal(fingerprint({ a: 1, b: { c: 2, d: 3 } }), fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

test("paypal: nothing is approved until email, receivability and permissions are all present", () => {
  assert.equal(paypalSnapshot(null).state, "Action required");
  const full = { merchant_id: "M12345678", payments_receivable: true, primary_email_confirmed: true, oauth_integrations: [{}] };
  assert.equal(paypalSnapshot(full).state, "Approved");
  for (const missing of ["payments_receivable", "primary_email_confirmed", "oauth_integrations"])
    assert.equal(paypalSnapshot({ ...full, [missing]: undefined }).state, "Action required");
});

test("screening: aggregation is most-severe; every owner and the representative are screened", async () => {
  assert.equal(aggregate(["clear", "review", "clear"]), "review");
  assert.equal(aggregate(["review", "match"]), "match");
  const screened = await screenProfile(
    {
      ...baseProfile,
      owners: [
        { givenName: "Ok", familyName: "Owner", country: "GB", ownershipPercent: 50 },
        { givenName: "Flagged", familyName: "[sanctioned]", country: "GB", ownershipPercent: 50 },
      ],
    },
    sandboxScreening,
  );
  assert.equal(screened.verdict, "match");
  assert.deepEqual(
    screened.results.map((r) => r.subject),
    ["business", "business:trading-name", "representative", "owner:0", "owner:1"],
  );
});
