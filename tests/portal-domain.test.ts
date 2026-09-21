import test from "node:test";
import assert from "node:assert/strict";
import {
  effectiveEligibility,
  capabilityKey,
  capabilitySchema,
  units,
  can,
  transition,
  redact,
  activationBlockers,
  validateDraftSection,
} from "../lib/portal/domain";
import { publicAddress, validateEndpoint } from "../lib/portal/ssrf";
import { fileSignature } from "../lib/portal/adapters";
import { simulator } from "../lib/portal/simulator";
const capability = {
  capabilityId: "usdc-ngn",
  version: 1,
  family: "stablecoin",
  rail: "Ethereum USDC",
  operation: "conversion",
  origin: "US",
  destination: "NG",
  input: {
    kind: "blockchain",
    network: "eip155:1",
    identifier: "erc20:0xa0b86991",
  },
  output: { kind: "fiat", identifier: "NGN", network: "" },
  minimum: "0.000000000000000001",
  maximum: "99999999999999999999.123456789123456789",
  daily: "99999999999999999999.123456789123456789",
  limitAsset: "erc20:0xa0b86991",
  settlement: "T+1",
  hours: "24/7",
  timezone: "UTC",
  availability: "webhook",
  conditions: "Verified",
  endpoint: "convert.usdc.ngn",
  environment: "sandbox",
};
test("exact financial limits preserve 18 fractional digits and reject floating values", () => {
  assert.equal(
    units("99999999999999999999.123456789123456789"),
    99999999999999999999123456789123456789n,
  );
  assert.throws(() => units("1e10"));
  assert.throws(() => units("-1"));
  assert.throws(() => units("1.0000000000000000001"));
  assert.ok(capabilitySchema.safeParse(capability).success);
  assert.equal(
    capabilitySchema.safeParse({ ...capability, minimum: "100", maximum: "10" })
      .success,
    false,
  );
});
test("directions, operations, and networks stay explicit", () => {
  const c = capabilitySchema.parse(capability);
  const reversed = { ...c, input: c.output!, output: c.input };
  assert.notEqual(capabilityKey(c), capabilityKey(reversed));
  assert.notEqual(
    capabilityKey(c),
    capabilityKey({ ...c, operation: "payout" }),
  );
  assert.equal(
    capabilitySchema.safeParse({
      ...capability,
      input: { ...capability.input, network: "" },
    }).success,
    false,
  );
  assert.equal(
    capabilitySchema.safeParse({ ...capability, output: undefined }).success,
    false,
  );
});
test("role matrix denies privilege escalation", () => {
  assert.equal(can("Analyst", "submit"), false);
  assert.equal(can("Developer", "compliance"), false);
  assert.equal(can("Compliance", "integration"), false);
  assert.equal(can("Admin", "ownership"), false);
  assert.equal(can("Owner", "ownership"), true);
  assert.equal(can("Operations admin", "submit"), false);
});
test("application transitions reject skipping reviews and do not change operational state", () => {
  assert.throws(() => transition("Draft", "Approved"));
  transition("Draft", "Submitted");
  transition("Submitted", "Under review");
  transition("Under review", "Changes requested");
  transition("Changes requested", "Resubmitted");
  assert.throws(() => transition("Approved", "Active"));
});
test("drafts allow incomplete data but reject injected fields", () => {
  assert.deepEqual(
    validateDraftSection("company", { legalName: "", website: "" }),
    { legalName: "", website: "" },
  );
  assert.throws(() =>
    validateDraftSection("company", { internalRole: "Operations admin" }),
  );
});
test("endpoint validation rejects private, loopback, mapped and metadata addresses", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.2",
    "169.254.169.254",
    "192.168.1.1",
    "172.16.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "0.0.0.0",
    "224.0.0.1",
  ]) {
    assert.equal(publicAddress(address), false, address);
  }
  for (const url of [
    "http://public.example",
    "https://localhost",
    "https://user:pass@public.example",
    "https://public.example:8443",
  ]) {
    await assert.rejects(validateEndpoint(url));
  }
  await assert.rejects(
    validateEndpoint("https://rebind.example", (async () => [
      { address: "10.0.0.2", family: 4 },
    ]) as never),
  );
  assert.equal(publicAddress("8.8.8.8"), true);
});
test("file magic excludes SVG and disguised executables", () => {
  assert.equal(
    fileSignature(Buffer.from("<svg></svg>"), "image/svg+xml"),
    false,
  );
  assert.equal(
    fileSignature(Buffer.from("MZbinarybinary"), "application/pdf"),
    false,
  );
  assert.equal(
    fileSignature(Buffer.from("%PDF-1.4\nfixture"), "application/pdf"),
    true,
  );
});
test("redaction recursively removes credential material", () => {
  assert.deepEqual(
    redact({
      a: [{ authorization: "secret", password: "secret", safe: "ok" }],
      token: "secret",
    }),
    {
      a: [{ authorization: "[redacted]", password: "[redacted]", safe: "ok" }],
      token: "[redacted]",
    },
  );
});
test("simulator handles uncertainty without blind execution retry", async () => {
  const result = await simulator.run("Timeout with uncertain outcome");
  assert.ok(
    result.steps.some((s) => s.result.includes("No retry or failover")),
  );
  assert.ok(
    result.steps.some((s) => s.result.includes("Status query required")),
  );
  const duplicate = await simulator.run("Duplicate idempotency key");
  assert.ok(
    duplicate.steps.some(
      (s) => s.result === "1 execution for 2 identical requests",
    ),
  );
});
test("simulator approval cannot satisfy production gates", () => {
  assert.ok(
    activationBlockers({
      approved: true,
      legal: true,
      technical: true,
      evidence: true,
      realTests: false,
      secrets: false,
      registry: false,
      storage: false,
    }).length === 4,
  );
});

test("manual available never overrides activation, evidence or observed health", () => {
  const base = {
    active: true,
    published: true,
    evidenceValid: true,
    now: 1000,
    observed: { status: "Available", expiresAt: new Date(2000) },
    reported: { status: "Available", expiresAt: new Date(2000) },
  };
  assert.equal(effectiveEligibility(base).eligible, true);
  assert.equal(
    effectiveEligibility({ ...base, active: false }).eligible,
    false,
  );
  assert.equal(
    effectiveEligibility({ ...base, evidenceValid: false }).eligible,
    false,
  );
  assert.equal(
    effectiveEligibility({
      ...base,
      observed: { status: "Available", expiresAt: new Date(999) },
    }).eligible,
    false,
  );
  assert.equal(
    effectiveEligibility({
      ...base,
      reported: { status: "Unavailable", expiresAt: new Date(2000) },
    }).eligible,
    false,
  );
});
