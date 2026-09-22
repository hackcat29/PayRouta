import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { ProviderHttpOptions } from "../adapters/http";
import {
  mapProviderStatus,
  providerErrorSchema,
  providerPaymentStatuses,
} from "./contract";
import type { ExecutionAdapter } from "../../payments/execution";

// One StandardProviderAdapter speaks the PayRouta Provider API for every
// conforming provider. A provider implementing the standard protocol never
// receives a custom code deployment inside PayRouta.

export const standardConfigSchema = z
  .object({
    adapter: z.literal("standard").default("standard"),
    mode: z.literal("STANDARD").default("STANDARD"),
    maintainedBy: z.literal("PROVIDER").default("PROVIDER"),
    baseUrl: z.string().refine((v) => {
      try {
        return new URL(v).protocol === "https:";
      } catch {
        return false;
      }
    }, "baseUrl must be HTTPS"),
    auth: z.enum(["bearer", "api-key"]).default("bearer"),
    credentialRef: z.string().max(100).optional(),
    webhookSecretRef: z.string().max(100).optional(),
    healthPath: z
      .string()
      .regex(/^\/[a-zA-Z0-9/_-]*$/)
      .default("/health"),
    events: z.enum(["webhook", "poll"]).default("webhook"),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
    retries: z.number().int().min(0).max(2).default(1),
  })
  .strict();

export type StandardDeps = {
  http: (
    baseUrl: string,
    options: ProviderHttpOptions,
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  credentials: { get(ref: string): Promise<string> };
  clock: () => Date;
};

const paymentResponseSchema = z
  .object({
    providerPaymentId: z.string().min(1).max(200),
    status: z.enum(providerPaymentStatuses),
  })
  .strict();

const paymentStatusSchema = z
  .object({
    providerPaymentId: z.string().min(1).max(200),
    status: z.enum(providerPaymentStatuses),
    amount: z.string().regex(/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/),
    asset: z
      .object({
        kind: z.enum(["fiat", "blockchain"]),
        identifier: z.string(),
        network: z.string(),
      })
      .strict(),
  })
  .strict();

export function standardExecutionAdapter(
  config: unknown,
  deps: StandardDeps,
): ExecutionAdapter {
  // Stored portal integrations include review-only fields that are not part of
  // the execution request. Remove them before checking the strict protocol.
  const executionConfig =
    config && typeof config === "object" && !Array.isArray(config)
      ? (({ mappings, signing, ...rest }) => {
          void mappings;
          void signing;
          return rest;
        })(config as Record<string, unknown>)
      : config;
  const parsed = standardConfigSchema.safeParse(executionConfig);
  if (!parsed.success) throw new PortalError("INVALID_CONFIGURATION", 409);
  const c = parsed.data;
  const bearer = async () => {
    if (!c.credentialRef)
      throw new PortalError("PROVIDER_CREDENTIALS_NOT_CONFIGURED", 409);
    return deps.credentials.get(c.credentialRef);
  };
  const headers = async (): Promise<Record<string, string>> => {
    const token = await bearer();
    const out: Record<string, string> = {};
    out[c.auth === "bearer" ? "Authorization" : "X-API-Key"] =
      c.auth === "bearer" ? `Bearer ${token}` : token;
    return out;
  };
  const call = async (
    options: Omit<ProviderHttpOptions, "method"> & { method: ProviderHttpOptions["method"] },
  ) => {
    const response = await deps.http(c.baseUrl, {
      ...options,
      timeoutMs: c.timeoutMs,
      headers: { ...(await headers()), ...(options.headers || {}) },
    });
    if (response.status < 200 || response.status >= 300) {
      let code = "UNKNOWN_PROVIDER_ERROR";
      try {
        const parsed = providerErrorSchema.parse(JSON.parse(response.body || "{}"));
        code = parsed.error.code;
      } catch {
        // Keep the normalized failure; never leak upstream bodies.
      }
      throw new PortalError(`PROVIDER_ERROR:${code}`, 502);
    }
    return response.body ? JSON.parse(response.body) : {};
  };
  return {
    operations: ["create-payment", "payment-status", "cancel-payment"],
    async create(attempt, intent) {
      const body = {
        idempotencyKey: attempt.key,
        reference: intent.reference,
        amount: intent.amount,
        asset: intent.asset,
        method: intent.selectedMethod,
        metadata: intent.metadata,
      };
      const response = paymentResponseSchema.parse(
        await call({ method: "POST", path: "/payments", body: JSON.stringify(body) }),
      );
      return {
        state: mapProviderStatus(response.status),
        reference: response.providerPaymentId,
      };
    },
    async status(attempt) {
      const id = attempt.providerReference;
      if (!id) return null;
      const data = paymentStatusSchema.parse(
        await call({
          method: "GET",
          path: `/payments/${encodeURIComponent(id)}`,
        }),
      );
      return {
        state: mapProviderStatus(data.status),
        reference: data.providerPaymentId,
        amount: data.amount,
        asset: data.asset,
      };
    },
  };
}

// Webhook signature verification for STANDARD providers. PayRouta verifies
// HMAC-SHA256(timestamp.eventId.body) against the provider's signing secret.
export function verifyStandardWebhook(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
  supplied: string,
  now: Date,
): boolean {
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(now.getTime() - Number(timestamp) * 1000) > 300000 ||
    !/^[a-f0-9]{64}$/.test(supplied)
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${body}`)
    .digest("hex");
  return timingSafeEqual(
    Buffer.from(expected, "hex"),
    Buffer.from(supplied, "hex"),
  );
}
