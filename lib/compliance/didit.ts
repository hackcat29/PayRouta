import { PortalError } from "../portal/domain";
import type {
  KycProvider,
  KybProvider,
  EntityScreeningProvider,
  WalletScreeningProvider,
  TransactionMonitoringProvider,
  ScreeningResult,
  MonitoringResult,
} from "./providers";

export type DiditHttp = (
  url: string,
  options: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

export interface DiditConfig {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class DiditAdapter
  implements
    KycProvider,
    KybProvider,
    EntityScreeningProvider,
    WalletScreeningProvider,
    TransactionMonitoringProvider
{
  readonly id = "didit";
  private baseUrl: string;
  private timeoutMs: number;

  constructor(
    private config: DiditConfig,
    private http: DiditHttp,
  ) {
    this.baseUrl = config.baseUrl || "https://api.didit.me/v1";
    this.timeoutMs = config.timeoutMs || 8000;
  }

  private async call(path: string, body?: unknown) {
    if (!this.config.apiKey) {
      throw new PortalError("DIDIT_CREDENTIALS_NOT_CONFIGURED", 503);
    }
    const response = await this.http(`${this.baseUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: this.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new PortalError("DIDIT_API_ERROR", 502);
    }

    try {
      return JSON.parse(response.body || "{}");
    } catch {
      throw new PortalError("DIDIT_MALFORMED_RESPONSE", 502);
    }
  }

  async verifyIndividual(input: { country?: string; name?: string }): Promise<ScreeningResult> {
    const data = await this.call("/kyc/verify", {
      country: input.country,
      name: input.name,
    });
    const status = (data.status || "").toLowerCase();
    const verdict = status === "approved" ? "clear" : status === "rejected" ? "match" : "review";
    return {
      verdict,
      reference: data.id || data.reference || "didit-kyc-ref",
      matches: Array.isArray(data.reasons) ? data.reasons : [],
    };
  }

  async verifyBusiness(input: { country?: string; name?: string }): Promise<ScreeningResult> {
    const data = await this.call("/kyb/verify", {
      country: input.country,
      business_name: input.name,
    });
    const status = (data.status || "").toLowerCase();
    const verdict = status === "approved" ? "clear" : status === "rejected" ? "match" : "review";
    return {
      verdict,
      reference: data.id || data.reference || "didit-kyb-ref",
      matches: Array.isArray(data.flags) ? data.flags : [],
    };
  }

  async screenEntity(input: { name?: string; country?: string }): Promise<ScreeningResult> {
    const data = await this.call("/aml/screen", {
      name: input.name,
      country: input.country,
    });
    const hasMatches = Array.isArray(data.matches) && data.matches.length > 0;
    const verdict = hasMatches ? "match" : "clear";
    return {
      verdict,
      reference: data.id || data.reference || "didit-aml-ref",
      matches: hasMatches ? data.matches.map((m: { category?: string }) => m.category || "sanctions") : [],
    };
  }

  async screenWallet(input: { network: string; address: string }): Promise<ScreeningResult> {
    const data = await this.call("/crypto/screen", {
      network: input.network,
      address: input.address,
    });
    const riskLevel = (data.risk_level || "").toLowerCase();
    const verdict = riskLevel === "high" || riskLevel === "severe" ? "match" : riskLevel === "medium" ? "review" : "clear";
    return {
      verdict,
      reference: data.id || data.reference || "didit-wallet-ref",
      matches: Array.isArray(data.alerts) ? data.alerts : [],
    };
  }

  async monitor(input: { amount: string; asset: string; counterparty?: string }): Promise<MonitoringResult> {
    const data = await this.call("/monitoring/transaction", {
      amount: input.amount,
      asset: input.asset,
      counterparty: input.counterparty,
    });
    return {
      flagged: Boolean(data.flagged),
      riskScore: typeof data.risk_score === "number" ? data.risk_score : 0,
      reference: data.id || data.reference || "didit-tm-ref",
    };
  }
}
