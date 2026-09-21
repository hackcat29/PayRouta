import { test } from "node:test";
import assert from "node:assert/strict";
import { rolloutPermits } from "../lib/merchant/rollout";
const context = {
  environment: "production",
  merchantId: "merchant-a",
  amount: "100.00",
  precision: 2,
};
const policy = {
  stage: "Limited live",
  merchantAllowlist: ["merchant-a"],
  maximumMinor: "10000",
  evidenceIds: ["qualified-evidence"],
  version: "1",
};
test("rollout defaults closed in production, requires allowlist, limit, and non-paused stage", () => {
  assert.equal(rolloutPermits({}, context), false);
  assert.equal(
    rolloutPermits({}, { ...context, environment: "sandbox" }),
    true,
  );
  assert.equal(rolloutPermits(policy, context), true);
  assert.equal(
    rolloutPermits(policy, { ...context, merchantId: "another" }),
    false,
  );
  assert.equal(rolloutPermits(policy, { ...context, amount: "100.01" }), false);
  assert.equal(rolloutPermits({ ...policy, stage: "Paused" }, context), false);
  assert.equal(rolloutPermits({ ...policy, evidenceIds: [] }, context), false);
});
