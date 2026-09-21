import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAvailability,
  aggregateStatuses,
  methodPrecedence,
  scheduleState,
  trustedContextSchema,
} from "../lib/portal/availability-engine";
import { capabilitySchema } from "../lib/portal/domain";
import {
  context,
  fixtureCandidate,
  fixtureObservations,
  now,
  providers,
  usdc,
} from "./fixtures/providers";
const evaluate = (
  changes: Partial<Parameters<typeof evaluateAvailability>[0]> = {},
) =>
  evaluateAvailability({
    evaluationId: "evaluation-fixture",
    context,
    candidates: providers,
    observations: fixtureObservations(),
    now,
    ...changes,
  });
test("one eligible provider preserves method; unrelated method never replaces it", () => {
  const observations = fixtureObservations().map((o) =>
    o.integrationId === providers[0].integrationId
      ? { ...o, status: "Unavailable" }
      : o,
  );
  assert.equal(evaluate({ observations }).safe.methods[0].status, "AVAILABLE");
  const candidates = providers.map((p, i) =>
    i === 1 ? { ...p, restricted: true } : p,
  );
  assert.equal(
    evaluate({ observations, candidates }).safe.methods[0].status,
    "TEMPORARILY_UNAVAILABLE",
  );
  assert.equal(
    evaluate({ candidates: [providers[2]] }).safe.methods[0].status,
    "UNAVAILABLE",
  );
});
test("hard restrictions dominate every softer result and retain reasons", () => {
  const candidate = { ...fixtureCandidate(), restricted: true, active: false };
  const result = evaluate({
    candidates: [candidate],
    observations: [],
    context: { ...context, verified: false },
  });
  assert.equal(result.safe.methods[0].status, "UNAVAILABLE");
  for (const reason of [
    "PROVIDER_SUSPENDED",
    "PROVIDER_NOT_ACTIVE",
    "MISSING_REQUIRED_CONTEXT",
    "VERIFICATION_REQUIRED",
  ])
    assert.ok(
      result.internal.candidates[0].reasons.some((r) => r.code === reason),
    );
});
test("direction, corridor, precision, limits and complete settlement are independent", () => {
  for (const patch of [
    { operation: "payout" as const },
    { payerCountry: "US" },
    { merchantCountry: "US" },
    { amount: "99.99" },
    { amount: "10000.01" },
    { settlement: { kind: "fiat" as const, identifier: "USD", network: "" } },
  ]) {
    assert.equal(
      evaluate({
        context: { ...context, ...patch },
        candidates: [providers[0]],
      }).safe.methods[0].status,
      "UNAVAILABLE",
    );
  }
  for (const amount of ["100", "10000"])
    assert.equal(
      evaluate({ context: { ...context, amount }, candidates: [providers[0]] })
        .safe.methods[0].status,
      "AVAILABLE",
    );
  assert.equal(
    trustedContextSchema.safeParse({ ...context, amount: "1.001" }).success,
    false,
  );
  assert.equal(
    capabilitySchema.safeParse({ ...providers[0].definition, minimum: "1.001" })
      .success,
    false,
  );
  assert.equal(
    capabilitySchema.safeParse({
      ...providers[0].definition,
      fulfillment: {
        ...providers[0].definition.fulfillment,
        operations: ["pay-in"],
      },
    }).success,
    false,
  );
});
test("blockchain networks and contract identities never collapse into tickers", () => {
  const c = { ...context, input: usdc, precision: 6, settlement: usdc };
  assert.equal(evaluate({ context: c }).safe.methods[1].status, "AVAILABLE");
  assert.equal(
    evaluate({ context: { ...c, input: { ...usdc, network: "eip155:8453" } } })
      .safe.methods[1].status,
    "UNAVAILABLE",
  );
  assert.equal(
    evaluate({
      context: { ...c, input: { ...usdc, identifier: "erc20:other" } },
    }).safe.methods[1].status,
    "UNAVAILABLE",
  );
});
test("production rejects fixtures, simulated evidence and environment leakage", () => {
  assert.equal(
    evaluate({ context: { ...context, environment: "production" } }).safe
      .methods[0].status,
    "UNAVAILABLE",
  );
  const candidate = {
    ...providers[0],
    fictional: false,
    definition: {
      ...providers[0].definition,
      environment: "production" as const,
    },
  };
  const observations = fixtureObservations([candidate]).map((o) => ({
    ...o,
    environment: "production",
  }));
  assert.equal(
    evaluate({
      context: { ...context, environment: "production" },
      candidates: [candidate],
      observations,
    }).safe.methods[0].status,
    "UNKNOWN",
  );
});
test("unknown context and actionable verification have different outcomes", () => {
  assert.equal(
    evaluate({ context: { ...context, payerCountry: null } }).safe.methods[0]
      .status,
    "UNKNOWN",
  );
  assert.equal(
    evaluate({ context: { ...context, verified: null } }).safe.methods[0]
      .status,
    "UNKNOWN",
  );
  assert.equal(
    evaluate({ context: { ...context, verified: false } }).safe.methods[0]
      .status,
    "ACTION_REQUIRED",
  );
  assert.equal(
    evaluate({
      context: { ...context, verified: false, verificationAction: false },
    }).safe.methods[0].status,
    "UNKNOWN",
  );
});
test("stale, missing, wrong-scope and self-reported health cannot manufacture availability", () => {
  for (const observations of [
    [],
    fixtureObservations().filter((o) => o.observationType !== "availability"),
    fixtureObservations().map((o) => ({ ...o, expiresAt: now })),
    fixtureObservations().map((o) => ({ ...o, capabilityVersion: 2 })),
    fixtureObservations().map((o) => ({
      ...o,
      trust: "authenticated-provider",
    })),
  ])
    assert.equal(evaluate({ observations }).safe.methods[0].status, "UNKNOWN");
});
test("capacity, maintenance, operator restriction and observation expiry", () => {
  const observations = fixtureObservations().map((o) =>
    o.observationType === "capacity"
      ? { ...o, value: { remaining: "999.99" } }
      : o,
  );
  assert.equal(
    evaluate({ observations }).safe.methods[0].status,
    "TEMPORARILY_UNAVAILABLE",
  );
  const maintenance = fixtureObservations().map((o) => ({
    ...o,
    observationType: "maintenance",
    status: "Maintenance",
  }));
  assert.equal(
    evaluate({ observations: [...fixtureObservations(), ...maintenance] }).safe
      .methods[0].status,
    "TEMPORARILY_UNAVAILABLE",
  );
  const restricted = maintenance.map((o) => ({
    ...o,
    trust: "operator",
    observationType: "restriction",
  }));
  assert.equal(
    evaluate({ observations: [...fixtureObservations(), ...restricted] }).safe
      .methods[0].status,
    "UNAVAILABLE",
  );
  assert.equal(
    evaluate().safe.expiresAt,
    new Date(now.getTime() + 30000).toISOString(),
  );
});
test("all mixed aggregation pairs follow documented best-candidate precedence", () => {
  for (let i = 0; i < methodPrecedence.length; i++)
    for (let j = 0; j < methodPrecedence.length; j++) {
      assert.equal(
        aggregateStatuses([methodPrecedence[i], methodPrecedence[j]]),
        methodPrecedence[Math.min(i, j)],
      );
    }
  assert.equal(aggregateStatuses([]), "UNAVAILABLE");
});
test("deterministic order independence, no mutation and checkout redaction", () => {
  const before = JSON.stringify(providers),
    observations = fixtureObservations();
  const a = evaluate({ observations });
  const b = evaluate({
    candidates: [...providers].reverse(),
    observations: [...observations].reverse(),
  });
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(providers), before);
  for (const secret of [
    "fictional-harbor",
    "integrationId",
    "observationIds",
    "revision",
    "remaining",
  ])
    assert.equal(JSON.stringify(a.safe).includes(secret), false);
});
test("no implicit conversion or composition, legacy declarations excluded", () => {
  const c = fixtureCandidate();
  c.definition.output = { kind: "fiat", identifier: "USD", network: "" };
  c.definition.fulfillment!.settlementAsset = c.definition.output;
  c.definition.fulfillment!.operations.push("conversion");
  const result = evaluate({
    candidates: [c],
    context: { ...context, settlement: c.definition.output },
  });
  assert.equal(result.safe.methods[0].status, "UNKNOWN");
  assert.ok(
    result.internal.candidates[0].reasons.some(
      (r) => r.code === "CONVERSION_BASIS_UNAVAILABLE",
    ),
  );
  c.definition.fulfillment = undefined;
  assert.equal(
    evaluate({ candidates: [c] }).safe.methods[0].status,
    "UNAVAILABLE",
  );
});
test("schedule boundaries including DST gaps and repeated wall time", () => {
  const c = fixtureCandidate().definition;
  c.timezone = "America/New_York";
  c.fulfillment!.schedule = [{ days: [0], start: 60, end: 120 }];
  assert.equal(scheduleState(c, new Date("2026-11-01T05:30:00Z")).open, true);
  assert.equal(scheduleState(c, new Date("2026-11-01T06:30:00Z")).open, true);
  assert.equal(scheduleState(c, new Date("2026-11-01T07:00:00Z")).open, false);
  c.fulfillment!.schedule = [{ days: [0], start: 120, end: 180 }];
  assert.equal(scheduleState(c, new Date("2026-03-08T07:00:00Z")).open, false);
  assert.equal(
    scheduleState(c, new Date("2026-03-08T06:59:30Z")).boundary,
    Date.parse("2026-03-08T07:00:00Z"),
  );
});
test("resource budgets and expired trusted context fail explicitly", () => {
  assert.throws(
    () => evaluate({ candidates: Array(501).fill(providers[0]) }),
    /BUDGET/,
  );
  assert.throws(
    () => evaluate({ now: new Date(context.validUntil) }),
    /EXPIRED/,
  );
});

test("supporting compliance expiry survives unrelated expired evidence", async () => {
  const { assessEvidence } = await import("../lib/portal/evidence-policy");
  const record = {
    requirementId: "legal",
    reviewStatus: "Accepted",
    scanStatus: "Clean",
  };
  const result = assessEvidence(
    [{ id: "legal" }],
    [
      { ...record, expiresAt: new Date(now.getTime() - 1000) },
      { ...record, expiresAt: new Date(now.getTime() + 5000) },
      {
        ...record,
        requirementId: "unrelated",
        expiresAt: new Date(now.getTime() + 1000),
      },
    ],
    false,
    now,
  );
  assert.deepEqual(result, { valid: true, expiresAt: now.getTime() + 5000 });
  const evaluated = evaluate({
    candidates: [{ ...providers[0], evidenceExpiresAt: result.expiresAt }],
  });
  assert.equal(
    evaluated.safe.expiresAt,
    new Date(now.getTime() + 5000).toISOString(),
  );
});
