import { createHash } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import {
  currencyExponent,
  toMinorUnits,
  fromMinorUnits,
} from "../../../partners/money";
import { assertPaymentHost } from "../../../partners/contract";
import type { ProviderHttpOptions } from "../http";
import type { ExecutionAdapter } from "../../normalized";

export type NativeDeps = {
  deposits?: import("../../../blockchain/deposit-types").DepositStore;
  http(
    baseUrl: string,
    options: ProviderHttpOptions,
  ): Promise<{ status: number; headers: Record<string, string>; body: string }>;
  credentials: { get(ref: string): Promise<string> };
  now?: () => Date;
};
export type NativeIntent = Parameters<ExecutionAdapter["create"]>[1];
export type NativeAttempt = Parameters<ExecutionAdapter["create"]>[0];
export const nativeFields = {
  mode: z.literal("NATIVE").default("NATIVE"),
  maintainedBy: z.literal("PAYROUTA").default("PAYROUTA"),
  environment: z.enum(["sandbox", "production"]),
  timeoutMs: z.number().int().min(500).max(15000).default(8000),
};
export const secretRef = z.string().min(1).max(200);
export const httpsUrl = z.url().refine((raw) => {
  const u = new URL(raw);
  return u.protocol === "https:" && !u.username && !u.password;
});
export function parseConfig<T>(schema: z.ZodType<T>, input: unknown): T {
  const value = schema.safeParse(input);
  if (!value.success) throw new PortalError("INVALID_CONFIGURATION", 409);
  return value.data;
}
export async function secret(deps: NativeDeps, ref: string) {
  const value = await deps.credentials.get(ref);
  if (!value) throw new PortalError("PROVIDER_CREDENTIALS_NOT_CONFIGURED", 409);
  return value;
}
export function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
  return input as Record<string, unknown>;
}
export function textField(input: unknown, max = 200): string {
  if (typeof input !== "string" || !input || input.length > max)
    throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
  return input;
}
export function amountField(input: unknown): string {
  // JSON numbers are accepted only when the minor-unit value is exact. Never
  // round an upstream monetary value or supply an invoice amount as evidence.
  const v =
    typeof input === "number" &&
    Number.isFinite(input) &&
    Math.abs(input) <= Number.MAX_SAFE_INTEGER
      ? String(input)
      : input;
  if (typeof v !== "string" || !/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/.test(v))
    throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
  return v;
}
export function fiatMoney(intent: NativeIntent) {
  const asset = object(intent.asset);
  if (
    asset.kind !== "fiat" ||
    typeof asset.identifier !== "string" ||
    asset.network !== ""
  )
    throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  const currency = asset.identifier;
  const precision = intent.precision ?? currencyExponent(currency);
  const minor =
    precision === null
      ? null
      : toMinorUnits(intent.amount, precision, currency);
  if (minor === null || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw new PortalError("INVALID_PROVIDER_AMOUNT", 409);
  return {
    currency,
    minor,
    value: Number(minor),
    amount: fromMinorUnits(minor, currency)!,
  };
}
export function fiatAsset(currency: string) {
  if (!/^[A-Z]{3}$/.test(currency))
    throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
  return { kind: "fiat", identifier: currency, network: "" };
}
export function minorAmount(input: unknown, currency: string): string {
  if (
    !(typeof input === "number" && Number.isSafeInteger(input) && input >= 0) &&
    !(typeof input === "string" && /^\d+$/.test(input))
  )
    throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
  const amount = fromMinorUnits(input as number | string, currency);
  if (amount === null) throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
  return amount;
}
export function metadata(intent: NativeIntent) {
  return intent.metadata &&
    typeof intent.metadata === "object" &&
    !Array.isArray(intent.metadata)
    ? (intent.metadata as Record<string, unknown>)
    : {};
}
// Optional brand/rail hints are restrictions, never permission to silently
// use another wallet or another bank rail.
export function assertHints(
  intent: NativeIntent,
  wallets: readonly string[] = [],
  rails: readonly string[] = [],
) {
  const m = metadata(intent);
  if (
    (m.preferred_wallet !== undefined &&
      (typeof m.preferred_wallet !== "string" ||
        !wallets.includes(m.preferred_wallet))) ||
    (m.payment_rail !== undefined &&
      (typeof m.payment_rail !== "string" || !rails.includes(m.payment_rail)))
  )
    throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
}
export function checkEnvironment(
  config: { environment: string },
  attempt: NativeAttempt,
) {
  if (config.environment !== attempt.environment)
    throw new PortalError("PROVIDER_ENVIRONMENT_MISMATCH", 409);
}
export function stableId(key: string, length = 32) {
  return createHash("sha256").update(key).digest("hex").slice(0, length);
}
export function uuidId(key: string) {
  const h = stableId(key);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20)}`;
}
export function redirect(
  provider: string,
  raw: unknown,
  hosts: readonly string[],
) {
  const url = assertPaymentHost(hosts, textField(raw, 2048));
  return {
    kind: "redirect",
    provider,
    url,
    text: `Continue to ${provider} to pay.`,
  };
}
export function mappedState(value: unknown, mapping: Record<string, string>) {
  return typeof value === "string" ? (mapping[value] ?? "Unknown") : "Unknown";
}
export async function request(
  deps: NativeDeps,
  baseUrl: string,
  options: ProviderHttpOptions,
) {
  const res = await deps.http(baseUrl, options);
  if (res.status < 200 || res.status >= 300) {
    // Rejection of creation can be ambiguous; callers never manufacture a
    // definitive financial rejection from transport or HTTP errors.
    throw new PortalError(
      res.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_API_UNAVAILABLE",
      503,
    );
  }
  if (!res.body) return {};
  try {
    return object(JSON.parse(res.body));
  } catch {
    throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
  }
}
