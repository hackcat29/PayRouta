import { z } from "zod";
import { integrationSchema, capabilitySchema, PortalError } from "./domain";
import type { SecretManager } from "./adapters";

export const adapterOperations = [
  "health",
  "availability",
  "capacity",
  "capabilities",
  "verify-event",
] as const;
export type AdapterOperation = (typeof adapterOperations)[number];
export const adapterErrorCodes = [
  "UNSUPPORTED_OPERATION",
  "INVALID_CONFIGURATION",
  "AUTHENTICATION_FAILURE",
  "AUTHORIZATION_FAILURE",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_FAILURE",
  "MALFORMED_RESPONSE",
  "PROVIDER_UNAVAILABLE",
  "UNKNOWN_PROVIDER_ERROR",
] as const;
export type AdapterErrorCode = (typeof adapterErrorCodes)[number];
export type AdapterResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: AdapterErrorCode; diagnostic: string } };
export interface AdapterDependencies {
  credentials: Pick<SecretManager, "get">;
  http: (
    url: string,
    token: string | undefined,
    signal: AbortSignal,
  ) => Promise<{ status: number; bytes: number }>;
  clock: () => Date;
  telemetry: (event: string, values: Record<string, string | number>) => void;
}
export interface ProviderAdapter {
  id: string;
  version: "1";
  environments: readonly ("sandbox" | "production")[];
  operations: readonly AdapterOperation[];
  validate(config: unknown): boolean;
  observe(
    operation: AdapterOperation,
    input: { capabilityId?: string; config: unknown; credentialRef?: string },
    deps: AdapterDependencies,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export function normalizeProviderError(error: unknown): AdapterErrorCode {
  // Only whitelisted codes/statuses survive; no upstream message or body leaves this boundary.
  const e = error as { code?: string; status?: number; name?: string } | null;
  if (e?.status === 401) return "AUTHENTICATION_FAILURE";
  if (e?.status === 403) return "AUTHORIZATION_FAILURE";
  if (e?.status === 429) return "RATE_LIMITED";
  if (e?.status && e.status >= 500) return "PROVIDER_UNAVAILABLE";
  if (e?.name === "AbortError" || e?.code === "ETIMEDOUT") return "TIMEOUT";
  if (["ECONNRESET", "ENOTFOUND", "ECONNREFUSED"].includes(e?.code || ""))
    return "NETWORK_FAILURE";
  if (adapterErrorCodes.includes(e?.code as AdapterErrorCode))
    return e!.code as AdapterErrorCode;
  return "UNKNOWN_PROVIDER_ERROR";
}
const fixtureAdapter: ProviderAdapter = {
  id: "simulator",
  version: "1",
  environments: ["sandbox"],
  operations: ["health", "availability", "capacity"],
  validate: (config) =>
    integrationSchema.safeParse(config).success &&
    (config as { adapter: string }).adapter === "simulator",
  async observe(operation, input) {
    if (operation !== "health" && !input.capabilityId)
      throw { code: "INVALID_CONFIGURATION" };
    if (operation === "capacity") return { remaining: "5000000" };
    return { status: "Available" };
  },
};
// Explicit code registration only. Never import a module from a manifest.
const trustedAdapters: readonly ProviderAdapter[] = [fixtureAdapter];
export function resolveProviderAdapter(
  id: string,
  version: string,
  environment: string,
) {
  const adapter = trustedAdapters.find(
    (a) => a.id === id && a.version === version,
  );
  if (
    !adapter ||
    !adapter.environments.includes(environment as "sandbox" | "production")
  )
    throw new PortalError(
      "ADAPTER_INCOMPATIBLE: no trusted implementation for this environment/version",
      409,
    );
  return adapter;
}
export function assertAdapterConfiguration(
  id: string,
  version: string,
  environment: string,
  config: unknown,
) {
  const adapter = resolveProviderAdapter(id, version, environment);
  if (!adapter.validate(config))
    throw new PortalError("INVALID_CONFIGURATION", 409);
  return adapter;
}
const statusResult = z
  .object({
    status: z.enum([
      "Available",
      "Unavailable",
      "Degraded",
      "Unknown",
      "Maintenance",
    ]),
  })
  .strict();
export async function observeProvider(
  adapter: ProviderAdapter,
  operation: AdapterOperation,
  input: Parameters<ProviderAdapter["observe"]>[1],
  deps: AdapterDependencies,
  options: { timeoutMs?: number; signal?: AbortSignal; diagnostic: string },
): Promise<AdapterResult> {
  const failure = (code: AdapterErrorCode): AdapterResult => ({
    ok: false,
    error: { code, diagnostic: options.diagnostic },
  });
  if (!adapter.operations.includes(operation))
    return failure("UNSUPPORTED_OPERATION");
  if (!adapter.validate(input.config)) return failure("INVALID_CONFIGURATION");
  const started = deps.clock().getTime();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      const fail = () => reject({ code: "TIMEOUT" });
      controller.signal.addEventListener("abort", fail, { once: true });
      timer = setTimeout(
        abort,
        Math.max(1, Math.min(options.timeoutMs || 8000, 15000)),
      );
      if (options.signal?.aborted) abort();
    });
    const value = await Promise.race([
      adapter.observe(operation, input, deps, controller.signal),
      deadline,
    ]);
    const schema =
      operation === "capacity"
        ? z
            .object({
              remaining: z.string().regex(/^(0|[1-9]\d{0,29})(\.\d{1,18})?$/),
            })
            .strict()
        : operation === "capabilities"
          ? z.array(capabilitySchema).max(100)
          : operation === "verify-event"
            ? z.object({ verified: z.boolean() }).strict()
            : statusResult;
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : failure("MALFORMED_RESPONSE");
  } catch (error) {
    return failure(normalizeProviderError(error));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    deps.telemetry("provider.probe", {
      adapter: adapter.id,
      operation,
      latencyMs: Math.max(0, deps.clock().getTime() - started),
    });
  }
}
