import { PortalError } from "../portal/domain";

export interface NigeriaIdentityVerificationProvider {
  id: string;
  verifyBvn(bvn: string, name?: string): Promise<{ verified: boolean; matchRate?: number; reference: string }>;
  verifyNin(nin: string, name?: string): Promise<{ verified: boolean; matchRate?: number; reference: string }>;
  verifyBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ verified: boolean; accountName?: string; reference: string }>;
}

export type MonnifyIdentityHttp = (
  url: string,
  options: {
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  },
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

export interface MonnifyIdentityConfig {
  apiKey?: string;
  secretKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class MonnifyIdentityAdapter implements NigeriaIdentityVerificationProvider {
  readonly id = "monnify-identity";
  private baseUrl: string;
  private timeoutMs: number;

  constructor(
    private config: MonnifyIdentityConfig,
    private http: MonnifyIdentityHttp,
  ) {
    this.baseUrl = config.baseUrl || "https://api.monnify.com";
    this.timeoutMs = config.timeoutMs || 8000;
  }

  private async getAccessToken(): Promise<string> {
    if (!this.config.apiKey || !this.config.secretKey) {
      throw new PortalError("MONNIFY_IDENTITY_CREDENTIALS_NOT_CONFIGURED", 503);
    }
    const authHeader = `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.secretKey}`).toString("base64")}`;
    const response = await this.http(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { Authorization: authHeader },
      timeoutMs: this.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new PortalError("MONNIFY_IDENTITY_AUTH_FAILED", 502);
    }

    try {
      const data = JSON.parse(response.body || "{}");
      if (data.requestSuccessful && data.responseBody?.accessToken) {
        return data.responseBody.accessToken;
      }
    } catch {
      // ignore
    }
    throw new PortalError("MONNIFY_IDENTITY_AUTH_FAILED", 502);
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown) {
    const token = await this.getAccessToken();
    const response = await this.http(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: this.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new PortalError("MONNIFY_IDENTITY_API_ERROR", 502);
    }

    try {
      return JSON.parse(response.body || "{}");
    } catch {
      throw new PortalError("MONNIFY_IDENTITY_MALFORMED_RESPONSE", 502);
    }
  }

  async verifyBvn(bvn: string, name?: string): Promise<{ verified: boolean; matchRate?: number; reference: string }> {
    if (!/^\d{11}$/.test(bvn)) {
      return { verified: false, reference: "invalid-bvn" };
    }

    const data = await this.call("POST", "/api/v1/vas/bvn-details", {
      bvn,
      name,
    });

    const successful = Boolean(data.requestSuccessful && data.responseBody);
    return {
      verified: successful,
      matchRate: data.responseBody?.matchPercentage ?? (successful ? 100 : 0),
      reference: data.responseBody?.bvn || bvn,
    };
  }

  async verifyNin(nin: string, name?: string): Promise<{ verified: boolean; matchRate?: number; reference: string }> {
    if (!/^\d{11}$/.test(nin)) {
      return { verified: false, reference: "invalid-nin" };
    }

    const data = await this.call("POST", "/api/v1/vas/nin-details", {
      nin,
      name,
    });

    const successful = Boolean(data.requestSuccessful && data.responseBody);
    return {
      verified: successful,
      matchRate: data.responseBody?.matchPercentage ?? (successful ? 100 : 0),
      reference: data.responseBody?.nin || nin,
    };
  }

  async verifyBankAccount(
    accountNumber: string,
    bankCode: string,
  ): Promise<{ verified: boolean; accountName?: string; reference: string }> {
    if (!/^\d{10}$/.test(accountNumber)) {
      return { verified: false, reference: "invalid-account" };
    }

    const path = `/api/v1/disbursements/account/validate?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`;
    const data = await this.call("GET", path);

    const successful = Boolean(data.requestSuccessful && data.responseBody?.accountName);
    return {
      verified: successful,
      accountName: data.responseBody?.accountName,
      reference: `${bankCode}:${accountNumber}`,
    };
  }
}
