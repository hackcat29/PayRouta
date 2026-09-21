import { test } from "node:test";
import assert from "node:assert/strict";
import { riskPolicySchema, riskOutcome } from "../lib/merchant/policy";
const context = {
  environment: "sandbox",
  asset: "fiat:NGN:",
  amount: 10000n,
  method: "bank-transfer",
  evidenceCurrent: true,
  dailyReserved: 0n,
  alreadyReserved: false,
};
test("merchant policy uses exact arithmetic, separates review from hard denials", () => {
  const policy = riskPolicySchema.parse({
    limits: [
      {
        asset: "fiat:NGN:",
        maximum: "900719925474099399",
        dailyMaximum: "900719925474099399",
        reviewAbove: "9999",
      },
    ],
  });
  assert.equal(riskOutcome(policy, context).decision, "Hold for review");
  assert.deepEqual(riskOutcome({ ...policy, paused: true }, context), {
    decision: "Deny",
    reasons: ["MERCHANT_PAUSED"],
  });
  assert.equal(
    riskOutcome(policy, { ...context, amount: 900719925474099400n }).decision,
    "Deny",
  );
  assert.equal(
    riskOutcome(policy, { ...context, evidenceCurrent: false }).decision,
    "Deny",
  );
  assert.equal(
    riskOutcome(policy, { ...context, environment: "production" }).decision,
    "Deny",
  );
});
test("aggregate reservations and unknown assets fail closed", () => {
  const policy = riskPolicySchema.parse({
    limits: [{ asset: "fiat:NGN:", maximum: "10000", dailyMaximum: "10000" }],
  });
  assert.equal(
    riskOutcome(policy, { ...context, dailyReserved: 10000n }).decision,
    "Deny",
  );
  assert.equal(
    riskOutcome(policy, {
      ...context,
      dailyReserved: 10000n,
      alreadyReserved: true,
    }).decision,
    "Allow",
  );
  assert.equal(
    riskOutcome(policy, { ...context, asset: "fiat:USD:" }).decision,
    "Deny",
  );
  assert.throws(() => riskPolicySchema.parse({ verified: true }));
});
