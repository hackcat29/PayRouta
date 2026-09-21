import { z } from "zod";
import referenceData from "./reference-data.json";
export const roles = [
  "Owner",
  "Admin",
  "Developer",
  "Compliance",
  "Analyst",
] as const;
export type Role = (typeof roles)[number];
export type Permission =
  | "read"
  | "company"
  | "configure"
  | "compliance"
  | "integration"
  | "submit"
  | "team"
  | "ownership";
export const roleMatrix: Record<Role, Permission[]> = {
  Owner: [
    "read",
    "company",
    "configure",
    "compliance",
    "integration",
    "submit",
    "team",
    "ownership",
  ],
  Admin: [
    "read",
    "company",
    "configure",
    "compliance",
    "integration",
    "submit",
    "team",
  ],
  Developer: ["read", "integration"],
  Compliance: ["read", "company", "compliance"],
  Analyst: ["read"],
};
export function can(role: string, permission: Permission) {
  return (roleMatrix[role as Role] || []).includes(permission);
}
export class PortalError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const environments = ["sandbox", "production"] as const;
export const providerTypes = [
  "PSP",
  "Bank",
  "Card acquirer",
  "Mobile money operator",
  "Mobile money aggregator",
  "Stablecoin ramp",
  "Exchange",
  "Payout provider",
  "Other infrastructure",
] as const;
export const countries = referenceData.countries;
export const fiat = referenceData.currencies;
export function allowedRoute(role: string, route: string) {
  if (["Owner", "Admin"].includes(role)) return true;
  if (
    ["overview", "settings", "organizations/new", "team"].includes(route) ||
    /^(transactions|settlements|performance|availability)(\/|$)/.test(route)
  )
    return true;
  if (role === "Developer")
    return (
      /^(integration|sandbox)(\/|$)/.test(route) ||
      route === "onboarding/integration"
    );
  if (role === "Compliance")
    return [
      "onboarding",
      "onboarding/company",
      "onboarding/compliance",
      "application",
      "audit-log",
    ].includes(route);
  return false;
}
const text = z.string().trim().max(2000);
const required = text.min(1, "Required");
const country = z
  .string()
  .refine(
    (v) => countries.some((c) => c.id === v),
    "Choose a supported country identifier",
  );
export const decimal = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,29})(\.\d{1,18})?$/,
    "Use a positive decimal string with up to 18 fractional digits",
  );
export function units(value: string) {
  const [whole, part = ""] = decimal.parse(value).split(".");
  return BigInt(whole) * 10n ** 18n + BigInt(part.padEnd(18, "0"));
}
export const assetSchema = z
  .object({
    kind: z.enum(["fiat", "blockchain"]),
    identifier: required,
    network: text,
  })
  .superRefine((v, c) => {
    if (v.kind === "fiat" && !fiat.includes(v.identifier))
      c.addIssue({
        code: "custom",
        message: "Choose an ISO currency",
        path: ["identifier"],
      });
    if (
      v.kind === "blockchain" &&
      (!/^[a-z0-9-]+:[A-Za-z0-9_-]+$/.test(v.network) ||
        !/^[a-z0-9-]+:[A-Za-z0-9._-]+$/.test(v.identifier))
    )
      c.addIssue({
        code: "custom",
        message:
          "Blockchain assets require a network and a namespaced asset identifier",
        path: ["network"],
      });
  });
export const methodRails = {
  "bank-transfer": { family: "bank", rail: "ng-nibss" },
  card: { family: "card", rail: "card-network" },
  "mobile-money": { family: "mobile-money", rail: "mobile-money-network" },
  stablecoin: { family: "stablecoin", rail: "onchain" },
} as const;
export const fulfillmentSchema = z
  .object({
    profileId: z.string().regex(/^[a-z][a-z0-9_-]{2,60}$/),
    method: z.enum(["bank-transfer", "card", "mobile-money", "stablecoin"]),
    integrationId: z.string().min(1).max(100),
    adapterVersion: z.literal("1"),
    inputPrecision: z.number().int().min(0).max(18),
    settlementAsset: assetSchema,
    settlementPrecision: z.number().int().min(0).max(18),
    operations: z
      .array(
        z.enum([
          "pay-in",
          "payout",
          "conversion",
          "authorization",
          "settlement",
        ]),
      )
      .min(1)
      .max(5),
    verification: z.enum(["none", "verified"]),
    checks: z
      .array(z.enum(["health", "availability", "capacity"]))
      .min(1)
      .max(3),
    // Local wall-clock intervals; overnight windows must be split across days.
    schedule: z
      .array(
        z
          .object({
            days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
            start: z.number().int().min(0).max(1439),
            end: z.number().int().min(1).max(1440),
          })
          .refine((v) => v.start < v.end, "Schedule start must precede end"),
      )
      .max(21),
    provenance: z.enum([
      "provider-declared",
      "operator-maintained",
      "adapter-discovered",
    ]),
  })
  .strict();
export type Fulfillment = z.infer<typeof fulfillmentSchema>;
export function sameAsset(
  a: z.infer<typeof assetSchema>,
  b: z.infer<typeof assetSchema>,
) {
  return (
    a.kind === b.kind &&
    a.identifier === b.identifier &&
    a.network === b.network
  );
}
export function precisionValid(value: string, precision: number) {
  return (value.split(".")[1]?.length || 0) <= precision;
}
export function fiatPrecision(identifier: string) {
  return new Intl.NumberFormat("en", {
    style: "currency",
    currency: identifier,
  }).resolvedOptions().maximumFractionDigits;
}
export const capabilitySchema = z
  .object({
    fulfillment: fulfillmentSchema.optional(),
    capabilityId: z.string().regex(/^[a-z][a-z0-9_-]{2,60}$/),
    version: z.number().int().positive(),
    family: z.enum([
      "bank",
      "card",
      "mobile-money",
      "stablecoin",
      "crypto",
      "local",
    ]),
    rail: required,
    operation: z.enum([
      "pay-in",
      "payout",
      "conversion",
      "authorization",
      "settlement",
    ]),
    origin: country,
    destination: country,
    input: assetSchema,
    output: assetSchema.optional(),
    minimum: decimal,
    maximum: decimal,
    daily: decimal,
    limitAsset: required,
    settlement: required,
    hours: required,
    timezone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Use an IANA timezone"),
    availability: z.enum(["webhook", "poll", "manual"]),
    conditions: required,
    endpoint: required,
    environment: z.enum(environments),
  })
  .superRefine((v, c) => {
    const issue = (message: string, path: string) =>
      c.addIssue({ code: "custom", message, path: [path] });
    if (v.fulfillment) {
      const f = v.fulfillment;
      const controlled = methodRails[f.method];
      const operations: Record<typeof f.method, readonly string[]> = {
        "bank-transfer": ["pay-in", "payout", "settlement"],
        card: ["pay-in", "authorization", "settlement"],
        "mobile-money": ["pay-in", "payout", "settlement"],
        stablecoin: ["pay-in", "payout", "conversion", "settlement"],
      };
      if (!operations[f.method].includes(v.operation))
        issue("METHOD_OPERATION_INVALID", "operation");
      if (controlled.family !== v.family || controlled.rail !== v.rail)
        issue(
          "METHOD_RAIL_INVALID: select the controlled family and rail",
          "rail",
        );
      if (
        !f.operations.includes(v.operation) ||
        !f.operations.includes("settlement") ||
        new Set(f.operations).size !== f.operations.length
      )
        issue(
          "FULFILLMENT_INCOMPLETE: include the declared operation and settlement exactly once",
          "fulfillment",
        );
      if (
        !sameAsset(v.input, f.settlementAsset) &&
        (!f.operations.includes("conversion") ||
          !v.output ||
          !sameAsset(v.output, f.settlementAsset))
      )
        issue(
          "SETTLEMENT_UNSUPPORTED: conversion and explicit matching output required",
          "fulfillment",
        );
      if (v.output && !sameAsset(v.output, f.settlementAsset))
        issue(
          "SETTLEMENT_UNSUPPORTED: output must match profile settlement",
          "output",
        );
      if (
        !f.checks.includes("health") ||
        !f.checks.includes("availability") ||
        !f.checks.includes("capacity") ||
        new Set(f.checks).size !== f.checks.length
      )
        issue(
          "CHECKS_REQUIRED: health, capability availability and remaining daily capacity are mandatory",
          "fulfillment",
        );
      for (const key of ["minimum", "maximum", "daily"] as const)
        if (!precisionValid(v[key], f.inputPrecision))
          issue("AMOUNT_PRECISION_INVALID", key);
      if (
        v.input.kind === "fiat" &&
        (v.input.network ||
          f.inputPrecision !== fiatPrecision(v.input.identifier))
      )
        issue("ASSET_PRECISION_INVALID", "input");
      if (
        f.settlementAsset.kind === "fiat" &&
        (f.settlementAsset.network ||
          f.settlementPrecision !== fiatPrecision(f.settlementAsset.identifier))
      )
        issue("ASSET_PRECISION_INVALID", "fulfillment");
      for (const day of [0, 1, 2, 3, 4, 5, 6]) {
        const windows = f.schedule
          .filter((w) => w.days.includes(day))
          .sort((a, b) => a.start - b.start);
        if (
          windows.some(
            (w, i) =>
              new Set(w.days).size !== w.days.length ||
              (i > 0 && windows[i - 1].end > w.start),
          )
        )
          issue(
            "SCHEDULE_INVALID: duplicate or overlapping intervals",
            "fulfillment",
          );
      }
    }
    if (units(v.minimum) > units(v.maximum))
      issue("Minimum exceeds maximum", "minimum");
    if (units(v.daily) < units(v.maximum))
      issue("Daily limit is below maximum transaction amount", "daily");
    if (v.limitAsset !== v.input.identifier)
      issue("Limits must identify the input asset", "limitAsset");
    if (v.operation === "conversion" && !v.output)
      issue("Conversion needs an explicit output asset", "output");
    if (v.operation === "authorization" && v.family !== "card")
      issue("Authorization requires the card family", "operation");
    if (
      ["stablecoin", "crypto"].includes(v.family) &&
      v.input.kind !== "blockchain" &&
      v.output?.kind !== "blockchain"
    )
      issue("Choose a network-aware blockchain asset", "input");
  });
export type CapabilityDefinition = z.infer<typeof capabilitySchema>;
export function capabilityKey(v: CapabilityDefinition) {
  return JSON.stringify([
    v.environment,
    v.fulfillment?.integrationId,
    v.family,
    v.rail.toLowerCase(),
    v.operation,
    v.origin,
    v.destination,
    v.input,
    v.output,
  ]);
}
export const companySchema = z.object({
  legalName: required,
  tradingName: required,
  website: z.url().refine((v) => v.startsWith("https://"), "Use HTTPS"),
  country,
  registration: text,
  address: required,
  providerType: z.enum(providerTypes),
  description: required,
  businessContact: z.email(),
  technicalContact: z.email(),
  complianceContact: z.email(),
});
export const coverageSchema = z.object({
  payerOrigins: z.array(country).min(1),
  merchantDestinations: z.array(country).min(1),
  jurisdictions: z.array(country).min(1),
  payIn: z.array(country),
  payout: z.array(country),
});
export const settlementSchema = z
  .object({
    assets: z.array(assetSchema).min(1),
    countries: z.array(country).min(1),
    schedule: required,
    minHours: z.number().int().nonnegative(),
    maxHours: z.number().int().nonnegative(),
    cutoff: required,
    timezone: required,
    holidays: text,
    fees: required,
    reconciliation: required,
    reporting: required,
  })
  .refine(
    (v) => v.minHours <= v.maxHours,
    "Minimum timing must not exceed maximum",
  );
export const integrationSchema = z.object({
  adapter: z.enum(["simulator", "provider"]),
  baseUrl: z.string().max(500),
  auth: z.enum(["bearer", "api-key", "mTLS"]),
  mappings: required,
  healthPath: z.string().regex(/^\/[a-zA-Z0-9/_-]*$/),
  events: z.enum(["webhook", "poll"]),
  signing: z.enum(["HMAC-SHA256"]),
  timeoutMs: z.number().int().min(500).max(15000),
  retries: z.number().int().min(0).max(2),
});
export type Draft = {
  company?: Partial<z.infer<typeof companySchema>>;
  coverage?: Partial<z.infer<typeof coverageSchema>>;
  capabilities?: CapabilityDefinition[];
  settlement?: Partial<z.infer<typeof settlementSchema>>;
  integration?: z.infer<typeof integrationSchema>;
};
export const sections = [
  "company",
  "coverage",
  "capabilities",
  "settlement",
  "compliance",
  "integration",
] as const;
export function checklist(draft: Draft, evidenceCount: number) {
  return [
    {
      id: "company",
      label: "Company details",
      complete: companySchema.safeParse(draft.company).success,
    },
    {
      id: "coverage",
      label: "Countries & coverage",
      complete: coverageSchema.safeParse(draft.coverage).success,
    },
    {
      id: "capabilities",
      label: "Payment capabilities",
      complete:
        !!draft.capabilities?.length &&
        draft.capabilities.every((c) => capabilitySchema.safeParse(c).success),
    },
    {
      id: "settlement",
      label: "Settlement configuration",
      complete: settlementSchema.safeParse(draft.settlement).success,
    },
    {
      id: "compliance",
      label: "Requirements & evidence",
      complete: evidenceCount > 0,
    },
    {
      id: "integration",
      label: "Technical integration",
      complete: integrationSchema.safeParse(draft.integration).success,
    },
  ];
}
export function validateDraftSection(section: string, value: unknown) {
  if (section === "company")
    return z
      .object({
        legalName: text,
        tradingName: text,
        website: text,
        country: text,
        registration: text,
        address: text,
        providerType: text,
        description: text,
        businessContact: text,
        technicalContact: text,
        complianceContact: text,
      })
      .partial()
      .strict()
      .parse(value);
  if (section === "coverage")
    return z
      .object({
        payerOrigins: z.array(country),
        merchantDestinations: z.array(country),
        jurisdictions: z.array(country),
        payIn: z.array(country),
        payout: z.array(country),
      })
      .partial()
      .strict()
      .parse(value);
  if (section === "settlement")
    return z
      .object({
        assets: z
          .array(
            z.object({
              kind: z.enum(["fiat", "blockchain"]),
              identifier: text,
              network: text,
            }),
          )
          .max(30),
        countries: z.array(country),
        schedule: text,
        minHours: z.number().nonnegative(),
        maxHours: z.number().nonnegative(),
        cutoff: text,
        timezone: text,
        holidays: text,
        fees: text,
        reconciliation: text,
        reporting: text,
      })
      .partial()
      .strict()
      .parse(value);
  return integrationSchema.parse(value);
}
export function assertSubmission(draft: Draft, evidenceCount: number) {
  const missing = checklist(draft, evidenceCount).filter((s) => !s.complete);
  if (missing.length)
    throw new PortalError(
      `Complete: ${missing.map((s) => s.label).join(", ")}`,
    );
  const caps = draft.capabilities!;
  if (new Set(caps.map(capabilityKey)).size !== caps.length)
    throw new PortalError("Remove duplicate or conflicting capabilities");
  const profiles = caps
    .filter((c) => c.fulfillment)
    .map(
      (c) =>
        `${c.environment}:${c.fulfillment!.integrationId}:${c.fulfillment!.profileId}`,
    );
  if (new Set(profiles).size !== profiles.length)
    throw new PortalError("DUPLICATE_FULFILLMENT_PROFILE");
  for (const c of caps) {
    if (
      c.fulfillment &&
      (!draft.settlement?.assets?.some((a) =>
        sameAsset(a, c.fulfillment!.settlementAsset),
      ) ||
        !draft.settlement?.countries?.includes(c.destination))
    )
      throw new PortalError(
        "SETTLEMENT_CONFIGURATION_MISMATCH: fulfillment must match declared settlement assets and jurisdiction",
      );
    if (c.operation === "pay-in" && !draft.coverage?.payIn?.includes(c.origin))
      throw new PortalError(
        "Pay-in capability origin must be in pay-in coverage",
      );
    if (
      c.operation === "payout" &&
      !draft.coverage?.payout?.includes(c.destination)
    )
      throw new PortalError(
        "Payout capability destination must be in payout coverage",
      );
    if (
      !draft.coverage?.payerOrigins?.includes(c.origin) ||
      !draft.coverage?.merchantDestinations?.includes(c.destination)
    )
      throw new PortalError(
        "Capability corridor must match declared origin and destination coverage",
      );
  }
}
export function transition(from: string, to: string) {
  const allowed: Record<string, string[]> = {
    Draft: ["Submitted"],
    Submitted: ["Under review", "Withdrawn"],
    "Under review": ["Changes requested", "Approved", "Rejected"],
    "Changes requested": ["Resubmitted", "Withdrawn"],
    Resubmitted: ["Under review"],
    Approved: ["Submitted"],
    Rejected: ["Submitted"],
    Withdrawn: ["Submitted"],
  };
  if (!allowed[from]?.includes(to))
    throw new PortalError(`Cannot move ${from} to ${to}`, 409);
}
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        /secret|password|token|authorization|cookie|credential|bankAccount/i.test(
          k,
        )
          ? "[redacted]"
          : redact(v),
      ]),
    );
  return value;
}
export const scenarios = [
  "Authentication succeeds",
  "Authentication fails",
  "Manifest valid",
  "Manifest invalid",
  "Selected method unavailable",
  "Declared limit exceeded",
  "Provider unavailable before execution",
  "Timeout with uncertain outcome",
  "Duplicate idempotency key",
  "Duplicate and out-of-order events",
  "Invalid event signature",
  "Settlement pending then complete",
] as const;
export function activationBlockers(input: {
  approved: boolean;
  legal: boolean;
  technical: boolean;
  evidence: boolean;
  realTests: boolean;
  secrets: boolean;
  registry: boolean;
  storage: boolean;
}) {
  return Object.entries(input)
    .filter(([, v]) => !v)
    .map(
      ([k]) =>
        ({
          approved: "Approved submission",
          legal: "Legal review",
          technical: "Technical review",
          evidence: "Valid scanned and accepted evidence",
          realTests: "Real provider tests for the approved production version",
          secrets: "Managed production credentials",
          registry: "Production registry adapter",
          storage: "Production storage and scanner",
        })[k]!,
    );
}

export function effectiveEligibility(input: {
  active: boolean;
  published: boolean;
  evidenceValid: boolean;
  observed?: { status: string; expiresAt: Date | string };
  reported?: { status: string; expiresAt: Date | string };
  now: number;
}) {
  if (!input.active)
    return { eligible: false, reason: "Activation or propagation incomplete" };
  if (!input.published)
    return {
      eligible: false,
      reason: "Capability is not in the published snapshot",
    };
  if (!input.evidenceValid)
    return {
      eligible: false,
      reason: "Required evidence is expired or unavailable",
    };
  if (
    !input.observed ||
    new Date(input.observed.expiresAt).getTime() <= input.now
  )
    return { eligible: false, reason: "Fresh observed health required" };
  if (input.observed.status !== "Available")
    return { eligible: false, reason: "Observed health is not available" };
  if (
    input.reported &&
    new Date(input.reported.expiresAt).getTime() > input.now &&
    input.reported.status !== "Available"
  )
    return {
      eligible: false,
      reason: `Provider reports ${input.reported.status.toLowerCase()}`,
    };
  return {
    eligible: true,
    reason: "Published capability and current health checks satisfied",
  };
}
