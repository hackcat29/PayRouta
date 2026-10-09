// A merchant's sub-account under a PayRouta platform account.
//
// Operations open it during underwriting → the worker creates it at the
// provider entirely by API, from the profile, verification details and terms
// acceptance the merchant gave PayRouta (merchants never visit the provider)
// → status is re-read from the provider's authenticated API, and anything
// still due is shown to the merchant in PayRouta's own words → an approved
// sub-account becomes an Integration in the merchant's organisation that
// checkout can route to once the merchant is Live.
import { randomUUID } from "node:crypto";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { atomic, audit, json } from "../portal/service";
import { queue, type Tx } from "../payments/service";
import type { StatusSnapshot } from "../partners/contract";
import { statusSnapshot } from "../partners/contract";
import { kybProfileSchema, projectProfile } from "../partners/kyb";
import { platformAdapter, platformModule } from "./platforms/registry";
import { readVerificationDetails } from "./verification";

const openStates = ["Pending provider", "Action required", "Under review", "Restricted"];

export async function openPlatformLink(
  tx: Tx,
  input: { orgId: string; environment: string; platformAccountId: string },
  actorId: string,
) {
  const account = await tx.merchantAccount.findUnique({
    where: { orgId_environment: { orgId: input.orgId, environment: input.environment } },
  });
  if (!account || !["Underwriting", "Live", "Restricted"].includes(account.state))
    throw new PortalError("MERCHANT_ACCOUNT_NOT_IN_UNDERWRITING", 409);
  const platform = await tx.platformAccount.findUnique({ where: { id: input.platformAccountId } });
  if (!platform || platform.environment !== input.environment || !platform.enabled)
    throw new PortalError("PLATFORM_ACCOUNT_NOT_AVAILABLE", 409);
  if (account.legalEntityId && account.legalEntityId !== platform.legalEntityId)
    throw new PortalError("PLATFORM_ACCOUNT_OTHER_LEGAL_ENTITY", 409);
  const manifest = platformModule(platform.provider).manifest;
  const country = (
    (await tx.merchantKybProfile.findUnique({
      where: { orgId_version: { orgId: input.orgId, version: account.profileVersion } },
    }))?.data as { country?: string } | undefined
  )?.country;
  if (
    !(platform.merchantCountries as string[]).includes(country ?? "") ||
    (manifest.merchantCountries && !manifest.merchantCountries.includes(country ?? ""))
  )
    throw new PortalError("PLATFORM_ACCOUNT_COUNTRY_NOT_COVERED", 409);
  const existing = await tx.merchantPlatformLink.findUnique({
    where: { orgId_platformAccountId: { orgId: input.orgId, platformAccountId: platform.id } },
  });
  if (existing && !["Failed", "Disconnected"].includes(existing.state)) return existing;
  if (!account.detailsVersion || !account.agreementId)
    throw new PortalError("VERIFICATION_DETAILS_REQUIRED", 409);
  const data = {
    profileVersion: account.profileVersion,
    detailsVersion: account.detailsVersion,
    agreementId: account.agreementId,
    state: "Queued",
    providerAccountId: null,
    requirements: json([]),
    paymentsEnabled: false,
    payoutsEnabled: false,
    reason: null,
    integrationId: null,
  };
  const link = existing
    ? await tx.merchantPlatformLink.update({ where: { id: existing.id }, data })
    : await tx.merchantPlatformLink.create({
        data: {
          ...data,
          orgId: input.orgId,
          environment: input.environment,
          platformAccountId: platform.id,
        },
      });
  await queue(tx, input.orgId, "treasury-link-provision", `treasury-link-provision:${link.id}:${randomUUID()}`, {
    linkId: link.id,
  });
  await audit(tx, input.orgId, actorId, "treasury.link.opened", link.id, {
    platformAccountId: platform.id,
    provider: platform.provider,
    profileVersion: account.profileVersion,
  }, true);
  return link;
}

async function applySnapshot(tx: Tx, linkId: string, raw: StatusSnapshot, extra: Record<string, unknown> = {}) {
  const snapshot = statusSnapshot.parse(raw);
  const before = await tx.merchantPlatformLink.findUniqueOrThrow({ where: { id: linkId } });
  if (["Disconnected", "Failed"].includes(before.state)) return before;
  const updated = await tx.merchantPlatformLink.update({
    where: { id: linkId },
    data: {
      ...extra,
      state: snapshot.state,
      providerAccountId: snapshot.providerAccountId ?? before.providerAccountId,
      requirements: json(snapshot.requirementsDue),
      paymentsEnabled: snapshot.paymentsEnabled,
      payoutsEnabled: snapshot.payoutsEnabled,
      reason: snapshot.reason ?? null,
      lastCheckedAt: new Date(),
    },
  });
  if (updated.state !== before.state) {
    await audit(tx, updated.orgId, "worker", "treasury.link.state", updated.id, {
      from: before.state,
      to: updated.state,
    }, true);
    await tx.notification.create({
      data: {
        orgId: updated.orgId,
        message: `Payments account: ${updated.state}`,
        href: "/merchant/providers",
      },
    });
  }
  if (updated.state === "Approved" && updated.paymentsEnabled && !updated.integrationId)
    await bind(tx, updated.id);
  return updated;
}

// An approved sub-account becomes an Integration in the merchant's
// organisation; routing still requires the merchant to be Live.
async function bind(tx: Tx, linkId: string) {
  const link = await tx.merchantPlatformLink.findUniqueOrThrow({
    where: { id: linkId },
    include: { platformAccount: true },
  });
  const last = await tx.integration.findFirst({
    where: { orgId: link.orgId, environment: link.environment },
    orderBy: { version: "desc" },
  });
  const integration = await tx.integration.create({
    data: {
      orgId: link.orgId,
      environment: link.environment,
      version: (last?.version ?? 0) + 1,
      config: json({
        adapter: link.platformAccount.provider,
        mode: "PLATFORM",
        ownership: "platform",
        platformAccountId: link.platformAccountId,
        linkId: link.id,
      }),
    },
  });
  await tx.merchantPlatformLink.update({ where: { id: link.id }, data: { integrationId: integration.id } });
  await audit(tx, link.orgId, "worker", "treasury.link.bound", integration.id, { linkId: link.id }, true);
}

// Configuration problems (409) and provider rejections (422) end this link;
// transient failures are rethrown for worker retry.
async function fail(linkId: string, error: unknown) {
  if (!(error instanceof PortalError) || ![404, 409, 422].includes(error.status)) throw error;
  await atomic(async (tx) => {
    const link = await tx.merchantPlatformLink.update({
      where: { id: linkId },
      data: { state: "Failed", reason: error.message.slice(0, 200) },
    });
    await audit(tx, link.orgId, "worker", "treasury.link.failed", link.id, { reason: error.message }, true);
  });
}

export async function provisionLink(linkId: string) {
  const link = await db.merchantPlatformLink.findUniqueOrThrow({
    where: { id: linkId },
    include: { platformAccount: true, profile: true, details: true, agreement: true },
  });
  if (link.state !== "Queued") return;
  try {
    if (!link.details || !link.agreement)
      throw new PortalError("VERIFICATION_DETAILS_REQUIRED", 409);
    const mod = platformModule(link.platformAccount.provider);
    const profile = kybProfileSchema.parse(link.profile.data);
    const created = await platformAdapter(link.platformAccount).createAccount({
      linkId: link.id,
      environment: link.environment as "sandbox" | "production",
      profile: projectProfile(profile, mod.manifest.sharedFields),
      details: await readVerificationDetails(link.details.secretRef),
      agreement: link.agreement,
    });
    await atomic((tx) =>
      applySnapshot(tx, link.id, created.snapshot, { providerAccountId: created.providerAccountId }),
    );
  } catch (error) {
    await fail(link.id, error);
  }
}

export async function refreshLink(linkId: string) {
  const link = await db.merchantPlatformLink.findUniqueOrThrow({
    where: { id: linkId },
    include: { platformAccount: true },
  });
  if (!link.providerAccountId || ["Queued", "Failed", "Disconnected"].includes(link.state)) return;
  const snapshot = await platformAdapter(link.platformAccount).accountStatus(link.providerAccountId);
  await atomic((tx) => applySnapshot(tx, link.id, snapshot));
}

// Missed webhooks are covered by re-reads: open links every ten minutes,
// approved ones daily.
export async function sweepLinks(now = new Date()) {
  const rows = await db.merchantPlatformLink.findMany({
    where: {
      providerAccountId: { not: null },
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
  for (const l of rows)
    await queue(db, l.orgId, "treasury-link-status", `treasury-link-status:${l.id}:${bucket}`, { linkId: l.id });
  return rows.length;
}
