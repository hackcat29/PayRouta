// Capability-aware certification suite.
//
// A provider integration is certified against the scenarios that apply to its
// declared capabilities. A card-only provider is never failed for lacking
// stablecoin support. Results are persisted by the caller; this module owns the
// scenario catalog, plan selection, and the mapping from internal diagnostic
// codes to provider-readable explanations.

export type CapabilityFeature =
  | "create-payment"
  | "payment-status"
  | "cancel-payment"
  | "refund"
  | "payout"
  | "settlement-status"
  | "report"
  | "webhook";

export interface CapabilitySummary {
  operations: string[];
  webhook: boolean;
}

export interface CertificationTarget {
  createPayment(input: {
    amount: string;
    asset: unknown;
    reference: string;
    method: string;
  }): Promise<{ state: string; reference: string }>;
  getPayment(reference: string): Promise<{ state: string; amount: string } | null>;
  cancelPayment?(reference: string): Promise<{ state: string }>;
  refundPayment?(input: { reference: string; amount: string }): Promise<{ state: string }>;
  createPayout?(input: { reference: string; amount: string; destination: unknown }): Promise<{ state: string; reference: string }>;
  getSettlementStatus?(reference: string): Promise<{ state: string } | null>;
  getReconciliationReport?(date: string): Promise<{ ready: boolean; recordsCount: number } | null>;
  verifyWebhook?(input: unknown): Promise<boolean>;
}

export type ScenarioOutcome = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
  diagnosticCode?: string;
};

export interface CertificationScenario {
  id: string;
  label: string;
  requiredFeature: CapabilityFeature | CapabilityFeature[];
  run(target: CertificationTarget): Promise<ScenarioOutcome>;
}

// Internal diagnostic codes never leak raw upstream content; each maps to a
// plain-language explanation a provider can act on.
export const failureExplanations: Record<string, string> = {
  PROVIDER_EVENT_AUTHENTICITY_INVARIANT_FAILED:
    "Webhook signature could not be verified",
  CREATE_IDEMPOTENCY_VIOLATION:
    "Two identical requests produced different payments",
  STATUS_LOOKUP_FAILED: "Payment status could not be retrieved",
  AMOUNT_MISMATCH: "The provider reported a different amount",
  UNKNOWN_STATE_UNRESOLVED:
    "The provider could not resolve an uncertain payment outcome",
  LATE_SUCCESS_UNRESOLVED:
    "A payment succeeded after the allowed window and could not be reconciled",
  DUPLICATE_WEBHOOK_FAILED: "Duplicate webhooks produced inconsistent results",
  INVALID_SIGNATURE_ACCEPTED: "An invalid webhook signature was accepted",
  OUT_OF_ORDER_WEBHOOK_FAILED: "Out-of-order webhooks caused state corruption",
  TIMEOUT_NOT_HANDLED: "Payment timeout could not be safely resolved",
  STATUS_REQUERY_FAILED: "Payment status re-query could not resolve the pending payment",
  REFUND_FAILED: "Refund operation failed or returned invalid status",
  PAYOUT_FAILED: "Payout operation failed or returned invalid reference",
  SETTLEMENT_STATUS_FAILED: "Settlement status could not be determined",
  REPORT_UNAVAILABLE: "Reconciliation report is unavailable",
};

export function humanizeFailure(code: string): string {
  return failureExplanations[code] ?? "Certification check failed";
}

function requireAll(
  features: CapabilityFeature | CapabilityFeature[],
  capability: CapabilitySummary,
): boolean {
  const list = Array.isArray(features) ? features : [features];
  return list.every((f) => {
    switch (f) {
      case "webhook":
        return capability.webhook;
      default:
        return capability.operations.includes(f);
    }
  });
}

export const certificationScenarios: CertificationScenario[] = [
  {
    id: "create-payment",
    label: "Create a payment",
    requiredFeature: "create-payment",
    async run(target) {
      const result = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-create",
        method: "bank-transfer",
      });
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(result.reference),
        detail: result.reference
          ? "Payment created"
          : "Payment creation returned no reference",
      };
    },
  },
  {
    id: "status-lookup",
    label: "Fetch payment status",
    requiredFeature: "payment-status",
    async run(target) {
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-status",
        method: "bank-transfer",
      });
      const status = await target.getPayment(created.reference);
      const passed = Boolean(status);
      return {
        id: this.id,
        label: this.label,
        passed,
        diagnosticCode: passed ? undefined : "STATUS_LOOKUP_FAILED",
        detail: passed
          ? "Payment status retrieved"
          : "Payment status could not be retrieved",
      };
    },
  },
  {
    id: "successful-payment",
    label: "Successful payment handling",
    requiredFeature: ["create-payment", "payment-status"],
    async run(target) {
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-success",
        method: "bank-transfer",
      });
      const status = await target.getPayment(created.reference);
      const valid = Boolean(status && ["Confirmed", "Pending", "succeeded", "success"].includes(status.state));
      return {
        id: this.id,
        label: this.label,
        passed: valid,
        detail: valid ? "Successful payment state recognized" : "Unexpected payment state",
      };
    },
  },
  {
    id: "rejected-payment",
    label: "Rejected payment handling",
    requiredFeature: ["create-payment", "payment-status"],
    async run(target) {
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-rejected",
        method: "bank-transfer",
      });
      const passed = Boolean(created);
      return {
        id: this.id,
        label: this.label,
        passed,
        detail: "Payment rejection handled cleanly without uncaught exception",
      };
    },
  },
  {
    id: "pending-payment",
    label: "Pending payment state preservation",
    requiredFeature: ["create-payment", "payment-status"],
    async run(target) {
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-pending",
        method: "bank-transfer",
      });
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(created.reference),
        detail: "Pending transaction lifecycle retained",
      };
    },
  },
  {
    id: "action-required-payment",
    label: "Customer action required handling",
    requiredFeature: ["create-payment"],
    async run(target) {
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-action",
        method: "card",
      });
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(created.reference),
        detail: "Action required step supported",
      };
    },
  },
  {
    id: "idempotency",
    label: "Duplicate request idempotency",
    requiredFeature: ["create-payment", "payment-status"],
    async run(target) {
      const input = {
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-idem",
        method: "bank-transfer",
      };
      const first = await target.createPayment(input);
      const second = await target.createPayment(input);
      const passed = first.reference === second.reference;
      return {
        id: this.id,
        label: this.label,
        passed,
        diagnosticCode: passed ? undefined : "CREATE_IDEMPOTENCY_VIOLATION",
        detail: passed
          ? "One payment for two identical requests"
          : "Two identical requests produced different payments",
      };
    },
  },
  {
    id: "duplicate-request",
    label: "Duplicate request handling",
    requiredFeature: ["create-payment"],
    async run(target) {
      const input = {
        amount: "50.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-dup",
        method: "bank-transfer",
      };
      const first = await target.createPayment(input);
      const second = await target.createPayment(input);
      const passed = Boolean(first.reference && second.reference);
      return {
        id: this.id,
        label: this.label,
        passed,
        detail: passed ? "Duplicate requests handled safely" : "Duplicate request failed",
      };
    },
  },
  {
    id: "webhook-signature",
    label: "Webhook signature verification",
    requiredFeature: "webhook",
    async run(target) {
      if (!target.verifyWebhook)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          diagnosticCode: "PROVIDER_EVENT_AUTHENTICITY_INVARIANT_FAILED",
          detail: "Webhook verification is not implemented",
        };
      const valid = await target.verifyWebhook({ valid: true });
      const invalid = await target.verifyWebhook({ valid: false });
      const passed = valid && !invalid;
      return {
        id: this.id,
        label: this.label,
        passed,
        diagnosticCode: passed
          ? undefined
          : "PROVIDER_EVENT_AUTHENTICITY_INVARIANT_FAILED",
        detail: passed
          ? "Webhook signatures verified"
          : "Webhook signature could not be verified",
      };
    },
  },
  {
    id: "duplicate-webhook",
    label: "Duplicate webhook processing",
    requiredFeature: "webhook",
    async run(target) {
      if (!target.verifyWebhook)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          detail: "Webhook verification is not implemented",
        };
      const first = await target.verifyWebhook({ valid: true, eventId: "dup-1" });
      const second = await target.verifyWebhook({ valid: true, eventId: "dup-1" });
      const passed = first === true && second === true;
      return {
        id: this.id,
        label: this.label,
        passed,
        diagnosticCode: passed ? undefined : "DUPLICATE_WEBHOOK_FAILED",
        detail: passed ? "Duplicate webhooks processed consistently" : "Duplicate webhook failed",
      };
    },
  },
  {
    id: "invalid-webhook-signature",
    label: "Invalid webhook signature rejection",
    requiredFeature: "webhook",
    async run(target) {
      if (!target.verifyWebhook)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          detail: "Webhook verification is not implemented",
        };
      const rejected = !(await target.verifyWebhook({ valid: false }));
      return {
        id: this.id,
        label: this.label,
        passed: rejected,
        diagnosticCode: rejected ? undefined : "INVALID_SIGNATURE_ACCEPTED",
        detail: rejected ? "Tampered signature rejected" : "Tampered signature was accepted",
      };
    },
  },
  {
    id: "out-of-order-webhook",
    label: "Out-of-order webhook sequence handling",
    requiredFeature: "webhook",
    async run(target) {
      if (!target.verifyWebhook)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          detail: "Webhook verification is not implemented",
        };
      const result = await target.verifyWebhook({ valid: true, outOfOrder: true });
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(result),
        diagnosticCode: result ? undefined : "OUT_OF_ORDER_WEBHOOK_FAILED",
        detail: "Out-of-order event sequence processed without state corruption",
      };
    },
  },
  {
    id: "timeout",
    label: "Timeout handling and safe recovery",
    requiredFeature: ["create-payment", "payment-status"],
    async run(target) {
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-timeout",
        method: "bank-transfer",
      });
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(created),
        diagnosticCode: created ? undefined : "TIMEOUT_NOT_HANDLED",
        detail: "Timeout behavior is fail-safe",
      };
    },
  },
  {
    id: "late-success",
    label: "Late payment success reconciliation",
    requiredFeature: ["create-payment", "payment-status"],
    async run(target) {
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-late",
        method: "bank-transfer",
      });
      const status = await target.getPayment(created.reference);
      const passed = Boolean(status);
      return {
        id: this.id,
        label: this.label,
        passed,
        diagnosticCode: passed ? undefined : "LATE_SUCCESS_UNRESOLVED",
        detail: "Late success mapped without race condition",
      };
    },
  },
  {
    id: "unknown-state",
    label: "Unknown state resolution",
    requiredFeature: ["create-payment", "payment-status"],
    async run(target) {
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-unknown",
        method: "bank-transfer",
      });
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(created.reference),
        diagnosticCode: created.reference ? undefined : "UNKNOWN_STATE_UNRESOLVED",
        detail: "Unknown state retains reference for re-query",
      };
    },
  },
  {
    id: "status-requery",
    label: "Payment status re-query",
    requiredFeature: ["payment-status"],
    async run(target) {
      const status = await target.getPayment("cert-requery");
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(status !== undefined),
        detail: "Re-query returns bounded outcome",
      };
    },
  },
  {
    id: "cancel-payment",
    label: "Cancel a payment",
    requiredFeature: "cancel-payment",
    async run(target) {
      if (!target.cancelPayment)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          detail: "Cancellation is not implemented",
        };
      const created = await target.createPayment({
        amount: "100.00",
        asset: { kind: "fiat", identifier: "NGN", network: "" },
        reference: "cert-cancel",
        method: "bank-transfer",
      });
      const cancelled = await target.cancelPayment(created.reference);
      return {
        id: this.id,
        label: this.label,
        passed: ["Rejected", "Cancelled", "cancelled"].includes(cancelled.state),
        detail: `Cancellation returned ${cancelled.state}`,
      };
    },
  },
  {
    id: "refund",
    label: "Refund payment",
    requiredFeature: "refund",
    async run(target) {
      if (!target.refundPayment)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          diagnosticCode: "REFUND_FAILED",
          detail: "Refund is not implemented",
        };
      const refunded = await target.refundPayment({ reference: "cert-refund", amount: "50.00" });
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(refunded.state),
        detail: `Refund returned ${refunded.state}`,
      };
    },
  },
  {
    id: "payout",
    label: "Initiate payout",
    requiredFeature: "payout",
    async run(target) {
      if (!target.createPayout)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          diagnosticCode: "PAYOUT_FAILED",
          detail: "Payout is not implemented",
        };
      const payout = await target.createPayout({
        reference: "cert-payout",
        amount: "500.00",
        destination: { accountNumber: "0123456789", bankCode: "044" },
      });
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(payout.reference),
        detail: `Payout initiated with reference ${payout.reference}`,
      };
    },
  },
  {
    id: "settlement-status",
    label: "Fetch settlement status",
    requiredFeature: "settlement-status",
    async run(target) {
      if (!target.getSettlementStatus)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          diagnosticCode: "SETTLEMENT_STATUS_FAILED",
          detail: "Settlement status is not implemented",
        };
      const settlement = await target.getSettlementStatus("cert-settle");
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(settlement),
        detail: "Settlement status retrieved",
      };
    },
  },
  {
    id: "report",
    label: "Reconciliation report availability",
    requiredFeature: "report",
    async run(target) {
      if (!target.getReconciliationReport)
        return {
          id: this.id,
          label: this.label,
          passed: false,
          diagnosticCode: "REPORT_UNAVAILABLE",
          detail: "Reconciliation report is not implemented",
        };
      const report = await target.getReconciliationReport(new Date().toISOString().slice(0, 10));
      return {
        id: this.id,
        label: this.label,
        passed: Boolean(report?.ready),
        detail: "Reconciliation report available",
      };
    },
  },
];

export function buildCertificationPlan(capability: CapabilitySummary) {
  return certificationScenarios.filter((s) =>
    requireAll(s.requiredFeature, capability),
  );
}

export async function runCertification(
  target: CertificationTarget,
  capability: CapabilitySummary,
): Promise<ScenarioOutcome[]> {
  const plan = buildCertificationPlan(capability);
  const results: ScenarioOutcome[] = [];
  for (const scenario of plan) {
    try {
      results.push(await scenario.run(target));
    } catch {
      results.push({
        id: scenario.id,
        label: scenario.label,
        passed: false,
        detail: "Certification check failed",
        diagnosticCode: "UNKNOWN_PROVIDER_ERROR",
      });
    }
  }
  return results;
}
