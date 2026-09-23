import { z } from "zod";
import {
  assetSchema,
  decimal,
  countries,
  environments,
  CapabilityDefinition,
  sameAsset,
  units,
  precisionValid,
  fiatPrecision,
} from "./domain";

import { paymentMethodIds, labelOf } from "../providers/normalized";

const country = z.string().refine((v) => countries.some((c) => c.id === v));
export const trustedContextSchema = z
  .object({
    merchantId: z.string().min(1).max(100),
    reference: z.string().min(1).max(100),
    environment: z.enum(environments),
    amount: decimal,
    input: assetSchema,
    precision: z.number().int().min(0).max(18),
    payerCountry: country.nullable(),
    merchantCountry: country,
    methods: z
      .array(z.enum(paymentMethodIds))
      .min(1)
      .max(10),
    operation: z.enum([
      "pay-in",
      "payout",
      "conversion",
      "authorization",
      "settlement",
    ]),
    settlement: assetSchema,
    verified: z.boolean().nullable(),
    verificationAction: z.boolean(),
    providerAllowlist: z.array(z.string().min(1).max(100)).max(100).optional(),
    blockedMethods: z
      .array(z.enum(paymentMethodIds))
      .max(10),
    policyVersion: z.string().min(1).max(100),
    validUntil: z.iso.datetime(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      !precisionValid(v.amount, v.precision) ||
      (v.input.kind === "fiat" &&
        (v.input.network || v.precision !== fiatPrecision(v.input.identifier)))
    )
      c.addIssue({
        code: "custom",
        path: ["amount"],
        message: "AMOUNT_PRECISION_INVALID",
      });
    if (new Set(v.methods).size !== v.methods.length)
      c.addIssue({
        code: "custom",
        path: ["methods"],
        message: "DUPLICATE_METHOD",
      });
  });
export type TrustedContext = z.infer<typeof trustedContextSchema>;
export type AvailabilityStatus =
  | "AVAILABLE"
  | "ACTION_REQUIRED"
  | "TEMPORARILY_UNAVAILABLE"
  | "UNAVAILABLE"
  | "UNKNOWN";
export type Observation = {
  id: string;
  integrationId: string | null;
  capabilityId: string;
  capabilityVersion: number | null;
  environment: string;
  observationType: string | null;
  trust: string | null;
  sequence: number | null;
  observedAt: Date | null;
  expiresAt: Date;
  status: string;
  value: unknown;
};
export type Candidate = {
  id: string;
  orgId: string;
  integrationId: string;
  revision: number;
  publicationKey: string;
  definition: CapabilityDefinition;
  active: boolean;
  restricted: boolean;
  evidenceValid: boolean;
  fictional: boolean;
  evidenceExpiresAt: number;
};
export type Reason = {
  code: string;
  status: Exclude<AvailabilityStatus, "AVAILABLE">;
};
export type CandidateDecision = {
  id: string;
  orgId: string;
  integrationId: string;
  capabilityId: string;
  capabilityVersion: number;
  profileId: string;
  revision: number;
  publicationKey: string;
  method: string;
  status: AvailabilityStatus;
  reasons: Reason[];
  observationIds: string[];
  observations: {
    id: string;
    type: string | null;
    trust: string | null;
    observedAt: string;
    expiresAt: string;
    status: string;
    fresh: boolean;
  }[];
  expiresAt: string;
};
const candidatePrecedence: AvailabilityStatus[] = [
  "UNAVAILABLE",
  "TEMPORARILY_UNAVAILABLE",
  "UNKNOWN",
  "ACTION_REQUIRED",
  "AVAILABLE",
];
// Best viable candidate wins; unknown is preferable to a known temporary blocker across providers.
export const methodPrecedence: AvailabilityStatus[] = [
  "AVAILABLE",
  "ACTION_REQUIRED",
  "UNKNOWN",
  "TEMPORARILY_UNAVAILABLE",
  "UNAVAILABLE",
];
export function aggregateStatuses(
  statuses: AvailabilityStatus[],
): AvailabilityStatus {
  return methodPrecedence.find((s) => statuses.includes(s)) || "UNAVAILABLE";
}
export function scheduleState(c: CapabilityDefinition, now: Date) {
  const windows = c.fulfillment!.schedule;
  if (!windows.length) return { open: true, boundary: Infinity };
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: c.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    get("weekday"),
  );
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  // Re-evaluate at the next UTC minute: conservative across DST gaps and repeated hours.
  return {
    open: windows.some(
      (w) => w.days.includes(day) && minute >= w.start && minute < w.end,
    ),
    boundary: Math.floor(now.getTime() / 60000) * 60000 + 60000,
  };
}
export function evaluateAvailability(input: {
  evaluationId: string;
  context: TrustedContext;
  candidates: Candidate[];
  observations: Observation[];
  now: Date;
  maxLifetimeMs?: number;
}) {
  const ctx = trustedContextSchema.parse(input.context);
  const now = input.now.getTime();
  if (!Number.isFinite(now) || new Date(ctx.validUntil).getTime() <= now)
    throw new Error("CONTEXT_EXPIRED");
  if (input.candidates.length > 500 || input.observations.length > 10000)
    throw new Error("EVALUATION_BUDGET_EXCEEDED");
  const ceiling = Math.min(
    now + Math.min(input.maxLifetimeMs || 30000, 30000),
    new Date(ctx.validUntil).getTime(),
  );
  const decisions: CandidateDecision[] = [];
  for (const candidate of [...input.candidates].sort((a, b) =>
    a.id.localeCompare(b.id),
  )) {
    const c = candidate.definition,
      f = c.fulfillment;
    if (!f || !ctx.methods.includes(f.method)) continue;
    const reasons: Reason[] = [];
    const add = (code: string, status: Reason["status"] = "UNAVAILABLE") => {
      if (!reasons.some((r) => r.code === code)) reasons.push({ code, status });
    };
    let expiry = Math.min(ceiling, candidate.evidenceExpiresAt);
    if (
      c.environment !== ctx.environment ||
      (ctx.environment === "production" && candidate.fictional)
    )
      add("ENVIRONMENT_MISMATCH");
    if (
      ctx.providerAllowlist &&
      !ctx.providerAllowlist.includes(candidate.orgId)
    )
      add("POLICY_RESTRICTED");
    if (candidate.restricted) add("PROVIDER_SUSPENDED");
    if (!candidate.active) add("PROVIDER_NOT_ACTIVE");
    if (!candidate.evidenceValid) add("POLICY_RESTRICTED");
    if (ctx.blockedMethods.includes(f.method)) add("POLICY_RESTRICTED");
    if (c.operation !== ctx.operation) add("DIRECTION_UNSUPPORTED");
    if (!ctx.payerCountry) add("MISSING_REQUIRED_CONTEXT", "UNKNOWN");
    else if (c.origin !== ctx.payerCountry) add("CORRIDOR_UNSUPPORTED");
    if (c.destination !== ctx.merchantCountry) add("CORRIDOR_UNSUPPORTED");
    const matchingInput = sameAsset(c.input, ctx.input);
    if (!matchingInput || f.inputPrecision !== ctx.precision)
      add("ASSET_OR_NETWORK_UNSUPPORTED");
    if (!sameAsset(f.settlementAsset, ctx.settlement))
      add("SETTLEMENT_UNSUPPORTED");
    if (
      !f.operations.includes(ctx.operation) ||
      !f.operations.includes("settlement")
    )
      add("FULFILLMENT_INCOMPLETE");
    // A cross-asset quote is not modeled yet; never assume parity for conversion-dependent fulfillment.
    if (!sameAsset(c.input, f.settlementAsset))
      add("CONVERSION_BASIS_UNAVAILABLE", "UNKNOWN");
    if (matchingInput) {
      if (units(ctx.amount) < units(c.minimum)) add("AMOUNT_BELOW_MINIMUM");
      if (units(ctx.amount) > units(c.maximum)) add("AMOUNT_ABOVE_MAXIMUM");
    }
    const schedule = scheduleState(c, input.now);
    expiry = Math.min(expiry, schedule.boundary);
    if (!schedule.open)
      add("OUTSIDE_OPERATING_HOURS", "TEMPORARILY_UNAVAILABLE");
    if (f.verification === "verified" && ctx.verified !== true)
      add(
        ctx.verified === null
          ? "MISSING_REQUIRED_CONTEXT"
          : "VERIFICATION_REQUIRED",
        ctx.verified === false && ctx.verificationAction
          ? "ACTION_REQUIRED"
          : "UNKNOWN",
      );
    const scoped = input.observations.filter(
      (o) =>
        o.integrationId === candidate.integrationId &&
        o.environment === ctx.environment &&
        o.capabilityId === c.capabilityId &&
        o.capabilityVersion === c.version &&
        o.observedAt &&
        o.observedAt.getTime() <= now &&
        (ctx.environment !== "production" || o.trust !== "simulated"),
    );
    const latest = new Map<string, Observation>();
    for (const o of scoped.sort(
      (a, b) =>
        (b.sequence ?? -1) - (a.sequence ?? -1) ||
        b.observedAt!.getTime() - a.observedAt!.getTime() ||
        a.id.localeCompare(b.id),
    )) {
      const key = `${o.observationType}:${o.trust}`;
      if (!latest.has(key)) latest.set(key, o);
    }
    const observationIds: string[] = [];
    for (const o of latest.values()) {
      observationIds.push(o.id);
      if (o.expiresAt.getTime() <= now) continue;
      expiry = Math.min(expiry, o.expiresAt.getTime());
      if (
        o.observationType === "restriction" &&
        o.trust === "operator" &&
        o.status !== "Available"
      )
        add("POLICY_RESTRICTED");
      else if (o.observationType === "maintenance" && o.status !== "Available")
        add("MAINTENANCE", "TEMPORARILY_UNAVAILABLE");
      else if (
        ["health", "availability"].includes(o.observationType || "") &&
        ["Unavailable", "Degraded", "Maintenance"].includes(o.status)
      )
        add(
          o.status === "Maintenance" ? "MAINTENANCE" : "PROVIDER_UNAVAILABLE",
          "TEMPORARILY_UNAVAILABLE",
        );
      else if (o.status === "Unknown")
        add("MISSING_REQUIRED_CONTEXT", "UNKNOWN");
    }
    for (const check of f.checks) {
      const evidence = [...latest.values()].filter(
        (o) =>
          o.observationType === check &&
          [
            "adapter",
            "operator",
            ...(ctx.environment === "sandbox" ? ["simulated"] : []),
          ].includes(o.trust || ""),
      );
      if (!evidence.length) {
        add("MISSING_REQUIRED_CONTEXT", "UNKNOWN");
        continue;
      }
      const fresh = evidence.filter((o) => o.expiresAt.getTime() > now);
      if (!fresh.length) {
        add("STALE_OBSERVATION", "UNKNOWN");
        continue;
      }
      for (const o of fresh) {
        if (o.status !== "Available")
          add(
            o.status === "Unknown"
              ? "MISSING_REQUIRED_CONTEXT"
              : "PROVIDER_UNAVAILABLE",
            o.status === "Unknown" ? "UNKNOWN" : "TEMPORARILY_UNAVAILABLE",
          );
        if (check === "capacity") {
          const remaining = (o.value as { remaining?: string } | null)
            ?.remaining;
          if (
            !remaining ||
            !decimal.safeParse(remaining).success ||
            !precisionValid(remaining, f.inputPrecision)
          )
            add("MISSING_REQUIRED_CONTEXT", "UNKNOWN");
          else if (matchingInput && units(remaining) < units(ctx.amount))
            add("INSUFFICIENT_CAPACITY", "TEMPORARILY_UNAVAILABLE");
        }
      }
    }
    reasons.sort(
      (a, b) =>
        candidatePrecedence.indexOf(a.status) -
          candidatePrecedence.indexOf(b.status) || a.code.localeCompare(b.code),
    );
    decisions.push({
      id: candidate.id,
      orgId: candidate.orgId,
      integrationId: candidate.integrationId,
      capabilityId: c.capabilityId,
      capabilityVersion: c.version,
      profileId: f.profileId,
      revision: candidate.revision,
      publicationKey: candidate.publicationKey,
      method: f.method,
      status: reasons[0]?.status || "AVAILABLE",
      reasons,
      observationIds: observationIds.sort(),
      observations: [...latest.values()]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((o) => ({
          id: o.id,
          type: o.observationType,
          trust: o.trust,
          observedAt: o.observedAt!.toISOString(),
          expiresAt: o.expiresAt.toISOString(),
          status: o.status,
          fresh: o.expiresAt.getTime() > now,
        })),
      expiresAt: new Date(Math.max(now, expiry)).toISOString(),
    });
  }
  const messages: Record<AvailabilityStatus, string> = {
    AVAILABLE: "Available for this payment.",
    ACTION_REQUIRED: "Complete verification to use this method.",
    TEMPORARILY_UNAVAILABLE: "This method is temporarily unavailable.",
    UNAVAILABLE: "This method cannot serve this payment.",
    UNKNOWN: "Availability could not be confirmed.",
  };
  const methods = ctx.methods.map((method) => {
    const status = aggregateStatuses(
      decisions.filter((d) => d.method === method).map((d) => d.status),
    );
    return {
      method,
      label: labelOf(method),
      status,
      explanation: messages[status],
      ...(status === "ACTION_REQUIRED"
        ? { action: "complete-verification" }
        : {}),
    };
  });
  // Excluded candidates cannot invalidate evidence supporting another eligible provider.
  const supporting = decisions.filter((d) =>
    methods.some((m) => m.method === d.method && m.status === d.status),
  );
  const expiresAt = new Date(
    Math.min(
      ceiling,
      ...supporting
        .map((d) => new Date(d.expiresAt).getTime())
        .filter((t) => t > now),
    ),
  ).toISOString();
  return {
    safe: {
      evaluationId: input.evaluationId,
      evaluatedAt: input.now.toISOString(),
      expiresAt,
      methods,
    },
    internal: {
      policyVersion: ctx.policyVersion,
      candidates: decisions,
      methods: methods.map((m) => ({
        method: m.method,
        status: m.status,
        reasons: decisions.some((d) => d.method === m.method)
          ? [
              ...new Set(
                decisions
                  .filter((d) => d.method === m.method)
                  .flatMap((d) => d.reasons.map((r) => r.code)),
              ),
            ].sort()
          : ["METHOD_UNSUPPORTED"],
      })),
    },
  };
}
