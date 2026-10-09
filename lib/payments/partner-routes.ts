// Routing through merchant-owned partner accounts, plus the merchant's
// sub-accounts under PayRouta platform accounts (lib/treasury/routes.ts).
//
// A merchant's approved partner account (bound as an Integration in the
// merchant's own organisation) is a routing candidate for the methods its
// partner module can execute. Candidates use synthetic profile IDs
// "partner:<applicationId>" alongside registry profiles. Production requires
// the partner's sandbox connection to have been qualified by operations.
import { stablecoinDepositConfig as depositConfigSchema } from "../blockchain/deposit-config";
import { assertLaunchMethod, enforceLaunchScope } from "./launch";
import {
  isDepositProfile,
  depositPrefix,
  revalidateDepositEvaluation,
} from "./stablecoin-routes";
import { labelOf } from "../providers/normalized";
import { stripeMethod } from "../providers/adapters/native/stripe-methods";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { revalidateSelectedMethod } from "../portal/availability-service";
import { partnerModule } from "../partners/registry";
import {
  isPlatformProfile,
  platformAttemptTarget,
  platformCandidates,
} from "../treasury/routes";
import { isFiatAsset, revalidatePlatformEvaluation } from "../treasury/launch";
import type { Tx } from "./service";

export const partnerPrefix = "partner:";
export const isPartnerProfile = (id: string) => id.startsWith(partnerPrefix);
// Accounts that exist only for this merchant: its own partner accounts and
// its sub-accounts under PayRouta platform accounts.
export const isMerchantAccountProfile = (id: string) =>
  isPartnerProfile(id) || isPlatformProfile(id);

export interface PartnerCandidate {
  profileId: string;
  applicationId: string;
  partnerId: string;
  name: string;
  integrationId: string;
  method: string;
}

export async function partnerCandidates(
  orgId: string,
  environment: string,
  method?: string,
  client: Tx | typeof db = db,
): Promise<PartnerCandidate[]> {
  const apps = await client.partnerApplication.findMany({
    where: {
      orgId,
      environment,
      state: "Approved",
      paymentsEnabled: true,
      integrationId: { not: null },
    },
    orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
  });
  const platform = await platformCandidates(orgId, environment, method, client);
  if (!apps.length) return platform;
  const partnerIds = [...new Set(apps.map((a) => a.partnerId))];
  const connections = await client.partnerConnection.findMany({
    where: { partnerId: { in: partnerIds } },
  });
  const out: PartnerCandidate[] = [];
  for (const a of apps) {
    const own = connections.find(
      (c) => c.partnerId === a.partnerId && c.environment === environment,
    );
    const sandbox = connections.find(
      (c) => c.partnerId === a.partnerId && c.environment === "sandbox",
    );
    if (!own?.enabled) continue;
    if (environment === "production" && !sandbox?.qualifiedAt) continue;
    let manifest;
    let configured: { enabledPaymentTypes?: string[] };
    try {
      const partner = partnerModule(a.partnerId);
      manifest = partner.manifest;
      const parsed = partner.configSchema.safeParse({
        ...(own.config as object),
        environment,
      });
      if (!parsed.success) continue;
      configured = parsed.data as { enabledPaymentTypes?: string[] };
    } catch {
      continue;
    }
    for (const m of manifest.paymentMethods ?? [])
      if (
        (!method || m === method) &&
        (a.partnerId !== "stripe-connect" ||
          (configured.enabledPaymentTypes ?? ["card"]).some(
            (t) => stripeMethod[t as keyof typeof stripeMethod] === m,
          ))
      )
        out.push({
          profileId: `${partnerPrefix}${a.id}`,
          applicationId: a.id,
          partnerId: a.partnerId,
          name: manifest.name,
          integrationId: a.integrationId!,
          method: m,
        });
  }
  return [...out, ...platform];
}

type Evaluation = {
  evaluationId: string;
  evaluatedAt: string | Date;
  expiresAt: string | Date;
  methods: {
    method: string;
    label: string;
    status: string;
    explanation: string;
    action?: string;
  }[];
};

// Adds methods the merchant's own accounts can serve to a registry evaluation.
export function mergeAvailability<T extends Evaluation>(
  evaluation: T,
  candidates: PartnerCandidate[],
  accepted: string[],
): T {
  const methods = evaluation.methods.map((m) => ({ ...m }));
  for (const method of accepted) {
    const own = candidates.filter((c) => c.method === method);
    if (!own.length) continue;
    const explanation = `Through your ${[...new Set(own.map((c) => c.name))].join(" or ")} account`;
    const existing = methods.find((m) => m.method === method);
    if (existing) {
      if (existing.status !== "AVAILABLE") {
        existing.status = "AVAILABLE";
        existing.explanation = explanation;
        delete existing.action;
      }
    } else
      methods.push({
        method,
        label: labelOf(method),
        status: "AVAILABLE",
        explanation,
      });
  }
  return { ...evaluation, methods };
}

// Registry candidates (if the registry still offers the method) plus the
// merchant's partner candidates. Registry errors other than "method not
// available" (e.g. an expired evaluation) always propagate.
export async function revalidateRoute(
  intent: {
    orgId: string;
    contextId: string;
    environment: string;
    asset?: unknown;
  },
  evaluationId: string,
  method: string,
  now = new Date(),
) {
  // Aggregator path under the launch scope: only the merchant's platform
  // rails, revalidated against their own evaluation.
  if (enforceLaunchScope() && isFiatAsset(intent.asset)) {
    const platform = await revalidatePlatformEvaluation(intent, evaluationId, method, now);
    return {
      method,
      candidateIds: platform.map((p) => p.profileId),
      partners: platform,
      deposits: [] as Awaited<ReturnType<typeof revalidateDepositEvaluation>>,
    };
  }
  assertLaunchMethod(method);
  const deposits = ["stablecoin", "crypto-app"].includes(method)
    ? (await revalidateDepositEvaluation(intent, evaluationId, now)).filter(
        (c) => c.method === method,
      )
    : [];
  if (enforceLaunchScope()) {
    if (!deposits.length)
      throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
    return {
      method,
      candidateIds: deposits.map((p) => p.profileId),
      partners: [],
      deposits,
    };
  }
  let registry: string[] = [];
  try {
    registry = (
      await revalidateSelectedMethod(
        intent.orgId,
        intent.contextId,
        evaluationId,
        method,
        now,
      )
    ).candidateIds;
  } catch (error) {
    if (
      !(error instanceof PortalError) ||
      ![
        "SELECTED_METHOD_NOT_AVAILABLE",
        "SELECTED_METHOD_NO_LONGER_AVAILABLE",
      ].includes(error.message)
    )
      throw error;
  }
  const partners = await partnerCandidates(
    intent.orgId,
    intent.environment,
    method,
  );
  const candidateIds = enforceLaunchScope()
    ? deposits.map((p) => p.profileId)
    : [
        ...deposits.map((p) => p.profileId),
        ...registry,
        ...partners.map((p) => p.profileId),
      ];
  if (!candidateIds.length)
    throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
  return {
    method,
    candidateIds,
    partners: enforceLaunchScope() ? [] : partners,
    deposits,
  };
}

// Where an attempt for a route candidate executes.
export async function attemptTarget(tx: Tx, profileId: string, orgId: string) {
  if (isDepositProfile(profileId)) {
    const integration = await tx.integration.findUnique({
      where: { id: profileId.slice(depositPrefix.length) },
    });
    if (
      !integration ||
      integration.orgId !== orgId ||
      !depositConfigSchema.safeParse(integration.config).success
    )
      throw new PortalError("PROVIDER_NO_LONGER_ELIGIBLE", 409);
    return { profileId, providerOrgId: orgId, integrationId: integration.id };
  }
  if (isPlatformProfile(profileId)) {
    const target = await platformAttemptTarget(tx, profileId, orgId);
    if (!target) throw new PortalError("PROVIDER_NO_LONGER_ELIGIBLE", 409);
    return target;
  }
  if (isPartnerProfile(profileId)) {
    const app = await tx.partnerApplication.findUnique({
      where: { id: profileId.slice(partnerPrefix.length) },
    });
    if (
      !app ||
      app.orgId !== orgId ||
      app.state !== "Approved" ||
      !app.integrationId
    )
      throw new PortalError("PROVIDER_NO_LONGER_ELIGIBLE", 409);
    return {
      profileId,
      providerOrgId: app.orgId,
      integrationId: app.integrationId,
    };
  }
  const p = await tx.publishedProfile.findUniqueOrThrow({
    where: { id: profileId },
  });
  if (!p.current) throw new PortalError("PROVIDER_NO_LONGER_ELIGIBLE", 409);
  return {
    profileId: p.id,
    providerOrgId: p.orgId,
    integrationId: p.integrationId,
  };
}
