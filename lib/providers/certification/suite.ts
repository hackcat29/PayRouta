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
        passed: !!result.reference,
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
      const passed = !!status;
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
