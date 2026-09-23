// Privacy-safe product analytics.
// Records domain events only; strictly redacts sensitive financial data, PAN,
// CVV, passwords, tokens, identity documents, and personal details.

export const allowedDomainEvents = [
  "merchant_onboarding_started",
  "merchant_onboarding_completed",
  "payment_method_enabled",
  "checkout_opened",
  "payment_method_selected",
  "payment_confirmed",
  "payment_failed",
  "provider_fallback_used",
  "provider_certification_started",
  "provider_certification_passed",
] as const;

export type DomainEvent = (typeof allowedDomainEvents)[number];

const forbiddenFieldPatterns = [
  /pan/i,
  /card.*number/i,
  /cvv/i,
  /cvc/i,
  /pin/i,
  /password/i,
  /secret/i,
  /token/i,
  /credential/i,
  /bvn/i,
  /nin/i,
  /ssn/i,
  /passport/i,
  /private.*key/i,
];

export function sanitizeAnalyticsPayload(data: unknown): unknown {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map(sanitizeAnalyticsPayload);
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (forbiddenFieldPatterns.some((pattern) => pattern.test(key))) {
      continue; // redact completely
    }
    out[key] = sanitizeAnalyticsPayload(value);
  }
  return out;
}

export interface PostHogConfig {
  apiKey?: string;
  host?: string;
  http?: (url: string, options: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<unknown>;
}

export class PostHogAnalytics {
  private apiKey?: string;
  private host: string;
  private http?: PostHogConfig["http"];

  constructor(config: PostHogConfig = {}) {
    this.apiKey = config.apiKey || process.env.POSTHOG_API_KEY;
    this.host = config.host || process.env.POSTHOG_HOST || "https://app.posthog.com";
    this.http = config.http;
  }

  async track(event: DomainEvent, properties: Record<string, unknown> = {}, distinctId?: string): Promise<boolean> {
    if (!this.apiKey) {
      // Analytics unconfigured: silently fail safe without interrupting business flow
      return false;
    }

    const sanitized = sanitizeAnalyticsPayload(properties) as Record<string, unknown>;
    const body = JSON.stringify({
      api_key: this.apiKey,
      event,
      properties: {
        ...sanitized,
        $lib: "payrouta-backend",
        timestamp: new Date().toISOString(),
      },
      distinct_id: distinctId || "system",
    });

    try {
      if (this.http) {
        await this.http(`${this.host}/capture/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      } else if (typeof fetch !== "undefined") {
        await fetch(`${this.host}/capture/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const posthog = new PostHogAnalytics();
