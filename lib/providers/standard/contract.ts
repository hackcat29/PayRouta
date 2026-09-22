import { z } from "zod";

// Wire protocol for the PayRouta Provider API (STANDARD integration mode).
//
// A provider implementing this protocol is never given a custom code deployment
// inside PayRouta. PayRouta runs one StandardProviderAdapter against every
// conforming provider.

// Provider-facing payment status vocabulary. These are the only strings the
// Provider API may return; they map deterministically into PayRouta's
// normalized execution states.
export const providerPaymentStatuses = [
  "pending",
  "processing",
  "action_required",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type ProviderPaymentStatus = (typeof providerPaymentStatuses)[number];

export const normalizedPaymentStates = [
  "Pending",
  "Requires action",
  "Confirmed",
  "Rejected",
  "Unknown",
] as const;
export type NormalizedPaymentState = (typeof normalizedPaymentStates)[number];

// Deterministic, total status mapping. Unknown upstream strings are rejected
// rather than silently assumed positive.
export function mapProviderStatus(
  status: string,
): NormalizedPaymentState {
  switch (status) {
    case "succeeded":
      return "Confirmed";
    case "failed":
    case "cancelled":
      return "Rejected";
    case "action_required":
      return "Requires action";
    case "pending":
    case "processing":
      return "Pending";
    default:
      throw new Error(`UNKNOWN_PROVIDER_STATUS: ${status}`);
  }
}

export const providerErrorCodes = [
  "INVALID_REQUEST",
  "AUTHENTICATION_FAILURE",
  "AUTHORIZATION_FAILURE",
  "IDEMPOTENCY_CONFLICT",
  "NOT_FOUND",
  "RATE_LIMITED",
  "UNSUPPORTED_OPERATION",
  "PROVIDER_UNAVAILABLE",
  "UNKNOWN_PROVIDER_ERROR",
] as const;
export type ProviderErrorCode = (typeof providerErrorCodes)[number];

// Response envelope of the Provider API error model.
export const providerErrorSchema = z
  .object({
    error: z.object({
      code: z.enum(providerErrorCodes),
      message: z.string().max(500),
    }),
  })
  .strict();

export interface StandardConfig {
  baseUrl: string;
  auth: "bearer" | "api-key";
  credentialRef?: string;
  webhookSecretRef?: string;
  healthPath: string;
  events: "webhook" | "poll";
  timeoutMs: number;
  retries: number;
}
