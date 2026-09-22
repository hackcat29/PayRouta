import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { ProviderHttpOptions } from "./http";
import {
  mapProviderStatus,
  providerPaymentStatuses,
} from "../standard/contract";
import type { ExecutionAdapter } from "../../payments/execution";

// Declarative, constrained mapping of a provider's existing API. No arbitrary
// JavaScript, no expression engine, no arbitrary outbound hosts. Paths must be
// relative; the base URL is validated as HTTPS and DNS-pinned at request time.

const relativePath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (v) => v.startsWith("/") && !/^\/\//.test(v) && !v.includes("://"),
    "Path must be a relative path",
  );

const bodyField = z.union([
  z.object({ source: z.enum(["amount", "reference", "idempotencyKey", "method"]) }),
  z.object({ literal: z.string().max(500) }),
]);
export type BodyField = z.infer<typeof bodyField>;

const responseMapping = z
  .object({
    reference: z.string().min(1).max(100),
    status: z.string().min(1).max(100),
    amount: z.string().min(1).max(100).optional(),
  })
  .strict();

const endpointSpec = z.object({
  method: z.enum(["GET", "POST"]),
  path: relativePath,
  body: z.record(z.string().max(100), bodyField).optional(),
  response: responseMapping,
});

export const configurableConfigSchema = z
  .object({
    adapter: z.literal("configurable"),
    mode: z.literal("CONFIGURABLE").default("CONFIGURABLE"),
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
    healthPath: relativePath.default("/health"),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
    retries: z.number().int().min(0).max(2).default(1),
    create: endpointSpec,
    status: endpointSpec,
    cancel: endpointSpec.optional(),
    statusMap: z
      .record(z.string().max(60), z.enum(providerPaymentStatuses))
      .refine((v) => Object.keys(v).length > 0, "statusMap is required"),
  })
  .strict();

export type ConfigurableDeps = {
  http: (
    baseUrl: string,
    options: ProviderHttpOptions,
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  credentials: { get(ref: string): Promise<string> };
};

// Bounded JSON path access. Only literal object keys and array indices; never
// prototype members.
function resolvePath(value: unknown, path: string): unknown {
  const segments = path.split(".").filter(Boolean);
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (segment === "__proto__" || segment === "constructor" || segment === "prototype")
      return undefined;
    if (typeof current !== "object") return undefined;
    const obj = current as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, segment)) return undefined;
    current = obj[segment];
  }
  return current;
}

function resolveBody(
  template: Record<string, BodyField>,
  sources: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [field, spec] of Object.entries(template)) {
    if ("literal" in spec) out[field] = spec.literal;
    else out[field] = sources[spec.source];
  }
  return out;
}

export function configurableExecutionAdapter(
  config: unknown,
  deps: ConfigurableDeps,
): ExecutionAdapter {
  const parsed = configurableConfigSchema.safeParse(config);
  if (!parsed.success) throw new PortalError("INVALID_CONFIGURATION", 409);
  const c = parsed.data;
  const bearer = async () => {
    if (!c.credentialRef)
      throw new PortalError("PROVIDER_CREDENTIALS_NOT_CONFIGURED", 409);
    return deps.credentials.get(c.credentialRef);
  };
  const authHeaders = async (): Promise<Record<string, string>> => {
    const token = await bearer();
    const out: Record<string, string> = {};
    out[c.auth === "bearer" ? "Authorization" : "X-API-Key"] =
      c.auth === "bearer" ? `Bearer ${token}` : token;
    return out;
  };
  const call = async (
    options: Omit<ProviderHttpOptions, "method" | "path"> &
      Pick<ProviderHttpOptions, "method" | "path">,
  ) => {
    const response = await deps.http(c.baseUrl, {
      ...options,
      timeoutMs: c.timeoutMs,
      headers: { ...(await authHeaders()), ...(options.headers || {}) },
    });
    if (response.status < 200 || response.status >= 300)
      throw new PortalError("PROVIDER_ERROR", 502);
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.body || "{}");
    } catch {
      throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
    }
    return parsed;
  };
  const mapStatus = (raw: unknown): string => {
    const key = typeof raw === "string" ? raw : String(raw ?? "");
    const mapped = c.statusMap[key];
    if (!mapped) throw new PortalError(`UNKNOWN_PROVIDER_STATUS: ${key}`, 502);
    return mapProviderStatus(mapped);
  };
  return {
    operations: [
      "create-payment",
      "payment-status",
      ...(c.cancel ? ["cancel-payment" as const] : []),
    ],
    async create(attempt, intent) {
      const sources = {
        amount: intent.amount,
        reference: intent.reference,
        idempotencyKey: attempt.key,
        method: intent.selectedMethod ?? "",
      };
      const parsed = await call({
        method: c.create.method,
        path: c.create.path,
        ...(c.create.body
          ? { body: JSON.stringify(resolveBody(c.create.body, sources)) }
          : {}),
      });
      const reference = resolvePath(parsed, c.create.response.reference);
      const status = resolvePath(parsed, c.create.response.status);
      if (typeof reference !== "string" || !reference)
        throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
      return { state: mapStatus(status), reference };
    },
    async status(attempt) {
      const id = attempt.providerReference;
      if (!id) return null;
      const path = c.status.path.replace(
        "{reference}",
        encodeURIComponent(id),
      );
      const parsed = await call({ method: c.status.method, path });
      const reference = resolvePath(parsed, c.status.response.reference);
      const status = resolvePath(parsed, c.status.response.status);
      const amount = c.status.response.amount
        ? resolvePath(parsed, c.status.response.amount)
        : undefined;
      if (typeof reference !== "string" || !reference)
        throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
      return {
        state: mapStatus(status),
        reference,
        amount: typeof amount === "string" ? amount : "",
        asset: undefined,
      };
    },
  };
}
