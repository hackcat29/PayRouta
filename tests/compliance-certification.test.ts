import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateTransactionCompliance,
  evaluateMethodCompliance,
  blocksExecution,
} from "../lib/compliance/service";
import {
  simulatorTarget,
  deriveCapabilitySummary,
  summarize,
  queueCertification,
} from "../lib/providers/certification/service";
import { runCertification } from "../lib/providers/certification/suite";

const base = {
  operation: "pay-in",
  originCountry: "NG",
  merchantCountry: "NG",
  amount: "100.00",
  asset: { kind: "fiat", identifier: "NGN", network: "" },
  currency: "NGN",
};

test("transaction compliance allows an ordinary pay-in and blocks sanctions", () => {
  assert.equal(evaluateTransactionCompliance(base).decision, "ALLOW");
  const blocked = evaluateTransactionCompliance({
    ...base,
    riskContext: { sanctioned: true },
  });
  assert.equal(blocked.decision, "BLOCK");
  assert.ok(blocked.reasons.some((r) => r.code === "SANCTIONED_PARTY"));
  assert.equal(blocksExecution("BLOCK"), true);
  assert.equal(blocksExecution("MANUAL_REVIEW"), true);
  assert.equal(blocksExecution("ALLOW"), false);
});

test("method compliance flags direct non-custodial stablecoin for provider verification", () => {
  const result = evaluateMethodCompliance({
    base,
    method: "stablecoin",
    provider: { custodyModel: "non-custodial" },
  });
  assert.equal(result.decision, "PROVIDER_VERIFICATION_REQUIRED");
  const card = evaluateMethodCompliance({ base, method: "card" });
  assert.equal(card.decision, "ALLOW");
});

test("certification target, plan and summary are deterministic", async () => {
  const target = simulatorTarget();
  const created = await target.createPayment({
    amount: "100.00",
    asset: base.asset,
    reference: "cert-ref",
    method: "bank-transfer",
  });
  assert.equal(created.state, "Confirmed");
  assert.equal(created.reference, "cert-ref");
  assert.equal((await target.getPayment("cert-ref"))!.state, "Confirmed");
  assert.equal(await target.verifyWebhook!({ valid: true }), true);
  assert.equal(await target.verifyWebhook!({ valid: false }), false);

  const summary = deriveCapabilitySummary({ adapter: "simulator", events: "webhook" });
  assert.ok(summary.operations.includes("create-payment"));
  assert.ok(summary.operations.includes("cancel-payment"));
  assert.equal(summary.webhook, true);

  const results = await runCertification(target, summary);
  assert.ok(results.length >= 15);
  assert.ok(results.every((r) => r.passed));
  const sum = summarize(results);
  assert.equal(sum.failed, 0);
  assert.equal(sum.status, "Certified");
});

test("summarize maps diagnostic codes to human-readable failures", () => {
  const sum = summarize([
    { id: "a", label: "A", passed: true, detail: "ok" },
    {
      id: "b",
      label: "B",
      passed: false,
      detail: "bad",
      diagnosticCode: "PROVIDER_EVENT_AUTHENTICITY_INVARIANT_FAILED",
    },
  ]);
  assert.equal(sum.status, "Certification failed");
  assert.equal(sum.passed, 1);
  assert.equal(sum.failed, 1);
  assert.deepEqual(sum.humanFailures, ["Webhook signature could not be verified"]);
});

test("queueCertification is declared but only the simulator is certifiable", () => {
  assert.equal(typeof queueCertification, "function");
});
