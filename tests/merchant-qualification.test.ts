import { test } from "node:test";
import assert from "node:assert/strict";
import {
  liveScopeInput,
  liveScopeReasons,
  scopeReviewCurrent,
} from "../lib/merchant/live-scope";
import { canTransition, gatesForStage } from "../lib/merchant/qualification";
import { rolloutPermits } from "../lib/merchant/rollout";
const scope = {
  environment: "production",
  merchantCountry: "NG",
  payerCountries: ["NG"],
  methods: ["bank-transfer"],
  asset: "fiat:NGN:",
  settlementAsset: "fiat:NGN:",
  maximumMinor: "10000",
  dailyMaximumMinor: "20000",
  profileIds: ["profile"],
  accounts: [
    {
      integrationId: "integration",
      accountReference: "owned-account",
      permissionEvidenceId: "permission",
      settlementDestinationEvidenceId: "destination",
      refundResponsibilityEvidenceId: "refund",
    },
  ],
  evidenceIds: ["merchant-evidence"],
  nextReviewAt: "2030-01-31T00:00:00.000Z",
};
const approved = {
  status: "Approved",
  version: "1",
  applicationVersion: 2,
  input: scope,
  approvedAt: "2030-01-01T00:00:00.000Z",
  approvedBy: "reviewer",
};
const now = new Date("2030-01-02T00:00:00Z");
const context = {
  country: "NG",
  method: "bank-transfer",
  asset: "fiat:NGN:",
  amount: 10000n,
  dailyReserved: 0n,
  alreadyReserved: false,
};
test("live scope rejects wildcard markets, duplicate contexts and inconsistent exact limits", () => {
  assert.equal(liveScopeInput.safeParse(scope).success, true);
  assert.equal(
    liveScopeInput.safeParse({ ...scope, merchantCountry: "*" }).success,
    false,
  );
  assert.equal(
    liveScopeInput.safeParse({ ...scope, methods: ["stablecoin"] }).success,
    false,
  );
  assert.equal(
    liveScopeInput.safeParse({ ...scope, profileIds: ["profile", "profile"] })
      .success,
    false,
  );
  assert.equal(
    liveScopeInput.safeParse({ ...scope, dailyMaximumMinor: "9999" }).success,
    false,
  );
  assert.equal(
    liveScopeInput.safeParse({ ...scope, verified: true }).success,
    false,
  );
});
test("live scope expiry, revocation, method, asset and exact atomic aggregate constraints", () => {
  assert.deepEqual(liveScopeReasons(approved, context, now), []);
  assert.equal(scopeReviewCurrent(approved, now), true);
  assert.deepEqual(
    liveScopeReasons({ ...approved, status: "Revoked" }, context, now),
    ["LIVE_SCOPE_NOT_APPROVED"],
  );
  assert.deepEqual(
    liveScopeReasons(approved, context, new Date("2030-02-01Z")),
    ["LIVE_SCOPE_REVIEW_DUE"],
  );
  assert.deepEqual(
    liveScopeReasons(approved, { ...context, method: "card" }, now),
    ["OUTSIDE_APPROVED_LIVE_SCOPE"],
  );
  assert.deepEqual(
    liveScopeReasons(approved, { ...context, amount: 10001n }, now),
    ["LIVE_SCOPE_TRANSACTION_LIMIT"],
  );
  assert.deepEqual(
    liveScopeReasons(approved, { ...context, dailyReserved: 10001n }, now),
    ["LIVE_SCOPE_AGGREGATE_LIMIT"],
  );
  assert.deepEqual(
    liveScopeReasons(
      approved,
      { ...context, dailyReserved: 20000n, alreadyReserved: true },
      now,
    ),
    [],
  );
});
test("rollout cannot skip qualification; pausing requires fresh qualification before resumption", () => {
  assert.equal(canTransition("Candidate", "Pilot enabled"), false);
  assert.equal(canTransition("Candidate", "Sandbox qualified"), true);
  assert.equal(canTransition("Limited live", "Paused"), true);
  assert.equal(canTransition("Paused", "Limited live"), false);
  assert.equal(canTransition("Paused", "Candidate"), true);
  assert.ok(gatesForStage("Limited live").includes("settlement"));
  assert.ok(gatesForStage("Generally enabled").includes("reconciliation"));
});
test("rollout caps apply to simulator scope too and review expiry excludes new execution", () => {
  const rollout = {
    stage: "Sandbox qualified",
    maximumMinor: "10000",
    merchantAllowlist: [],
    evidenceIds: ["proof"],
    version: "v1",
    nextReviewAt: scope.nextReviewAt,
  };
  const ctx = {
    environment: "sandbox",
    merchantId: "merchant",
    amount: "100.00",
    precision: 2,
  };
  assert.equal(rolloutPermits(rollout, ctx, now), true);
  assert.equal(
    rolloutPermits(rollout, { ...ctx, amount: "100.01" }, now),
    false,
  );
  assert.equal(rolloutPermits(rollout, ctx, new Date("2030-02-01Z")), false);
});
