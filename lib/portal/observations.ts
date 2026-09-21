import { z } from "zod";
import type { Prisma } from "../generated/prisma/client";
import { atomic, json } from "./service";
import {
  PortalError,
  decimal,
  precisionValid,
  CapabilityDefinition,
} from "./domain";
import { fingerprint } from "./registry";
export const freshnessMs = {
  health: 60_000,
  availability: 60_000,
  capacity: 30_000,
  maintenance: 300_000,
  restriction: 300_000,
} as const;
export function freshnessPolicy() {
  return Object.fromEntries(
    Object.entries(freshnessMs).map(([type, fallback]) => {
      const configured = Number(
        process.env[`AVAILABILITY_${type.toUpperCase()}_TTL_MS`] || fallback,
      );
      if (
        !Number.isInteger(configured) ||
        configured < 1000 ||
        configured > 300000
      )
        throw new PortalError("FRESHNESS_CONFIGURATION_INVALID", 503);
      return [type, configured];
    }),
  ) as Record<keyof typeof freshnessMs, number>;
}
export const observationSchema = z
  .object({
    integrationId: z.string().min(1).max(100),
    capabilityId: z.string().max(100),
    capabilityVersion: z.number().int().positive(),
    environment: z.enum(["sandbox", "production"]),
    type: z.enum([
      "health",
      "availability",
      "capacity",
      "maintenance",
      "restriction",
    ]),
    eventId: z.string().min(1).max(100),
    sequence: z.number().int().nonnegative().max(2147483647),
    observedAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    status: z.enum([
      "Available",
      "Unavailable",
      "Degraded",
      "Maintenance",
      "Unknown",
    ]),
    remaining: decimal.optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.type === "capacity" && !v.remaining)
      c.addIssue({
        code: "custom",
        path: ["remaining"],
        message: "CAPACITY_REQUIRED",
      });
  });
export type ObservationInput = z.infer<typeof observationSchema>;
export type ObservationTrust =
  "operator" | "authenticated-provider" | "adapter" | "simulated";
export async function applyObservation(
  tx: Prisma.TransactionClient,
  orgId: string,
  raw: unknown,
  trust: ObservationTrust,
  now = new Date(),
) {
  const o = observationSchema.parse(raw);
  const observedAt = new Date(o.observedAt),
    expiresAt = new Date(o.expiresAt);
  if (
    observedAt.getTime() > now.getTime() + 5000 ||
    expiresAt <= observedAt ||
    expiresAt.getTime() - observedAt.getTime() >
      (trust === "authenticated-provider"
        ? 86400000
        : freshnessPolicy()[o.type])
  )
    throw new PortalError("OBSERVATION_TIME_INVALID");
  if (trust === "simulated" && o.environment !== "sandbox")
    throw new PortalError("SIMULATION_PRODUCTION_FORBIDDEN", 403);
  if (o.type === "restriction" && trust !== "operator")
    throw new PortalError("OPERATOR_REQUIRED", 403);
  return (async () => {
    const profile = await tx.publishedProfile.findFirst({
      where: {
        orgId,
        integrationId: o.integrationId,
        environment: o.environment,
        capabilityId: o.capabilityId,
        capabilityVersion: o.capabilityVersion,
        current: true,
      },
    });
    if (!profile)
      throw new PortalError("PUBLISHED_OBSERVATION_SCOPE_REQUIRED", 409);
    const c = profile.definition as unknown as CapabilityDefinition;
    if (
      o.remaining &&
      !precisionValid(o.remaining, c.fulfillment!.inputPrecision)
    )
      throw new PortalError("CAPACITY_PRECISION_INVALID");
    const eventKey = fingerprint([
      orgId,
      o.environment,
      o.integrationId,
      trust,
      o.eventId,
    ]);
    const value = {
      fingerprint: fingerprint(o),
      remaining: o.remaining || null,
    };
    const duplicate = await tx.availability.findUnique({ where: { eventKey } });
    if (duplicate) {
      if (
        (duplicate.value as { fingerprint: string })?.fingerprint !==
        value.fingerprint
      )
        throw new PortalError("OBSERVATION_EVENT_CONFLICT", 409);
      return { id: duplicate.id, duplicate: true, applied: false };
    }
    const previous = await tx.availability.findFirst({
      where: {
        orgId,
        integrationId: o.integrationId,
        environment: o.environment,
        capabilityId: o.capabilityId,
        capabilityVersion: o.capabilityVersion,
        observationType: o.type,
        trust,
      },
      orderBy: [{ sequence: "desc" }, { observedAt: "desc" }],
    });
    // Reject conflicting clocks and sequences instead of regressing latest state.
    if (
      previous &&
      (o.sequence <= (previous.sequence ?? -1) ||
        observedAt < previous.observedAt!)
    )
      return { id: previous.id, duplicate: false, applied: false };
    const row = await tx.availability.create({
      data: {
        orgId,
        integrationId: o.integrationId,
        environment: o.environment,
        capabilityId: o.capabilityId,
        capabilityVersion: o.capabilityVersion,
        observationType: o.type,
        trust,
        eventKey,
        sequence: o.sequence,
        observedAt,
        expiresAt,
        status: o.status,
        source:
          trust === "authenticated-provider"
            ? "Provider reported"
            : trust === "simulated"
              ? "Simulator observed"
              : trust === "operator"
                ? "Operator observed"
                : "Adapter observed",
        value: json(value),
        createdAt: now,
      },
    });
    return { id: row.id, duplicate: false, applied: true };
  })();
}

export async function ingestObservation(
  orgId: string,
  raw: unknown,
  trust: ObservationTrust,
  now = new Date(),
) {
  return atomic((tx) => applyObservation(tx, orgId, raw, trust, now));
}
