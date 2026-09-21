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
test("merchant role permissions do not inherit provider or unknown roles", async () => {
  const { merchantCan } = await import("../lib/merchant/access");
  assert.equal(merchantCan("Finance", "read"), true);
  assert.equal(merchantCan("Finance", "configure"), false);
  assert.equal(merchantCan("Developer", "integration"), true);
  assert.equal(merchantCan("Developer", "team"), false);
  assert.equal(merchantCan("Compliance", "read"), false);
  assert.equal(merchantCan("Owner", "team"), true);
  assert.equal(merchantCan("None", "read"), false);
});

test("merchant requirements are explicit and context-specific", async () => {
  const { matchesMerchantRequirement: matches } =
    await import("../lib/merchant/evidence");
  const app = { country: "NG", methods: ["card"] };
  assert.equal(matches({}, app), false);
  assert.equal(
    matches({ audience: "provider", countries: ["NG"] }, app),
    false,
  );
  assert.equal(
    matches(
      { audience: "merchant", countries: ["NG"], methods: ["card"] },
      app,
    ),
    true,
  );
  assert.equal(
    matches({ audience: "merchant", countries: ["GH"] }, app),
    false,
  );
  assert.equal(
    matches({ audience: "merchant", methods: ["bank-transfer"] }, app),
    false,
  );
});
