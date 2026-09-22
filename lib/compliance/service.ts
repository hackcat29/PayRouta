import {
  ComplianceContext,
  ComplianceResult,
  defaultComplianceRules,
  evaluateCompliance,
} from "./eligibility";

export interface TransactionComplianceInput {
  operation: string;
  originCountry: string;
  merchantCountry: string;
  amount: string;
  asset: { kind: string; identifier: string; network: string };
  currency: string;
  riskContext?: ComplianceContext["riskContext"];
}

export interface MethodComplianceInput {
  method: string;
  provider?: {
    regulatedActivities?: string[];
    jurisdiction?: string;
    complianceResponsibility?: string;
    custodyModel?: string;
    settlementStructure?: string;
  };
}

export function transactionComplianceContext(
  input: TransactionComplianceInput,
): ComplianceContext {
  return {
    operation: input.operation,
    originCountry: input.originCountry,
    destinationCountry: input.merchantCountry,
    merchantCountry: input.merchantCountry,
    amount: input.amount,
    currency: input.currency,
    asset: input.asset,
    paymentMethod: "",
    riskContext: input.riskContext,
  };
}

export function methodComplianceContext(
  input: MethodComplianceInput,
  base: TransactionComplianceInput,
): ComplianceContext {
  return {
    ...transactionComplianceContext(base),
    paymentMethod: input.method,
    provider: input.provider,
  };
}

// Transaction-level eligibility, evaluated before operational availability. A
// BLOCK or MANUAL_REVIEW result prevents an intent from ever exposing methods
// to a customer.
export function evaluateTransactionCompliance(
  input: TransactionComplianceInput,
): ComplianceResult {
  return evaluateCompliance(transactionComplianceContext(input), defaultComplianceRules);
}

// Method + provider eligibility, evaluated in the routing layer once a method
// and provider are known.
export function evaluateMethodCompliance(
  input: MethodComplianceInput & { base: TransactionComplianceInput },
): ComplianceResult {
  return evaluateCompliance(
    methodComplianceContext(input, input.base),
    defaultComplianceRules,
  );
}

// A decision is terminal-blocking when it must stop the transaction outright.
export function blocksExecution(decision: ComplianceResult["decision"]): boolean {
  return decision === "BLOCK" || decision === "MANUAL_REVIEW";
}
