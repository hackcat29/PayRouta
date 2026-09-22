// General compliance eligibility layer.
//
// This produces a normalized, machine-readable decision about whether a
// transaction may proceed to operational availability and routing. It does not
// encode simplistic rules ("cards never need KYC", "crypto KYC begins above one
// global amount"). Instead it evaluates a transaction context against a
// declared, replaceable policy and returns the most severe decision plus
// explainable reasons.

export const complianceDecisions = [
  "ALLOW",
  "ALLOW_WITH_CONTROLS",
  "ACTION_REQUIRED",
  "PROVIDER_VERIFICATION_REQUIRED",
  "PAYROUTA_VERIFICATION_REQUIRED",
  "MANUAL_REVIEW",
  "BLOCK",
] as const;
export type ComplianceDecision = (typeof complianceDecisions)[number];

// Severity increases with array position. Aggregation returns the highest.
const severity: Record<ComplianceDecision, number> = {
  ALLOW: 0,
  ALLOW_WITH_CONTROLS: 1,
  ACTION_REQUIRED: 2,
  PROVIDER_VERIFICATION_REQUIRED: 3,
  PAYROUTA_VERIFICATION_REQUIRED: 4,
  MANUAL_REVIEW: 5,
  BLOCK: 6,
};

export interface ComplianceContext {
  product?: string;
  operation: string;
  originCountry?: string;
  destinationCountry?: string;
  merchantCountry?: string;
  customerType?: string;
  merchantType?: string;
  paymentMethod: string;
  rail?: string;
  asset?: { kind: string; identifier: string; network: string };
  network?: string;
  amount?: string;
  currency?: string;
  provider?: {
    regulatedActivities?: string[];
    jurisdiction?: string;
    complianceResponsibility?: string;
    custodyModel?: string;
    settlementStructure?: string;
  };
  // Facts/signals supplied by external vendors (screening, wallet risk, device
  // risk). They never become routing decisions by themselves.
  riskContext?: Record<string, string | number | boolean>;
}

export type ReasonCode = string;
export interface ComplianceReason {
  code: ReasonCode;
  decision: Exclude<ComplianceDecision, "ALLOW">;
  detail?: string;
}
export interface ComplianceRule {
  id: string;
  evaluate(context: ComplianceContext): ComplianceReason | null;
}

export interface ComplianceResult {
  decision: ComplianceDecision;
  reasons: ComplianceReason[];
}

export function mostSevere(a: ComplianceDecision, b: ComplianceDecision) {
  return severity[a] >= severity[b] ? a : b;
}

export function evaluateCompliance(
  context: ComplianceContext,
  rules: ComplianceRule[],
): ComplianceResult {
  let decision: ComplianceDecision = "ALLOW";
  const reasons: ComplianceReason[] = [];
  for (const rule of rules) {
    const reason = rule.evaluate(context);
    if (reason) {
      reasons.push(reason);
      decision = mostSevere(decision, reason.decision);
    }
  }
  return { decision, reasons };
}

// A general, conservative default policy. It gates on facts that are genuinely
// required regardless of method or amount, without inventing method-specific
// KYC thresholds.
export const defaultComplianceRules: ComplianceRule[] = [
  {
    id: "required-context",
    evaluate(c) {
      if (!c.merchantCountry || !c.originCountry)
        return {
          code: "MISSING_REQUIRED_CONTEXT",
          decision: "MANUAL_REVIEW",
          detail: "Origin and merchant country are required",
        };
      return null;
    },
  },
  {
    id: "supported-operation",
    evaluate(c) {
      const supported = [
        "pay-in",
        "payout",
        "conversion",
        "authorization",
        "settlement",
      ];
      if (!supported.includes(c.operation))
        return {
          code: "UNSUPPORTED_OPERATION",
          decision: "BLOCK",
          detail: "Operation is not recognized",
        };
      return null;
    },
  },
  {
    id: "sanctions",
    evaluate(c) {
      if (c.riskContext?.sanctioned === true)
        return {
          code: "SANCTIONED_PARTY",
          decision: "BLOCK",
          detail: "A sanctions/PEP signal matched",
        };
      return null;
    },
  },
  {
    id: "provider-custody",
    evaluate(c) {
      // A non-custodial, direct-on-chain settlement model requires PayRouta-side
      // verification before the provider may be used for regulated flows.
      if (
        c.provider?.custodyModel === "non-custodial" &&
        (c.paymentMethod === "stablecoin" || c.paymentMethod === "crypto-app")
      )
        return {
          code: "DIRECT_CUSTODY_REVIEW",
          decision: "PROVIDER_VERIFICATION_REQUIRED",
          detail: "Direct custody model requires provider verification",
        };
      return null;
    },
  },
];
