import { PortalError } from "../portal/domain";
import { providerRequest } from "../providers/adapters/http";

// Risk signal and bot/device verification. Turnstile is wrapped behind a small
// verification abstraction; its result never becomes a final merchant or
// payment decision by itself.

export interface RiskSignalProvider {
  id: string;
  assessDevice(input: { ip?: string; userAgent?: string }): Promise<{
    risk: "low" | "medium" | "high" | "unknown";
  }>;
}

export interface TurnstileResult {
  success: boolean;
  hostname?: string;
}

export interface TurnstileVerifier {
  verify(token: string, remoteIp?: string): Promise<TurnstileResult>;
}

export function unconfiguredRisk(id: string): RiskSignalProvider {
  return {
    id,
    async assessDevice() {
      throw new PortalError("RISK_SIGNAL_PROVIDER_NOT_CONFIGURED", 503);
    },
  };
}

// Turnstile siteverify. The secret is resolved at verify time via the secret
// manager; without a configured secret the verifier fails closed.
export function turnstileVerifier(deps: {
  secret(): Promise<string>;
  http?: typeof providerRequest;
}): TurnstileVerifier {
  const http = deps.http ?? providerRequest;
  return {
    async verify(token, remoteIp) {
      if (!token) return { success: false };
      const secret = await deps.secret();
      if (!secret) throw new PortalError("TURNSTILE_NOT_CONFIGURED", 503);
      const response = await http("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        path: "/siteverify",
        body: JSON.stringify({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
      });
      if (response.status < 200 || response.status >= 300)
        throw new PortalError("TURNSTILE_VERIFICATION_FAILED", 502);
      const parsed = JSON.parse(response.body || "{}") as {
        success?: boolean;
        hostname?: string;
      };
      return { success: parsed.success === true, hostname: parsed.hostname };
    },
  };
}

export const riskProviders = {
  device: unconfiguredRisk("device-risk"),
};
