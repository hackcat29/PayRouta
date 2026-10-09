import { enforceLaunchScope } from "../payments/launch";
// Partner onboarding orchestration.
//
// Merchant flow: save KYB profile (versioned) → review the exact fields each
// partner receives → consent (bound to profile version + field list) →
// worker screens the business, projects the profile and creates/pre-fills the
// merchant-owned account → merchant finishes the provider's hosted onboarding
// → status is re-read from the provider's authenticated API (webhooks only
// prompt a re-read) → an approved account becomes a routing binding.
import { z } from "zod";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { internal, rateLimit, stepUp } from "../portal/access";
import { atomic, audit, json } from "../portal/service";
import { sandboxSimulation, secretManager } from "../portal/adapters";
import { providerRequest } from "../providers/adapters/http";
import { merchantMember } from "../merchant/access";
import { queue, type Tx } from "../payments/service";
import type { PartnerAdapter, PartnerState, StatusSnapshot } from "./contract";
import { statusSnapshot } from "./contract";
import { partnerManifests, partnerModule } from "./registry";
import {
  draftFromApplication,
  fingerprint,
  kybFieldLabels,
  kybProfileSchema,
  projectProfile,
  type KybProfile,
} from "./kyb";
import { screenProfile, screeningProvider } from "./screening";

type Environment = "sandbox" | "production";
const env = z.enum(["sandbox", "production"]);
const partnerId = z.string().regex(/^[a-z][a-z0-9-]{1,40}$/);

// States in which PayRouta still expects the provider to change something.
const openStates: PartnerState[] = [
  "Pending provider",
  "Action required",
  "Under review",
  "Restricted",
];
const linkStates: PartnerState[] = ["Pending provider", "Action required", "Restricted"];

function origin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new PortalError("PORTAL_ORIGIN_NOT_CONFIGURED", 503);
  return new URL(value).origin;
}
function returnUrls(partner: string) {
  const base = new URL("/merchant/providers", origin());
  const back = new URL(base);
  back.searchParams.set("partner", partner);
  back.searchParams.set("returned", "1");
  const refresh = new URL(base);
  refresh.searchParams.set("partner", partner);
  refresh.searchParams.set("refresh", "1");
  return { returnUrl: back.toString(), refreshUrl: refresh.toString() };
}

// What a merchant is shown and consents to for one partner.
export function disclosure(partner: string, profileVersion: number, profileFingerprint: string) {
  const manifest = partnerModule(partner).manifest;
  return {
    fields: [...manifest.sharedFields],
    fingerprint: fingerprint({
      partner,
      fields: manifest.sharedFields,
      profileVersion,
      profileFingerprint,
    }),
  };
}

export async function adapterFor(partner: string, environment: Environment): Promise<PartnerAdapter> {
  const mod = partnerModule(partner);
  const connection = await db.partnerConnection.findUnique({
    where: { partnerId_environment: { partnerId: partner, environment } },
  });
  if (!connection?.enabled) throw new PortalError("PARTNER_CONNECTION_DISABLED", 409);
  const config = mod.configSchema.safeParse({
    ...(connection.config as Record<string, unknown>),
    environment,
  });
  if (!config.success) throw new PortalError("PARTNER_CONNECTION_INVALID", 409);
  return mod.create(config.data, {
    http: providerRequest,
    credentials: secretManager,
  });
}

async function latestProfile(orgId: string) {
  return db.merchantKybProfile.findFirst({
    where: { orgId },
    orderBy: { version: "desc" },
  });
}

// ---------------------------------------------------------------------------
// Merchant actions

export async function saveKybProfile(orgId: string, raw: unknown, headers: Headers) {
  const { session } = await merchantMember(orgId, "configure", headers);
  await rateLimit(`partners:${orgId}`, 20);
  const profile = kybProfileSchema.parse(raw);
  const print = fingerprint(profile);
  return atomic(async (tx) => {
    const last = await tx.merchantKybProfile.findFirst({
      where: { orgId },
      orderBy: { version: "desc" },
    });
    if (last?.fingerprint === print) {
      if(enforceLaunchScope())await tx.job.upsert({where:{key:`merchant-screening:${orgId}:${last.version}:${Math.floor(Date.now()/86400000)}`},create:{orgId,kind:"merchant-screening",key:`merchant-screening:${orgId}:${last.version}:${Math.floor(Date.now()/86400000)}`,payload:{orgId,version:String(last.version)}},update:{}});
      return { version: last.version, unchanged: true };
    }
    const created = await tx.merchantKybProfile.create({
      data: {
        orgId,
        version: (last?.version ?? 0) + 1,
        data: json(profile),
        fingerprint: print,
        createdBy: session.user.id,
      },
    });
    await audit(tx, orgId, session.user.id, "partner.profile.saved", created.id, {
      version: created.version,
      fingerprint: print,
    });
    if(enforceLaunchScope())await tx.job.create({data:{orgId,kind:"merchant-screening",key:`merchant-screening:${orgId}:${created.version}`,payload:{orgId,version:String(created.version)}}});
    return { version: created.version, unchanged: false };
  });
}

const requestInput = z
  .object({
    profileVersion: z.number().int().positive(),
    // partner id → disclosure fingerprint the merchant was shown.
    disclosures: z.record(partnerId, z.string().regex(/^[a-f0-9]{64}$/)),
  })
  .strict()
  .refine((v) => Object.keys(v.disclosures).length >= 1 && Object.keys(v.disclosures).length <= 10);

export async function requestPartnerAccounts(orgId: string, raw: unknown, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  await rateLimit(`partners:${orgId}`, 20);
  const input = requestInput.parse(raw);
  const environment = env.parse(config.environment);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (environment === "production") {
    if (org.fictional) throw new PortalError("FICTIONAL_ORGANIZATION", 409);
    if (!["Under review", "Approved"].includes(config.applicationState))
      throw new PortalError("MERCHANT_APPLICATION_NOT_REVIEWED", 409);
  }
  return atomic(async (tx) => {
    const profile = await tx.merchantKybProfile.findFirst({
      where: { orgId },
      orderBy: { version: "desc" },
    });
    if (!profile || profile.version !== input.profileVersion)
      throw new PortalError("PROFILE_VERSION_CONFLICT", 409);
    const results = [];
    for (const [partner, shown] of Object.entries(input.disclosures)) {
      const d = disclosure(partner, profile.version, profile.fingerprint);
      if (d.fingerprint !== shown) throw new PortalError("DISCLOSURE_CHANGED", 409);
      const connection = await tx.partnerConnection.findUnique({
        where: { partnerId_environment: { partnerId: partner, environment } },
      });
      if (!connection?.enabled) throw new PortalError("PARTNER_CONNECTION_DISABLED", 409);
      const existing = await tx.partnerApplication.findUnique({
        where: { orgId_partnerId_environment: { orgId, partnerId: partner, environment } },
      });
      if (existing && !["Rejected", "Disconnected", "Failed"].includes(existing.state))
        throw new PortalError("PARTNER_APPLICATION_EXISTS", 409);
      const consent = await tx.partnerConsent.create({
        data: {
          orgId,
          partnerId: partner,
          environment,
          profileVersion: profile.version,
          fields: json(d.fields),
          disclosureFingerprint: d.fingerprint,
          grantedBy: session.user.id,
        },
      });
      const fresh = {
        consentId: consent.id,
        profileVersion: profile.version,
        state: "Queued",
        accountRef: null,
        providerAccountId: null,
        requirements: json([]),
        paymentsEnabled: false,
        payoutsEnabled: false,
        reason: null,
        disclosedFingerprint: null,
        integrationId: null,
        submittedAt: null,
        approvedAt: null,
        lastCheckedAt: null,
      };
      const application = existing
        ? await tx.partnerApplication.update({ where: { id: existing.id }, data: fresh })
        : await tx.partnerApplication.create({
            data: { orgId, partnerId: partner, environment, ...fresh },
          });
      await queue(tx, orgId, "partner-provision", `partner-provision:${application.id}:${consent.id}`, {
        applicationId: application.id,
      });
      await audit(tx, orgId, session.user.id, "partner.consent.granted", consent.id, {
        partnerId: partner,
        environment,
        profileVersion: profile.version,
        fields: d.fields,
        disclosureFingerprint: d.fingerprint,
      });
      results.push({ partnerId: partner, applicationId: application.id, state: "Queued" });
    }
    return { applications: results };
  });
}

export async function partnerOnboardingLink(orgId: string, partner: string, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await rateLimit(`partners:${orgId}`, 20);
  const environment = env.parse(config.environment);
  const application = await db.partnerApplication.findUnique({
    where: { orgId_partnerId_environment: { orgId, partnerId: partnerId.parse(partner), environment } },
  });
  if (!application?.accountRef || !linkStates.includes(application.state as PartnerState))
    throw new PortalError("PARTNER_LINK_UNAVAILABLE", 409);
  const adapter = await adapterFor(partner, environment);
  const link = await adapter.onboardingLink({
    accountRef: application.accountRef,
    applicationId: application.id,
    ...returnUrls(partner),
  });
  await audit(db, orgId, session.user.id, "partner.link.issued", application.id, {
    partnerId: partner,
  });
  return { url: link.url, expiresAt: link.expiresAt?.toISOString() ?? null };
}

export async function refreshPartner(orgId: string, partner: string, headers: Headers) {
  const { config } = await merchantMember(orgId, "read", headers);
  await rateLimit(`partners:refresh:${orgId}`, 10);
  const application = await db.partnerApplication.findUnique({
    where: {
      orgId_partnerId_environment: {
        orgId,
        partnerId: partnerId.parse(partner),
        environment: config.environment,
      },
    },
  });
  if (!application?.accountRef) return { queued: false };
  const bucket = Math.floor(Date.now() / 15000);
  await queue(db, orgId, "partner-status", `partner-status:${application.id}:${bucket}`, {
    applicationId: application.id,
  });
  return { queued: true };
}

export async function revokePartnerConsent(orgId: string, partner: string, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  return atomic(async (tx) => {
    const application = await tx.partnerApplication.findUnique({
      where: {
        orgId_partnerId_environment: {
          orgId,
          partnerId: partnerId.parse(partner),
          environment: config.environment,
        },
      },
    });
    if (!application) throw new PortalError("NOT_FOUND", 404);
    await tx.partnerConsent.updateMany({
      where: { id: application.consentId, revokedAt: null },
      data: { revokedAt: new Date(), revokedBy: session.user.id },
    });
    await tx.partnerApplication.update({
      where: { id: application.id },
      data: { state: "Disconnected", reason: "MERCHANT_REVOKED_CONSENT" },
    });
    await audit(tx, orgId, session.user.id, "partner.consent.revoked", application.consentId, {
      partnerId: partner,
    });
    // The provider account belongs to the merchant and is not closed here.
    return { state: "Disconnected", providerAccountRetained: true };
  });
}

// Merchant-safe projection. Screening detail is never shown to the merchant
// (tipping-off); a hold is reported only as "PayRouta review".
export async function partnerOverview(orgId: string, environment: string) {
  const [profile, applications, connections, config] = await Promise.all([
    latestProfile(orgId),
    db.partnerApplication.findMany({ where: { orgId, environment } }),
    db.partnerConnection.findMany({ where: { environment, enabled: true } }),
    db.merchantConfig.findUnique({ where: { orgId } }),
  ]);
  const enabled = new Set(connections.map((c) => c.partnerId));
  return {
    environment,
    profile: profile
      ? { version: profile.version, data: profile.data as KybProfile }
      : null,
    draft: profile ? null : draftFromApplication(config?.application),
    partners: partnerManifests()
      .filter((m) => enabled.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        methods: m.methods,
        onboarding: m.onboarding,
        fields: m.sharedFields.map((f) => ({ id: f, label: kybFieldLabels[f] })),
        disclosureFingerprint: profile
          ? disclosure(m.id, profile.version, profile.fingerprint).fingerprint
          : null,
      })),
    applications: applications.map((a) => ({
      partnerId: a.partnerId,
      state: a.state,
      requirements: a.requirements,
      paymentsEnabled: a.paymentsEnabled,
      payoutsEnabled: a.payoutsEnabled,
      profileVersion: a.profileVersion,
      canContinue: !!a.accountRef && linkStates.includes(a.state as PartnerState),
      notice:
        a.reason === "PAYROUTA_SCREENING_REVIEW"
          ? "PayRouta review in progress"
          : a.reason === "PAYROUTA_SCREENING_MATCH"
            ? "Not available. Contact PayRouta support."
            : a.state === "Failed"
              ? "Could not be submitted. Contact PayRouta support."
              : null,
      updatedAt: a.updatedAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Operations

const secretName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{1,40}Ref$/);
const connectionInput = z
  .object({
    action: z.literal("partner-connection"),
    partnerId,
    environment: env,
    enabled: z.boolean(),
    config: z.record(z.string().max(60), z.unknown()).default({}),
    // New secret values; stored in the secret manager, referenced by name.
    secrets: z.record(secretName, z.string().min(8).max(4000)).default({}),
    reason: z.string().min(10).max(1000),
  })
  .strict();

export async function configurePartnerConnection(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = connectionInput.parse(raw);
  const mod = partnerModule(input.partnerId);
  if (mod.manifest.sandboxOnly && input.environment !== "sandbox")
    throw new PortalError("SANDBOX_PARTNER_ONLY", 409);
  const previous = await db.partnerConnection.findUnique({
    where: { partnerId_environment: { partnerId: input.partnerId, environment: input.environment } },
  });
  if (input.environment === "production" && input.enabled && !mod.manifest.sandboxOnly) {
    const sandbox = await db.partnerConnection.findUnique({
      where: { partnerId_environment: { partnerId: input.partnerId, environment: "sandbox" } },
    });
    if (!sandbox?.qualifiedAt)
      throw new PortalError("SANDBOX_QUALIFICATION_REQUIRED", 409);
  }
  const refs: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.secrets))
    refs[name] = await secretManager.put(value);
  const config = {
    ...((previous?.config as Record<string, unknown>) ?? {}),
    ...input.config,
    ...refs,
  };
  delete (config as { environment?: unknown }).environment;
  const parsed = mod.configSchema.safeParse({ ...config, environment: input.environment });
  if (!parsed.success) {
    for (const ref of Object.values(refs)) await secretManager.revoke(ref);
    throw new PortalError("PARTNER_CONNECTION_INVALID", 409);
  }
  return atomic(async (tx) => {
    const saved = await tx.partnerConnection.upsert({
      where: { partnerId_environment: { partnerId: input.partnerId, environment: input.environment } },
      create: {
        partnerId: input.partnerId,
        environment: input.environment,
        config: json(config),
        enabled: input.enabled,
        updatedBy: actor.user.id,
      },
      update: { config: json(config), enabled: input.enabled, updatedBy: actor.user.id },
    });
    await audit(tx, null, actor.user.id, "partner.connection.configured", saved.id, {
      partnerId: input.partnerId,
      environment: input.environment,
      enabled: input.enabled,
      reason: input.reason,
      configKeys: Object.keys(config).sort(),
      rotatedSecrets: Object.keys(refs),
    }, true);
    return { id: saved.id, enabled: saved.enabled };
  });
}

const qualifyInput = z
  .object({
    action: z.literal("partner-qualify"),
    partnerId,
    // Each step must be evidenced against the provider's own sandbox.
    evidence: z
      .object({
        onboarding: z.string().min(10).max(1000),
        accountEvents: z.string().min(10).max(1000),
        payment: z.string().min(10).max(1000),
        statusRecovery: z.string().min(10).max(1000),
      })
      .strict(),
    reason: z.string().min(10).max(1000),
  })
  .strict();

// Records that a partner module passed an end-to-end run in the provider's
// sandbox. Production payments through the partner require this.
export async function qualifyPartner(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = qualifyInput.parse(raw);
  const mod = partnerModule(input.partnerId);
  if (mod.manifest.sandboxOnly) throw new PortalError("SANDBOX_PARTNER_ONLY", 409);
  return atomic(async (tx) => {
    const connection = await tx.partnerConnection.findUnique({
      where: { partnerId_environment: { partnerId: input.partnerId, environment: "sandbox" } },
    });
    if (!connection?.enabled) throw new PortalError("PARTNER_CONNECTION_DISABLED", 409);
    const now = new Date();
    await tx.partnerConnection.update({
      where: { id: connection.id },
      data: {
        qualifiedAt: now,
        qualification: json({ ...input.evidence, by: actor.user.id, at: now.toISOString() }),
      },
    });
    await audit(tx, null, actor.user.id, "partner.connection.qualified", connection.id, {
      partnerId: input.partnerId,
      reason: input.reason,
      evidence: input.evidence,
    }, true);
    return { qualifiedAt: now.toISOString() };
  });
}

const screeningReviewInput = z
  .object({
    action: z.literal("partner-screening-review"),
    orgId: z.string().min(1).max(100),
    profileVersion: z.number().int().positive(),
    verdict: z.enum(["clear", "match"]),
    note: z.string().min(10).max(2000),
  })
  .strict();

// A manual decision is a new immutable screening record, never an edit.
export async function reviewScreening(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = screeningReviewInput.parse(raw);
  return atomic(async (tx) => {
    const record = await tx.merchantScreening.create({
      data: {
        orgId: input.orgId,
        profileVersion: input.profileVersion,
        provider: "manual-review",
        verdict: input.verdict,
        results: json([{ subject: "all", verdict: input.verdict, note: input.note }]),
        createdBy: actor.user.id,
      },
    });
    const held = await tx.partnerApplication.findMany({
      where: {
        orgId: input.orgId,
        profileVersion: input.profileVersion,
        state: "Queued",
        reason: "PAYROUTA_SCREENING_REVIEW",
      },
    });
    for (const a of held)
      await queue(tx, a.orgId, "partner-provision", `partner-provision:${a.id}:${record.id}`, {
        applicationId: a.id,
      });
    await audit(tx, input.orgId, actor.user.id, "partner.screening.reviewed", record.id, {
      verdict: input.verdict,
      profileVersion: input.profileVersion,
      requeued: held.length,
    }, true);
    return { id: record.id, requeued: held.length };
  });
}

// ---------------------------------------------------------------------------
// Worker jobs

async function applySnapshot(
  tx: Tx,
  applicationId: string,
  snapshot: StatusSnapshot,
  extra: Record<string, unknown> = {},
) {
  const before = await tx.partnerApplication.findUniqueOrThrow({ where: { id: applicationId } });
  if (["Disconnected", "Failed"].includes(before.state)) return before;
  const now = new Date();
  const updated = await tx.partnerApplication.update({
    where: { id: applicationId },
    data: {
      ...extra,
      state: snapshot.state,
      providerAccountId: snapshot.providerAccountId ?? before.providerAccountId,
      requirements: json(snapshot.requirementsDue),
      paymentsEnabled: snapshot.paymentsEnabled,
      payoutsEnabled: snapshot.payoutsEnabled,
      reason: snapshot.reason ?? null,
      lastCheckedAt: now,
      ...(snapshot.state === "Approved" && !before.approvedAt ? { approvedAt: now } : {}),
    },
  });
  if (updated.state !== before.state) {
    await audit(tx, updated.orgId, "worker", "partner.application.state", updated.id, {
      partnerId: updated.partnerId,
      from: before.state,
      to: updated.state,
    });
    await tx.notification.create({
      data: {
        orgId: updated.orgId,
        message: `${partnerModule(updated.partnerId).manifest.name}: ${updated.state}`,
        href: "/merchant/providers",
      },
    });
  }
  if (updated.state === "Approved" && !updated.integrationId) await bind(tx, updated.id);
  return updated;
}

// An approved merchant-owned account becomes an Integration in the merchant's
// organisation, which live-scope review can then reference.
async function bind(tx: Tx, applicationId: string) {
  const a = await tx.partnerApplication.findUniqueOrThrow({ where: { id: applicationId } });
  const last = await tx.integration.findFirst({
    where: { orgId: a.orgId, environment: a.environment },
    orderBy: { version: "desc" },
  });
  const integration = await tx.integration.create({
    data: {
      orgId: a.orgId,
      environment: a.environment,
      version: (last?.version ?? 0) + 1,
      config: json({
        adapter: a.partnerId,
        mode: "PARTNER",
        ownership: "merchant",
        accountId: a.providerAccountId ?? a.accountRef,
        partnerApplicationId: a.id,
      }),
    },
  });
  await tx.partnerApplication.update({
    where: { id: a.id },
    data: { integrationId: integration.id },
  });
  await audit(tx, a.orgId, "worker", "partner.account.bound", integration.id, {
    partnerId: a.partnerId,
    applicationId: a.id,
  });
}

async function fail(applicationId: string, reason: string) {
  await atomic(async (tx) => {
    const a = await tx.partnerApplication.update({
      where: { id: applicationId },
      data: { state: "Failed", reason: reason.slice(0, 200) },
    });
    await audit(tx, a.orgId, "worker", "partner.application.failed", a.id, {
      partnerId: a.partnerId,
      reason,
    }, reason.startsWith("PAYROUTA_SCREENING"));
  });
}

// Configuration problems (409) and provider rejections (422) are terminal for
// this application; transient failures are rethrown for worker retry.
function terminal(error: unknown) {
  return error instanceof PortalError && [404, 409, 422].includes(error.status);
}

export async function provision(applicationId: string) {
  const a = await db.partnerApplication.findUniqueOrThrow({ where: { id: applicationId } });
  if (a.state !== "Queued") return;
  const environment = env.parse(a.environment);
  const [consent, profile, org] = await Promise.all([
    db.partnerConsent.findUniqueOrThrow({ where: { id: a.consentId } }),
    db.merchantKybProfile.findUniqueOrThrow({
      where: { orgId_version: { orgId: a.orgId, version: a.profileVersion } },
    }),
    db.organization.findUniqueOrThrow({ where: { id: a.orgId } }),
  ]);
  if (consent.revokedAt) {
    await db.partnerApplication.update({
      where: { id: a.id },
      data: { state: "Disconnected", reason: "MERCHANT_REVOKED_CONSENT" },
    });
    return;
  }
  // The field list must be exactly what the merchant agreed to.
  let d;
  try {
    d = disclosure(a.partnerId, profile.version, profile.fingerprint);
  } catch (error) {
    if (terminal(error)) return fail(a.id, (error as Error).message);
    throw error;
  }
  if (d.fingerprint !== consent.disclosureFingerprint || consent.profileVersion !== profile.version)
    return fail(a.id, "CONSENT_OUTDATED");

  // Nothing leaves PayRouta for the fictional sandbox partner, and fictional
  // local organisations are fixtures, so both use the screening fixture. A
  // real partner never accepts a fixture result.
  const fixtureAllowed =
    partnerModule(a.partnerId).manifest.sandboxOnly === true ||
    (sandboxSimulation() && org.fictional && environment === "sandbox");
  let screening = await db.merchantScreening.findFirst({
    where: {
      orgId: a.orgId,
      profileVersion: profile.version,
      ...(fixtureAllowed ? {} : { provider: { not: "sandbox-fixture" } }),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!screening) {
    let result;
    try {
      result = await screenProfile(
        kybProfileSchema.parse(profile.data),
        screeningProvider(fixtureAllowed),
      );
    } catch (error) {
      // Screening outages are retried by the worker; the merchant sees a
      // PayRouta review in progress rather than an unexplained queue.
      await db.partnerApplication.update({
        where: { id: a.id },
        data: { reason: "PAYROUTA_SCREENING_REVIEW" },
      });
      throw error;
    }
    screening = await db.merchantScreening.create({
      data: {
        orgId: a.orgId,
        profileVersion: profile.version,
        provider: result.provider,
        verdict: result.verdict,
        results: json(result.results),
        createdBy: "worker",
      },
    });
  }
  if (screening.verdict === "match") return fail(a.id, "PAYROUTA_SCREENING_MATCH");
  if (screening.verdict === "review") {
    await db.partnerApplication.update({
      where: { id: a.id },
      data: { reason: "PAYROUTA_SCREENING_REVIEW" },
    });
    return;
  }

  const projected = projectProfile(
    kybProfileSchema.parse(profile.data),
    partnerModule(a.partnerId).manifest.sharedFields,
  );
  let created;
  try {
    const adapter = await adapterFor(a.partnerId, environment);
    created = await adapter.createAccount({
      applicationId: a.id,
      environment,
      profile: projected,
      ...returnUrls(a.partnerId),
    });
  } catch (error) {
    if (terminal(error)) return fail(a.id, (error as Error).message);
    throw error;
  }
  const snapshot = statusSnapshot.parse(created.snapshot);
  const disclosed = fingerprint(projected);
  await atomic(async (tx) => {
    await applySnapshot(tx, a.id, snapshot, {
      accountRef: created.accountRef.slice(0, 200),
      disclosedFingerprint: disclosed,
      submittedAt: new Date(),
    });
    await audit(tx, a.orgId, "worker", "partner.application.submitted", a.id, {
      partnerId: a.partnerId,
      environment,
      fields: Object.keys(projected).sort(),
      disclosedFingerprint: disclosed,
      screeningId: screening.id,
    });
  });
}

export async function refreshStatus(applicationId: string) {
  const a = await db.partnerApplication.findUniqueOrThrow({ where: { id: applicationId } });
  if (!a.accountRef || !(openStates.includes(a.state as PartnerState) || a.state === "Approved"))
    return;
  let snapshot: StatusSnapshot;
  try {
    const adapter = await adapterFor(a.partnerId, env.parse(a.environment));
    snapshot = statusSnapshot.parse(
      await adapter.status({
        accountRef: a.accountRef,
        providerAccountId: a.providerAccountId ?? undefined,
      }),
    );
  } catch (error) {
    // A disabled connection pauses checks without changing merchant state.
    if (error instanceof PortalError && error.status === 409) return;
    throw error;
  }
  await atomic((tx) => applySnapshot(tx, a.id, snapshot));
}

// Events never change state directly: they queue an authenticated re-read.
export async function processEvent(eventRowId: string) {
  const event = await db.partnerEvent.findUniqueOrThrow({ where: { id: eventRowId } });
  if (event.state !== "Received") return;
  const application = await db.partnerApplication.findFirst({
    where: {
      partnerId: event.partnerId,
      environment: event.environment,
      OR: [
        ...(event.accountRef ? [{ accountRef: event.accountRef }] : []),
        ...(event.providerAccountId ? [{ providerAccountId: event.providerAccountId }] : []),
      ],
    },
  });
  // A payment event concerns a specific attempt on a partner account.
  const attempt = event.objectRef
    ? await db.paymentAttempt.findFirst({
        where: { providerReference: event.objectRef, environment: event.environment },
        include: { intent: { select: { orgId: true } } },
      })
    : null;
  const attemptIntegration = attempt
    ? await db.integration.findUnique({ where: { id: attempt.integrationId } })
    : null;
  const paymentMatch =
    attempt &&
    (attemptIntegration?.config as { mode?: string; adapter?: string } | undefined)?.mode === "PARTNER" &&
    (attemptIntegration?.config as { adapter?: string }).adapter === event.partnerId
      ? attempt
      : null;
  await atomic(async (tx) => {
    if (application)
      await queue(tx, application.orgId, "partner-status", `partner-status:${application.id}:event:${event.id}`, {
        applicationId: application.id,
      });
    if (paymentMatch)
      await queue(tx, paymentMatch.intent.orgId, "payment-poll", `partner-payment:${paymentMatch.id}:${event.id}`, {
        attemptId: paymentMatch.id,
      });
    await tx.partnerEvent.update({
      where: { id: event.id },
      data: { state: application || paymentMatch ? "Processed" : "Unmatched" },
    });
  });
}

export async function partnerJob(kind: string, p: Record<string, string>) {
  if (kind === "partner-provision") await provision(p.applicationId);
  else if (kind === "partner-status") await refreshStatus(p.applicationId);
  else if (kind === "partner-event") await processEvent(p.eventId);
  else throw new Error("UNKNOWN_PARTNER_JOB");
}

// Periodic re-reads survive missed webhooks. Open applications every ten
// minutes; approved ones daily to catch later restrictions.
export async function sweepPartners(now = new Date()) {
  const rows = await db.partnerApplication.findMany({
    where: {
      accountRef: { not: null },
      OR: [
        {
          state: { in: openStates },
          OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 600000) } }],
        },
        { state: "Approved", lastCheckedAt: { lt: new Date(now.getTime() - 86400000) } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });
  const bucket = Math.floor(now.getTime() / 600000);
  for (const a of rows)
    await queue(db, a.orgId, "partner-status", `partner-status:${a.id}:sweep:${bucket}`, {
      applicationId: a.id,
    });
  return rows.length;
}
