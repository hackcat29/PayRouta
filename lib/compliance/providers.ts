import { PortalError } from "../portal/domain";

// Normalized compliance vendor interfaces. Vendors (Didit, Monnify identity,
// others) are replaceable behind these interfaces; vendor-specific field names
// never appear outside their adapters.

export interface ScreeningResult {
  verdict: "clear" | "match" | "review";
  reference: string;
  // Normalized match categories only; bounded.
  matches: string[];
}

export interface MonitoringResult {
  flagged: boolean;
  riskScore: number;
  reference: string;
}

export interface KycProvider {
  id: string;
  verifyIndividual(input: { country?: string; name?: string }): Promise<ScreeningResult>;
}

export interface KybProvider {
  id: string;
  verifyBusiness(input: { country?: string; name?: string }): Promise<ScreeningResult>;
}

export interface EntityScreeningProvider {
  id: string;
  screenEntity(input: { name?: string; country?: string }): Promise<ScreeningResult>;
}

export interface WalletScreeningProvider {
  id: string;
  screenWallet(input: { network: string; address: string }): Promise<ScreeningResult>;
}

export interface TransactionMonitoringProvider {
  id: string;
  monitor(input: { amount: string; asset: string; counterparty?: string }): Promise<MonitoringResult>;
}

// Fail-closed default: no vendor is configured, so every call refuses rather
// than returning a fabricated "clear".
export function unconfiguredCompliance(id: string): KycProvider &
  KybProvider &
  EntityScreeningProvider &
  WalletScreeningProvider &
  TransactionMonitoringProvider {
  const refuse = (kind: string): never => {
    throw new PortalError(`${kind}_PROVIDER_NOT_CONFIGURED`, 503);
  };
  return {
    id,
    async verifyIndividual() {
      return refuse("KYC");
    },
    async verifyBusiness() {
      return refuse("KYB");
    },
    async screenEntity() {
      return refuse("ENTITY_SCREENING");
    },
    async screenWallet() {
      return refuse("WALLET_SCREENING");
    },
    async monitor() {
      return refuse("TRANSACTION_MONITORING");
    },
  };
}

// Registry of configured vendors. Empty by default: everything fails closed
// until a real vendor is wired with credentials.
export const complianceProviders = {
  kyc: unconfiguredCompliance("kyc"),
  kyb: unconfiguredCompliance("kyb"),
  entityScreening: unconfiguredCompliance("entity-screening"),
  walletScreening: unconfiguredCompliance("wallet-screening"),
  transactionMonitoring: unconfiguredCompliance("transaction-monitoring"),
};
