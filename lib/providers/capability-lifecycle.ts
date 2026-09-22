// Capability lifecycle.
//
// A declared capability must pass a sequence of gates before it can ever be
// eligible for production routing. Declaration is never activation.

export const capabilityLifecycleStates = [
  "DRAFT",
  "DECLARED",
  "VERIFICATION_REQUIRED",
  "SANDBOX_READY",
  "TESTING",
  "CERTIFICATION_FAILED",
  "CERTIFIED",
  "REVIEW_REQUIRED",
  "APPROVED",
  "ACTIVE",
  "SUSPENDED",
  "REVOKED",
] as const;
export type CapabilityLifecycleState = (typeof capabilityLifecycleStates)[number];

// Provider-facing labels are simplified; internal technical names stay hidden.
export const providerFacingLabels: Record<CapabilityLifecycleState, string> = {
  DRAFT: "Draft",
  DECLARED: "Needs information",
  VERIFICATION_REQUIRED: "Needs information",
  SANDBOX_READY: "Needs information",
  TESTING: "Testing",
  CERTIFICATION_FAILED: "Testing",
  CERTIFIED: "Ready for review",
  REVIEW_REQUIRED: "Ready for review",
  APPROVED: "Approved",
  ACTIVE: "Live",
  SUSPENDED: "Paused",
  REVOKED: "Paused",
};

const transitions: Record<CapabilityLifecycleState, CapabilityLifecycleState[]> =
  {
    DRAFT: ["DECLARED"],
    DECLARED: ["VERIFICATION_REQUIRED", "SANDBOX_READY", "DRAFT"],
    VERIFICATION_REQUIRED: ["DECLARED", "SANDBOX_READY"],
    SANDBOX_READY: ["TESTING", "VERIFICATION_REQUIRED", "DECLARED"],
    TESTING: ["CERTIFICATION_FAILED", "CERTIFIED", "SANDBOX_READY"],
    CERTIFICATION_FAILED: ["TESTING", "DECLARED"],
    CERTIFIED: ["REVIEW_REQUIRED", "TESTING"],
    REVIEW_REQUIRED: ["APPROVED", "CERTIFIED", "DECLARED"],
    APPROVED: ["ACTIVE", "REVIEW_REQUIRED", "SUSPENDED"],
    ACTIVE: ["SUSPENDED", "APPROVED"],
    SUSPENDED: ["ACTIVE", "REVOKED"],
    REVOKED: ["DECLARED"],
  };

export function canTransition(
  from: string,
  to: CapabilityLifecycleState,
): boolean {
  const source = capabilityLifecycleStates.includes(
    from as CapabilityLifecycleState,
  )
    ? (from as CapabilityLifecycleState)
    : undefined;
  if (!source) return false;
  return transitions[source].includes(to);
}

export function assertTransition(
  from: string,
  to: CapabilityLifecycleState,
): void {
  if (!canTransition(from, to))
    throw new Error(
      `Invalid capability transition ${from} -> ${to}`,
    );
}

export function providerLabel(state: string): string {
  return (
    providerFacingLabels[state as CapabilityLifecycleState] ?? state
  );
}

// The full set of gates required for a capability to become production-routable.
// A capability is routable only when all of these hold; any individual gate that
// fails must be reported as a distinct machine-readable reason.
export interface RoutabilityInput {
  capabilityState: string;
  organizationApproved: boolean;
  providerActive: boolean;
  capabilityApproved: boolean;
  complianceEvidenceValid: boolean;
  integrationCertified: boolean;
  productionCredentialsValid: boolean;
  providerHealthAcceptable: boolean;
  operationalAvailabilityAcceptable: boolean;
  transactionEligible: boolean;
}

export interface RoutabilityResult {
  routable: boolean;
  unmet: string[];
}

export function routable(input: RoutabilityInput): RoutabilityResult {
  const unmet: string[] = [];
  const add = (condition: boolean, reason: string) => {
    if (!condition) unmet.push(reason);
  };
  add(input.capabilityState === "ACTIVE", "CAPABILITY_NOT_ACTIVE");
  add(input.organizationApproved, "ORGANIZATION_NOT_APPROVED");
  add(input.providerActive, "PROVIDER_NOT_ACTIVE");
  add(input.capabilityApproved, "CAPABILITY_NOT_APPROVED");
  add(input.complianceEvidenceValid, "COMPLIANCE_EVIDENCE_INVALID");
  add(input.integrationCertified, "INTEGRATION_NOT_CERTIFIED");
  add(input.productionCredentialsValid, "PRODUCTION_CREDENTIALS_INVALID");
  add(input.providerHealthAcceptable, "PROVIDER_HEALTH_NOT_ACCEPTABLE");
  add(
    input.operationalAvailabilityAcceptable,
    "OPERATIONAL_AVAILABILITY_NOT_ACCEPTABLE",
  );
  add(input.transactionEligible, "TRANSACTION_NOT_ELIGIBLE");
  return { routable: unmet.length === 0, unmet };
}
