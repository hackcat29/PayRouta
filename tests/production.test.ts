import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "../lib/partners/money";
import { entityScreeningProvider, withManualFallback } from "../lib/compliance/providers";
import { openSanctionsScreening, openSanctionsVerdict } from "../lib/compliance/opensanctions";
import { parseKeyring } from "../lib/portal/secret-store";
import { parseClamdReply } from "../lib/portal/scanner-clamd";
import { safeNext } from "../lib/portal/next-path";
import { liveScopeInput } from "../lib/merchant/live-scope";
import { mergeAvailability } from "../lib/payments/partner-routes";

test("money: amounts reach providers only when precision matches the currency", () => {
  assert.equal(currencyExponent("USD"), 2);
  assert.equal(currencyExponent("JPY"), 0);
  assert.equal(currencyExponent("KWD"), 3);
  assert.equal(currencyExponent("usd"), null);
  assert.equal(toMinorUnits("25.00", 2, "GBP"), 2500n);
  assert.equal(toMinorUnits("25.5", 2, "GBP"), 2550n);
  assert.equal(toMinorUnits("1000", 0, "JPY"), 1000n);
  assert.equal(toMinorUnits("100", 0, "USD"), null, "USD with precision 0 would charge 1.00");
  assert.equal(toMinorUnits("1.234", 2, "USD"), null);
  assert.equal(toMinorUnits("0.00", 2, "USD"), null);
  assert.equal(toMinorUnits("-1.00", 2, "USD"), null);
  assert.equal(toMinorUnits("1e3", 2, "USD"), null);
  assert.equal(fromMinorUnits(2550, "GBP"), "25.50");
  assert.equal(fromMinorUnits(5, "USD"), "0.05");
  assert.equal(fromMinorUnits(1000, "JPY"), "1000");
});

test("screening: sanctions matches stop, PEP-only matches go to review, weak hits are clear", async () => {
  assert.equal(openSanctionsVerdict([]), "clear");
  assert.equal(openSanctionsVerdict([{ match: false, properties: { topics: ["sanction"] } }]), "clear");
  assert.equal(openSanctionsVerdict([{ match: true, properties: { topics: ["role.pep"] } }]), "review");
  assert.equal(openSanctionsVerdict([{ match: true, properties: { topics: ["sanction"] } }]), "match");
  let sent: { path: string; headers?: Record<string, string>; body?: string } | undefined;
  const screening = openSanctionsScreening({ apiKey: "k" }, async (_base, options) => {
    sent = options;
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        responses: { q: { results: [{ id: "NK-1", match: true, properties: { topics: ["sanction"] } }] } },
      }),
    };
  });
  const r = await screening.screenEntity({ name: "Acme Ltd", country: "GB", kind: "organization" });
  assert.equal(r.verdict, "match");
  assert.equal(r.reference, "NK-1");
  assert.equal(sent?.headers?.Authorization, "ApiKey k");
  assert.match(sent!.path, /^\/match\/default\?threshold=0\.7$/);
  assert.deepEqual(JSON.parse(sent!.body!).queries.q, {
    schema: "LegalEntity",
    properties: { name: ["Acme Ltd"], country: ["gb"] },
  });
  await assert.rejects(
    openSanctionsScreening({}, async () => ({ status: 200, headers: {}, body: "{}" })).screenEntity({ name: "x" }),
    /NOT_CONFIGURED/,
  );
  await assert.rejects(
    openSanctionsScreening({ apiKey: "k" }, async () => ({ status: 500, headers: {}, body: "" })).screenEntity({ name: "x" }),
    /UNAVAILABLE/,
  );
});

test("screening: OpenSanctions when a key is set, otherwise manual review (never an automatic clear)", async () => {
  const saved = process.env.OPENSANCTIONS_API_KEY;
  try {
    process.env.OPENSANCTIONS_API_KEY = "k";
    assert.equal(entityScreeningProvider().id, "opensanctions");
    delete process.env.OPENSANCTIONS_API_KEY;
    const provider = entityScreeningProvider();
    assert.equal(provider.id, "manual-review-required");
    const r = await provider.screenEntity({ name: "Acme Ltd", country: "GB", kind: "organization" });
    assert.equal(r.verdict, "review");
  } finally {
    if (saved === undefined) delete process.env.OPENSANCTIONS_API_KEY;
    else process.env.OPENSANCTIONS_API_KEY = saved;
  }
});

test("screening fallback: an unreachable vendor or rejected key means manual review, never a clear", async () => {
  const logs: string[] = [];
  const failing = (status: number) =>
    withManualFallback(
      openSanctionsScreening({ apiKey: "k" }, async () => ({ status, headers: {}, body: "" })),
      (line) => logs.push(line),
    );
  for (const status of [500, 429, 401]) {
    const r = await failing(status).screenEntity({ name: "Acme Ltd", country: "GB", kind: "organization" });
    assert.equal(r.verdict, "review", `HTTP ${status}`);
    assert.equal(r.reference, "opensanctions-unavailable");
  }
  assert.equal(logs.length, 3);
  assert.match(logs[2], /ENTITY_SCREENING_KEY_REJECTED/, "a rejected key is reported as such");
  const working = withManualFallback(
    openSanctionsScreening({ apiKey: "k" }, async () => ({
      status: 200,
      headers: {},
      body: JSON.stringify({ responses: { q: { results: [{ id: "x", match: true, properties: { topics: ["sanction"] } }] } } }),
    })),
    (line) => logs.push(line),
  );
  assert.equal((await working.screenEntity({ name: "Acme Ltd" })).verdict, "match", "a working vendor's answer stands");
  assert.equal(logs.length, 3);
});

test("secret store keyring: 32-byte keys, known active key, malformed input refused", () => {
  const k = randomBytes(32).toString("base64");
  assert.equal(parseKeyring(undefined), null);
  const ring = parseKeyring(`k1:${k},k2:${k}`, "k2")!;
  assert.equal(ring.active, "k2");
  assert.equal(parseKeyring(`k1:${k}`)!.active, "k1");
  assert.throws(() => parseKeyring(`k1:${randomBytes(16).toString("base64")}`), /32 bytes/);
  assert.throws(() => parseKeyring(`k1:${k}`, "k9"), /not in the keyring/);
  assert.throws(() => parseKeyring(`Bad Id:${k}`), /malformed/);
});

test("clamd: only an explicit OK is clean", () => {
  assert.equal(parseClamdReply("stream: OK\0"), "Clean");
  assert.equal(parseClamdReply("stream: Eicar-Test-Signature FOUND\0"), "Malicious");
  assert.equal(parseClamdReply("INSTREAM size limit exceeded. ERROR\0"), null);
  assert.equal(parseClamdReply(""), null);
});

test("sign-in redirect only returns to internal workspace paths", () => {
  assert.equal(safeNext("/merchant"), "/merchant");
  assert.equal(safeNext("/merchant/providers?partner=paypal"), "/merchant/providers?partner=paypal");
  for (const bad of ["//evil.example", "https://evil.example", "/merchant@evil.example", "/provider/../x", "/docs", 42])
    assert.equal(safeNext(bad), undefined);
});

test("live scope: any explicit market and currency; no wildcards; same-currency settlement", () => {
  const base = {
    environment: "production",
    merchantCountry: "GB",
    payerCountries: ["GB", "IE", "US"],
    methods: ["card"],
    asset: "fiat:GBP:",
    settlementAsset: "fiat:GBP:",
    maximumMinor: "50000",
    dailyMaximumMinor: "500000",
    profileIds: [],
    accounts: [{ integrationId: "int_1", accountReference: "acct_1" }],
    evidenceIds: ["ev_1"],
    nextReviewAt: new Date(Date.now() + 30 * 86400000).toISOString(),
  };
  assert.equal(liveScopeInput.safeParse(base).success, true);
  assert.equal(liveScopeInput.safeParse({ ...base, payerCountries: ["*"] }).success, false);
  assert.equal(liveScopeInput.safeParse({ ...base, settlementAsset: "fiat:USD:" }).success, false);
  assert.equal(liveScopeInput.safeParse({ ...base, payerCountries: ["GB", "GB"] }).success, false);
  assert.equal(liveScopeInput.safeParse({ ...base, asset: "blockchain:USDC:base" }).success, false);
});

test("availability merge: the merchant's own accounts make a method available, and only accepted methods", () => {
  const evaluation = {
    evaluationId: "e",
    evaluatedAt: "",
    expiresAt: "",
    methods: [{ method: "card", label: "Card", status: "UNAVAILABLE", explanation: "No provider", action: "x" }],
  };
  const candidate = {
    profileId: "partner:a",
    applicationId: "a",
    partnerId: "paypal",
    name: "PayPal",
    integrationId: "i",
    method: "card",
  };
  const merged = mergeAvailability(evaluation, [candidate], ["card"]);
  assert.equal(merged.methods[0].status, "AVAILABLE");
  assert.equal(merged.methods[0].explanation, "Through your PayPal account");
  assert.equal("action" in merged.methods[0], false);
  assert.equal(mergeAvailability(evaluation, [candidate], ["bank-transfer"]).methods[0].status, "UNAVAILABLE");
  assert.equal(evaluation.methods[0].status, "UNAVAILABLE", "input is not mutated");
});

test("object storage: R2 endpoints are recognised and a bucket path is never doubled", async () => {
  const { isR2, s3Endpoint } = await import("../lib/portal/adapters");
  assert.equal(isR2("https://abc123.r2.cloudflarestorage.com/payrouta"), true);
  assert.equal(isR2("https://s3.eu-central-1.amazonaws.com"), false);
  assert.equal(s3Endpoint("https://abc123.r2.cloudflarestorage.com/payrouta"), "https://abc123.r2.cloudflarestorage.com");
  assert.equal(s3Endpoint(""), undefined);
});
