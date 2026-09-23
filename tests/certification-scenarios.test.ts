import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCertificationPlan,
  runCertification,
  humanizeFailure,
  certificationScenarios,
  type CertificationTarget,
  type CapabilitySummary,
} from "../lib/providers/certification/suite";

test("certification plan is capability-aware", () => {
  // Total scenarios in catalog
  assert.equal(certificationScenarios.length, 21);

  // Minimal provider: only create-payment without webhook
  const minimalPlan = buildCertificationPlan({
    operations: ["create-payment"],
    webhook: false,
  });
  // Should include create-payment, duplicate-request, action-required-payment
  assert.equal(minimalPlan.length, 3);
  assert.ok(minimalPlan.some((s) => s.id === "create-payment"));
  assert.ok(minimalPlan.some((s) => s.id === "duplicate-request"));
  assert.ok(minimalPlan.some((s) => s.id === "action-required-payment"));
  assert.ok(!minimalPlan.some((s) => s.id === "payout"));
  assert.ok(!minimalPlan.some((s) => s.id === "refund"));
  assert.ok(!minimalPlan.some((s) => s.id === "invalid-webhook-signature"));

  // Provider with create-payment and payment-status includes timeout and idempotency
  const statusPlan = buildCertificationPlan({
    operations: ["create-payment", "payment-status"],
    webhook: false,
  });
  assert.ok(statusPlan.some((s) => s.id === "timeout"));
  assert.ok(statusPlan.some((s) => s.id === "idempotency"));

  // Webhook-only capability
  const webhookPlan = buildCertificationPlan({
    operations: [],
    webhook: true,
  });
  assert.ok(webhookPlan.some((s) => s.id === "duplicate-webhook"));
  assert.ok(webhookPlan.some((s) => s.id === "invalid-webhook-signature"));
  assert.ok(webhookPlan.some((s) => s.id === "out-of-order-webhook"));
  assert.ok(webhookPlan.some((s) => s.id === "webhook-signature"));
  assert.ok(!webhookPlan.some((s) => s.id === "create-payment"));

  // Card-only provider summary does not include payout or report
  const cardPlan = buildCertificationPlan({
    operations: ["create-payment", "payment-status", "cancel-payment"],
    webhook: true,
  });
  assert.ok(!cardPlan.some((s) => s.id === "payout"));
  assert.ok(!cardPlan.some((s) => s.id === "refund"));
  assert.ok(!cardPlan.some((s) => s.id === "report"));
  assert.ok(cardPlan.some((s) => s.id === "cancel-payment"));
});

test("full target satisfies all 20 capability scenarios", async () => {
  const fullTarget: CertificationTarget = {
    async createPayment(input) {
      if (input.reference === "cert-idempotent-2") {
        return { state: "Confirmed", reference: "cert-idempotent-1" };
      }
      return { state: "Confirmed", reference: input.reference };
    },
    async getPayment() {
      return { state: "Confirmed", amount: "100.00" };
    },
    async cancelPayment() {
      return { state: "Rejected" };
    },
    async refundPayment() {
      return { state: "Confirmed" };
    },
    async createPayout(input) {
      return { state: "Confirmed", reference: input.reference };
    },
    async getSettlementStatus() {
      return { state: "Confirmed" };
    },
    async getReconciliationReport() {
      return { ready: true, recordsCount: 42 };
    },
    async verifyWebhook(input) {
      const obj = (input ?? {}) as { valid?: boolean; signature?: string };
      if (obj.valid === false || obj.signature === "invalid_sig") return false;
      return true;
    },
  };

  const fullCapability: CapabilitySummary = {
    operations: [
      "create-payment",
      "payment-status",
      "cancel-payment",
      "refund",
      "payout",
      "settlement-status",
      "report",
    ],
    webhook: true,
  };

  const plan = buildCertificationPlan(fullCapability);
  assert.equal(plan.length, 21);

  const results = await runCertification(fullTarget, fullCapability);
  assert.equal(results.length, 21);
  for (const r of results) {
    assert.equal(r.passed, true, `Scenario ${r.id} failed: ${r.detail}`);
  }
});

test("certification suite identifies and humanizes failure diagnostics", async () => {
  // Target that accepts invalid webhook signatures
  const badWebhookTarget: CertificationTarget = {
    async createPayment(input) {
      return { state: "Confirmed", reference: input.reference };
    },
    async getPayment() {
      return { state: "Confirmed", amount: "100.00" };
    },
    async verifyWebhook() {
      return true; // Accidental acceptance of bad signature!
    },
  };

  const webhookResults = await runCertification(badWebhookTarget, {
    operations: [],
    webhook: true,
  });

  const invalidSig = webhookResults.find((r) => r.id === "invalid-webhook-signature");
  assert.ok(invalidSig);
  assert.equal(invalidSig.passed, false);
  assert.equal(invalidSig.diagnosticCode, "INVALID_SIGNATURE_ACCEPTED");
  assert.equal(
    humanizeFailure(invalidSig.diagnosticCode!),
    "An invalid webhook signature was accepted",
  );

  // Target that generates different references on repeated idempotent requests
  let counter = 0;
  const badIdempotencyTarget: CertificationTarget = {
    async createPayment() {
      counter++;
      return { state: "Confirmed", reference: `diff-ref-${counter}` };
    },
    async getPayment() {
      return { state: "Confirmed", amount: "100.00" };
    },
  };

  const idempResults = await runCertification(badIdempotencyTarget, {
    operations: ["create-payment", "payment-status"],
    webhook: false,
  });

  const idempOutcome = idempResults.find((r) => r.id === "idempotency");
  assert.ok(idempOutcome);
  assert.equal(idempOutcome.passed, false);
  assert.equal(idempOutcome.diagnosticCode, "CREATE_IDEMPOTENCY_VIOLATION");
  assert.equal(
    humanizeFailure(idempOutcome.diagnosticCode!),
    "Two identical requests produced different payments",
  );
});
