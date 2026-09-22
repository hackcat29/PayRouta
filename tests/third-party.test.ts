import test from "node:test";
import assert from "node:assert/strict";
import {
  unconfiguredCompliance,
  complianceProviders,
} from "../lib/compliance/providers";
import {
  unconfiguredRisk,
  turnstileVerifier,
  riskProviders,
} from "../lib/risk/providers";

test("compliance vendors fail closed until configured", async () => {
  await assert.rejects(
    unconfiguredCompliance("didit").verifyIndividual({}),
    /KYC_PROVIDER_NOT_CONFIGURED/,
  );
  await assert.rejects(
    complianceProviders.entityScreening.screenEntity({ name: "x" }),
    /ENTITY_SCREENING_PROVIDER_NOT_CONFIGURED/,
  );
  await assert.rejects(
    complianceProviders.walletScreening.screenWallet({
      network: "eip155:8453",
      address: "0xabc",
    }),
    /WALLET_SCREENING_PROVIDER_NOT_CONFIGURED/,
  );
  await assert.rejects(
    complianceProviders.transactionMonitoring.monitor({ amount: "1", asset: "NGN" }),
    /TRANSACTION_MONITORING_PROVIDER_NOT_CONFIGURED/,
  );
});

test("device risk provider fails closed until configured", async () => {
  await assert.rejects(
    riskProviders.device.assessDevice({ ip: "1.2.3.4" }),
    /RISK_SIGNAL_PROVIDER_NOT_CONFIGURED/,
  );
  await assert.rejects(
    unconfiguredRisk("x").assessDevice({}),
    /RISK_SIGNAL_PROVIDER_NOT_CONFIGURED/,
  );
});

test("turnstile verifier confirms a token and fails closed without a secret", async () => {
  const verifier = turnstileVerifier({
    secret: async () => "secret",
    http: async (_url, options) => {
      const body = JSON.parse(options.body!) as { secret: string; response: string };
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          success: body.response === "good-token" && body.secret === "secret",
        }),
        bytes: 0,
      };
    },
  });
  assert.equal((await verifier.verify("good-token")).success, true);
  assert.equal((await verifier.verify("bad-token")).success, false);
  assert.equal((await verifier.verify("")).success, false);

  const unconfigured = turnstileVerifier({ secret: async () => "" });
  await assert.rejects(unconfigured.verify("token"), /TURNSTILE_NOT_CONFIGURED/);
});
