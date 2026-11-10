import test from "node:test";
import assert from "node:assert/strict";
import { kybProfileSchema } from "../lib/partners/kyb";
import { identityVerified, requirementsFor, tierFor, type RequirementsInput } from "../lib/merchant/requirements";

const base: RequirementsInput = {
  profile: null,
  details: null,
  documents: {},
  termsAccepted: false,
  screening: "pending",
  monthlyUsd: 0,
};
const status = (r: ReturnType<typeof requirementsFor>, id: string) => r.entries.find((e) => e.id === id)?.status;
const person = { dateOfBirth: true, phone: true, idType: "national-id", idNumberLast4: "1234", addressCountry: "NG" };

test("profile: a name, a country and a type are enough to save", () => {
  const p = kybProfileSchema.parse({ legalName: "Ada Obi", businessType: "individual", country: "NG" });
  assert.deepEqual(p.owners, []);
  assert.equal(p.monthlyVolume, "under-10k");
  assert.equal(kybProfileSchema.safeParse({ legalName: "Ada Obi", country: "NG" }).success, false);
});

test("crypto: name, country, terms and a clear check; no documents, no review", () => {
  const profile = kybProfileSchema.parse({ legalName: "Ada Obi", businessType: "individual", country: "NG" });
  const pending = requirementsFor({ ...base, profile, termsAccepted: true });
  assert.equal(pending.ready.crypto, false, "waits for the sanctions check");
  const clear = requirementsFor({ ...base, profile, termsAccepted: true, screening: "clear" });
  assert.equal(clear.ready.crypto, true);
  assert.equal(clear.ready.fiat, false);
  assert.ok(clear.entries.every((e) => e.status !== "due" || !e.blocks.includes("crypto")));
  assert.equal(requirementsFor({ ...base, profile, screening: "clear" }).ready.crypto, false, "terms first");
  assert.equal(requirementsFor({ ...base, profile, termsAccepted: true, screening: "review" }).ready.crypto, false);
  assert.equal(requirementsFor({ ...base, profile, termsAccepted: true, screening: "match" }).ready.crypto, false);
});

test("individuals: personal ID and a payout account, nothing about a company", () => {
  const profile = kybProfileSchema.parse({
    legalName: "Ada Obi",
    businessType: "individual",
    country: "NG",
    productDescription: "Handmade adire fabric",
    supportEmail: "ada@example.com",
  });
  const r = requirementsFor({ ...base, profile, termsAccepted: true, screening: "clear" });
  assert.equal(r.tier, "individual");
  assert.equal(r.capUsd, 10_000);
  for (const id of ["personal-details", "id-number", "government-id", "payout-account"]) assert.equal(status(r, id), "due", id);
  for (const id of ["registration-number", "registration-certificate", "representative", "owners", "proof-of-address"])
    assert.equal(status(r, id), "later", id);
  const done = requirementsFor({
    ...base,
    profile,
    termsAccepted: true,
    screening: "clear",
    details: { representative: person, payoutAccount: { accountLast4: "6789" } },
    documents: { "government-id": "in-review" },
  });
  assert.equal(status(done, "government-id"), "in-review");
  assert.equal(done.ready.fiat, true, "a document in review doesn't hold up submission");
  assert.equal(done.ready["cash-out"], true);
});

test("registered businesses add registration; high expected volume adds owners and proof of address", () => {
  const company = kybProfileSchema.parse({ legalName: "Adire Ltd", businessType: "company", country: "NG", monthlyVolume: "10k-50k" });
  const r = requirementsFor({ ...base, profile: company });
  assert.equal(r.tier, "business");
  assert.equal(status(r, "registration-certificate"), "due");
  assert.equal(status(r, "owners"), "later");
  const big = kybProfileSchema.parse({ ...company, monthlyVolume: "250k-1m" });
  assert.equal(tierFor(big), "scaled");
  const s = requirementsFor({ ...base, profile: big });
  assert.equal(status(s, "owners"), "due");
  assert.equal(status(s, "proof-of-address"), "due");
  assert.equal(s.capUsd, null);
});

test("outgrowing a tier asks for the next one without stopping payments", () => {
  const profile = kybProfileSchema.parse({
    legalName: "Ada Obi",
    businessType: "individual",
    country: "NG",
    productDescription: "Handmade adire fabric",
    supportEmail: "ada@example.com",
  });
  const ready = {
    ...base,
    profile,
    termsAccepted: true,
    screening: "clear" as const,
    details: { representative: person, payoutAccount: { accountLast4: "6789" } },
    documents: { "government-id": "accepted" as const },
  };
  const over = requirementsFor({ ...ready, monthlyUsd: 12_500 });
  assert.equal(over.overCap, true);
  assert.equal(status(over, "registration-certificate"), "upgrade");
  assert.equal(status(over, "owners"), "later");
  assert.equal(over.ready.fiat, true);
  const declared = requirementsFor({ ...ready, profile: { ...profile, monthlyVolume: "50k-250k" } });
  assert.equal(declared.tier, "individual", "an individual stays an individual until registered");
  assert.equal(declared.overCap, true);
  assert.equal(declared.ready.fiat, true);
});

test("verified tick: only for a merchant PayRouta has identified, never for crypto-only setup", () => {
  const individual = kybProfileSchema.parse({ legalName: "Ada Obi", businessType: "individual", country: "NG" });
  // Crypto kept as crypto: everything it needs, and still no tick.
  assert.equal(identityVerified(requirementsFor({ ...base, profile: individual, termsAccepted: true, screening: "clear" })), false);
  // An ID still in review isn't verified.
  assert.equal(
    identityVerified(requirementsFor({ ...base, profile: individual, termsAccepted: true, screening: "clear", documents: { "government-id": "in-review" } })),
    false,
  );
  const accepted = { ...base, profile: individual, termsAccepted: true, documents: { "government-id": "accepted" as const } };
  assert.equal(identityVerified(requirementsFor({ ...accepted, screening: "clear" })), true);
  assert.equal(identityVerified(requirementsFor({ ...accepted, screening: "review" })), false, "a possible sanctions match");
  // A registered business also needs its registration certificate accepted.
  const company = kybProfileSchema.parse({ legalName: "Harbor Goods Ltd", businessType: "company", country: "NG" });
  assert.equal(identityVerified(requirementsFor({ ...accepted, profile: company, screening: "clear" })), false);
  assert.equal(
    identityVerified(
      requirementsFor({ ...accepted, profile: company, screening: "clear", documents: { "government-id": "accepted", "registration-certificate": "accepted" } }),
    ),
    true,
  );
});
