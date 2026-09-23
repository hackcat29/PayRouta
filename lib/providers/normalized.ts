// Normalized provider-network taxonomy.
//
// This module keeps PaymentMethod, PaymentRail, Provider, and ExecutionAdapter
// as separate concepts. A provider declares capabilities in terms of a method,
// a rail/network, and an operation; an execution adapter is only ever the
// mechanical translation of one provider's API into PayRouta's normalized
// execution contract.
export const paymentMethodIds = [
  "bank-transfer",
  "card",
  "mobile-money",
  "digital-wallet",
  "ussd",
  "direct-debit",
  "bnpl",
  "cash-voucher",
  "stablecoin",
  "crypto-app",
] as const;
export type PaymentMethodId = (typeof paymentMethodIds)[number];

// Plain-language labels. These are what merchants and customers see; internal
// identifiers must not leak into the UI.
export const paymentMethodLabels: Record<PaymentMethodId, string> = {
  "bank-transfer": "Bank transfer",
  card: "Card",
  "mobile-money": "Mobile money",
  "digital-wallet": "Digital wallet",
  ussd: "USSD",
  "direct-debit": "Direct debit",
  bnpl: "Buy now, pay later",
  "cash-voucher": "Cash / voucher",
  stablecoin: "Stablecoin",
  "crypto-app": "Crypto",
};

// Families stay compatible with the existing capability family vocabulary so a
// normalized method can always be attached to an existing CapabilityDefinition.
export const paymentMethodFamilies = {
  "bank-transfer": "bank",
  card: "card",
  "mobile-money": "mobile-money",
  "digital-wallet": "wallet",
  ussd: "local",
  "direct-debit": "bank",
  bnpl: "local",
  "cash-voucher": "local",
  stablecoin: "stablecoin",
  "crypto-app": "crypto",
} as const;
export type PaymentFamily =
  (typeof paymentMethodFamilies)[PaymentMethodId];

export const paymentOperations = [
  "pay-in",
  "payout",
  "conversion",
  "authorization",
  "settlement",
] as const;
export type PaymentOperation = (typeof paymentOperations)[number];

// Rails / networks are a first-class concept. A rail is the underlying network
// a provider moves value across for a given method (NIP, VISA, Base, etc.).
export interface PaymentRail {
  id: string;
  label: string;
  family: string;
}
export const knownRails: readonly PaymentRail[] = [
  { id: "ng-nibss", label: "NIP", family: "bank" },
  { id: "card-network", label: "Card network", family: "card" },
  { id: "visa", label: "Visa", family: "card" },
  { id: "mastercard", label: "Mastercard", family: "card" },
  { id: "verve", label: "Verve", family: "card" },
  { id: "mobile-money-network", label: "Mobile money network", family: "mobile-money" },
  { id: "onchain", label: "On-chain", family: "stablecoin" },
  { id: "eip155:8453", label: "Base", family: "stablecoin" },
  { id: "eip155:1", label: "Ethereum", family: "stablecoin" },
];
export function rail(id: string): PaymentRail | undefined {
  return knownRails.find((r) => r.id === id);
}

// Three first-class integration modes. NATIVE is maintained by PayRouta,
// STANDARD is a provider implementing the PayRouta Provider API, and
// CONFIGURABLE is a declarative mapping of a provider's existing API.
export const integrationModes = ["NATIVE", "STANDARD", "CONFIGURABLE"] as const;
export type IntegrationMode = (typeof integrationModes)[number];

export const maintainedByValues = ["PAYROUTA", "PROVIDER"] as const;
export type MaintainedBy = (typeof maintainedByValues)[number];

// Execution modes influence capability validation and adapter resolution. They
// are never shown to ordinary customers.
export const executionModes = ["DIRECT", "PROVIDER", "HYBRID"] as const;
export type ExecutionMode = (typeof executionModes)[number];

// A normalized capability declaration: the minimal shape PayRouta derives from
// a provider's plain-language answers ("we process bank transfers and cards in
// Nigeria and Ghana").
export interface NormalizedCapability {
  method: PaymentMethodId;
  railId: string;
  operation: PaymentOperation;
  origin: string;
  destination: string;
  inputAsset: string;
  inputNetwork: string;
  executionMode: ExecutionMode;
}

export function isPaymentMethod(value: string): value is PaymentMethodId {
  return (paymentMethodIds as readonly string[]).includes(value);
}
export function familyOf(method: string): PaymentFamily | undefined {
  return isPaymentMethod(method) ? paymentMethodFamilies[method] : undefined;
}
export function labelOf(method: string): string {
  return isPaymentMethod(method) ? paymentMethodLabels[method] : method;
}

// Normalized PaymentMethod model
export interface PaymentMethod {
  id: PaymentMethodId;
  label: string;
  family: PaymentFamily;
  description?: string;
}

// Normalized Provider model
export interface Provider {
  id: string;
  orgId: string;
  name: string;
  category: string;
  integrationMode: IntegrationMode;
  status: "active" | "suspended" | "pending";
  createdAt: Date;
}

// Normalized ProviderCapability model
export interface ProviderCapability extends NormalizedCapability {
  id: string;
  providerId: string;
  lifecycleState: string;
  certified: boolean;
  approved: boolean;
}

// Normalized ProviderIntegration model
export interface ProviderIntegration {
  id: string;
  providerId: string;
  mode: IntegrationMode;
  environment: "sandbox" | "production";
  baseUrl?: string;
  authType: "bearer" | "api-key" | "hmac" | "oauth2";
  credentialRef?: string;
  webhookSecretRef?: string;
  healthEndpoint?: string;
  timeoutMs: number;
  retries: number;
}

// Normalized ExecutionAdapter contract
export interface ExecutionAdapter {
  operations: readonly string[];
  create(
    attempt: { id: string; key: string; environment: string; providerReference?: string | null },
    intent: { reference: string; amount: string; asset: unknown; selectedMethod?: string | null; metadata?: unknown },
  ): Promise<{ state: string; reference: string }>;
  status(attempt: { id: string; key: string; providerReference?: string | null }): Promise<{
    state: string;
    reference: string;
    amount: string;
    asset: unknown;
  } | null>;
  cancel?(attempt: { id: string; providerReference?: string | null }): Promise<{ state: string }>;
  payout?(input: { reference: string; amount: string; asset: unknown; destination: unknown }): Promise<{ state: string; reference: string }>;
  verifyWebhook?(input: unknown): Promise<boolean>;
}

// Normalized ProviderConnection model
export interface ProviderConnection {
  id: string;
  providerId: string;
  environment: "sandbox" | "production";
  health: "Available" | "Unavailable" | "Degraded" | "Maintenance";
  lastCheckedAt?: Date;
  latencyMs?: number;
}

// Normalized ProviderCertification model
export interface ProviderCertification {
  id: string;
  providerId: string;
  capabilityId: string;
  status: "CERTIFIED" | "CERTIFICATION_FAILED" | "TESTING";
  passedScenarios: string[];
  failedScenarios: string[];
  certifiedAt?: Date;
}

// Normalized ProviderHealth model
export interface ProviderHealth {
  status: "Available" | "Unavailable" | "Degraded" | "Maintenance";
  latencyMs: number;
  errorRate: number;
  checkedAt: Date;
}

// Normalized ProviderEconomics model
export interface ProviderEconomics {
  providerId: string;
  method: PaymentMethodId;
  fixedFeeMinor: string;
  percentageBps: number;
  currency: string;
  minAmountMinor?: string;
  maxAmountMinor?: string;
}

// Normalized ProviderPerformance model
export interface ProviderPerformance {
  providerId: string;
  method: PaymentMethodId;
  successRate: number;
  avgLatencyMs: number;
  totalAttempts: number;
  fallbackCount: number;
  periodDays: number;
}
