import {
  capabilitySchema,
  CapabilityDefinition,
} from "../../lib/portal/domain";
import {
  Candidate,
  Observation,
  TrustedContext,
} from "../../lib/portal/availability-engine";
export const now = new Date("2026-09-18T09:00:00.000Z");
export const config = {
  adapter: "simulator",
  baseUrl: "",
  auth: "bearer",
  mappings: "fixture-only",
  healthPath: "/health",
  events: "poll",
  signing: "HMAC-SHA256",
  timeoutMs: 1000,
  retries: 0,
};
const fiat = { kind: "fiat" as const, identifier: "NGN", network: "" };
export const usdc = {
  kind: "blockchain" as const,
  identifier: "erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  network: "eip155:1",
};
export function fixtureCapability(
  id = "fictional-harbor",
  stable = false,
): CapabilityDefinition {
  const input = stable ? usdc : fiat;
  return capabilitySchema.parse({
    capabilityId: id,
    version: 1,
    family: stable ? "stablecoin" : "bank",
    rail: stable ? "onchain" : "ng-nibss",
    operation: "pay-in",
    origin: "NG",
    destination: "NG",
    input,
    minimum: "100",
    maximum: id.includes("creek") ? "5000" : "10000",
    daily: "100000",
    limitAsset: input.identifier,
    settlement: "Explicit same-asset settlement",
    hours: "24/7",
    timezone: "Africa/Lagos",
    availability: "poll",
    conditions: "Verified",
    endpoint: "fixture.payin",
    environment: "sandbox",
    fulfillment: {
      profileId: `${id}-profile`,
      method: stable ? "stablecoin" : "bank-transfer",
      integrationId: `${id}-integration`,
      adapterVersion: "1",
      inputPrecision: stable ? 6 : 2,
      settlementAsset: input,
      settlementPrecision: stable ? 6 : 2,
      operations: ["pay-in", "settlement"],
      verification: "verified",
      checks: ["health", "availability", "capacity"],
      schedule: [],
      provenance: "operator-maintained",
    },
  });
}
export function fixtureCandidate(
  id = "fictional-harbor",
  stable = false,
): Candidate {
  const definition = fixtureCapability(id, stable);
  return {
    id,
    orgId: id,
    integrationId: definition.fulfillment!.integrationId,
    revision: 1,
    publicationKey: `${id}-publication`,
    definition,
    active: true,
    restricted: false,
    evidenceValid: true,
    fictional: true,
    evidenceExpiresAt: Infinity,
  };
}
export const providers = [
  fixtureCandidate(),
  fixtureCandidate("fictional-creek"),
  fixtureCandidate("fictional-chain", true),
];
export function fixtureObservations(candidates = providers): Observation[] {
  return candidates.flatMap((c) =>
    ["health", "availability", "capacity"].map((type) => ({
      id: `${c.id}-${type}`,
      integrationId: c.integrationId,
      capabilityId: c.definition.capabilityId,
      capabilityVersion: 1,
      environment: "sandbox",
      observationType: type,
      trust: "simulated",
      sequence: 1,
      observedAt: now,
      expiresAt: new Date(now.getTime() + 30000),
      status: "Available",
      value: type === "capacity" ? { remaining: "100000" } : {},
    })),
  );
}
export const context: TrustedContext = {
  merchantId: "fictional-merchant",
  reference: "fictional-payment",
  environment: "sandbox",
  amount: "1000",
  input: fiat,
  precision: 2,
  payerCountry: "NG",
  merchantCountry: "NG",
  methods: ["bank-transfer", "stablecoin"],
  operation: "pay-in",
  settlement: fiat,
  verified: true,
  verificationAction: true,
  blockedMethods: [],
  policyVersion: "fixture-policy-1",
  validUntil: new Date(now.getTime() + 3600000).toISOString(),
};
