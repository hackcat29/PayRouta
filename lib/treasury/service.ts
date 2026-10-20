// Authorised entry points for the aggregator foundation. Operations actions
// require an internal Operations admin with step-up; merchants may only
// submit their own account and read its state.
import { z } from "zod";
import { missingStandardFees, splitPlatformConfig } from "./partner-fees";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { internal, stepUp } from "../portal/access";
import { atomic, audit, json } from "../portal/service";
import { secretManager } from "../portal/adapters";
import { merchantMember } from "../merchant/access";
import { platformCustodyModes } from "./custody";
import { openPlatformLink } from "./links";
import { payoutEligible, requestPayout } from "./payouts";
import { requestRefund } from "./refunds";
import { submitDisputeEvidence } from "./disputes";
import { reconcileLink } from "./reconciliation";
import {
  acceptMerchantTerms,
  acceptanceContext,
  saveVerificationDetails,
} from "./verification";
import { kybProfileSchema } from "../partners/kyb";
import { platformModule } from "./platforms/registry";
import { merchantTreasury } from "./views";
import {
  liveBlockers,
  merchantAccountStates,
  submitMerchantAccount,
  transitionMerchantAccount,
} from "./merchant-account";
import { merchantTerms, riskTiers } from "./terms";

const env = z.enum(["sandbox", "production"]);
const country = z.string().regex(/^[A-Z]{2}$/);
const reason = z.string().trim().min(10).max(1000);
const id = z.string().min(1).max(100);

const entityInput = z
  .object({
    action: z.literal("legal-entity"),
    id: id.optional(),
    name: z.string().trim().min(2).max(200),
    jurisdiction: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/),
    licensedCountries: z.array(country).max(250),
    reason,
  })
  .strict();

export async function configureLegalEntity(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = entityInput.parse(raw);
  const data = {
    name: input.name,
    jurisdiction: input.jurisdiction,
    licensedCountries: json([...new Set(input.licensedCountries)].sort()),
    updatedBy: actor.user.id,
  };
  return atomic(async (tx) => {
    const saved = input.id
      ? await tx.legalEntity.update({ where: { id: input.id }, data })
      : await tx.legalEntity.create({ data });
    await audit(tx, null, actor.user.id, "treasury.legal-entity.configured", saved.id, {
      ...data,
      reason: input.reason,
    }, true);
    return { id: saved.id };
  });
}

const platformInput = z
  .object({
    action: z.literal("platform-account"),
    legalEntityId: id,
    provider: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/),
    environment: env,
    custody: z.enum(platformCustodyModes),
    merchantCountries: z.array(country).min(1).max(250),
    config: z.record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean()])),
    secrets: z.record(z.string().max(80), z.string().min(1).max(4000)).default({}),
    enabled: z.boolean(),
    reason,
  })
  .strict();

// PayRouta's master account at a provider. Secrets are stored as references;
// enabling in production requires the same account's sandbox twin to be
// qualified first.
export async function configurePlatformAccount(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = platformInput.parse(raw);
  const key = {
    legalEntityId: input.legalEntityId,
    provider: input.provider,
  };
  if (input.environment === "production" && input.enabled) {
    const sandbox = await db.platformAccount.findUnique({
      where: { legalEntityId_provider_environment: { ...key, environment: "sandbox" } },
    });
    if (!sandbox?.qualifiedAt) throw new PortalError("SANDBOX_QUALIFICATION_REQUIRED", 409);
  }
  const mod = platformModule(input.provider);
  if (mod.manifest.custody !== input.custody)
    throw new PortalError("PLATFORM_CUSTODY_MISMATCH", 409);
  if (mod.manifest.sandboxOnly && input.environment !== "sandbox")
    throw new PortalError("SANDBOX_PLATFORM_ONLY", 409);
  const previous = await db.platformAccount.findUnique({
    where: { legalEntityId_provider_environment: { ...key, environment: input.environment } },
  });
  if (previous && previous.custody !== input.custody)
    throw new PortalError("PLATFORM_CUSTODY_IMMUTABLE", 409);
  const refs: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.secrets))
    refs[name] = await secretManager.put(value);
  const config = {
    ...((previous?.config as Record<string, unknown>) ?? {}),
    ...input.config,
    ...refs,
  };
  let invalid = false;
  try {
    invalid = !mod.configSchema.safeParse({
      ...splitPlatformConfig(config).moduleConfig,
      environment: input.environment,
    }).success;
  } catch {
    invalid = true;
  }
  if (invalid) {
    for (const ref of Object.values(refs)) await secretManager.revoke(ref);
    throw new PortalError("PLATFORM_ACCOUNT_CONFIG_INVALID", 409);
  }
  // Where PayRouta pays the partner, merchants are charged the partner's
  // standard fee; a live rail without it would lose money on every payment.
  if (input.environment === "production" && input.enabled && missingStandardFees(mod.manifest, config).length) {
    for (const ref of Object.values(refs)) await secretManager.revoke(ref);
    throw new PortalError(`PLATFORM_STANDARD_FEES_REQUIRED:${missingStandardFees(mod.manifest, config).join(",")}`, 409);
  }
  const data = {
    custody: input.custody,
    merchantCountries: json([...new Set(input.merchantCountries)].sort()),
    config: json(config),
    enabled: input.enabled,
    updatedBy: actor.user.id,
  };
  return atomic(async (tx) => {
    const saved = await tx.platformAccount.upsert({
      where: { legalEntityId_provider_environment: { ...key, environment: input.environment } },
      create: { ...key, environment: input.environment, ...data },
      update: data,
    });
    await audit(tx, null, actor.user.id, "treasury.platform-account.configured", saved.id, {
      ...key,
      environment: input.environment,
      custody: input.custody,
      merchantCountries: input.merchantCountries,
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
    action: z.literal("platform-account-qualify"),
    platformAccountId: id,
    // Each step must be evidenced against the provider's own sandbox.
    evidence: z
      .object({
        onboarding: z.string().min(10).max(1000),
        payment: z.string().min(10).max(1000),
        payout: z.string().min(10).max(1000),
        reconciliation: z.string().min(10).max(1000),
      })
      .strict(),
    reason,
  })
  .strict();

export async function qualifyPlatformAccount(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = qualifyInput.parse(raw);
  return atomic(async (tx) => {
    const account = await tx.platformAccount.findUnique({
      where: { id: input.platformAccountId },
    });
    if (!account?.enabled || account.environment !== "sandbox")
      throw new PortalError("SANDBOX_PLATFORM_ACCOUNT_REQUIRED", 409);
    const now = new Date();
    await tx.platformAccount.update({
      where: { id: account.id },
      data: {
        qualifiedAt: now,
        qualification: json({ ...input.evidence, by: actor.user.id, at: now.toISOString() }),
      },
    });
    await audit(tx, null, actor.user.id, "treasury.platform-account.qualified", account.id, {
      evidence: input.evidence,
      reason: input.reason,
    }, true);
    return { qualifiedAt: now.toISOString() };
  });
}

const decision = z
  .object({
    legalEntityId: id,
    riskTier: z.enum(riskTiers),
    terms: z.unknown(),
  })
  .strict();
const transitionInput = z
  .object({
    action: z.literal("merchant-account-transition"),
    orgId: id,
    environment: env,
    expectedVersion: z.number().int().positive(),
    to: z.enum(merchantAccountStates),
    reason,
    decision: decision.optional(),
  })
  .strict();

export async function reviewMerchantAccount(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = transitionInput.parse(raw);
  return atomic(async (tx) => {
    const account = await transitionMerchantAccount(
      tx,
      { ...input, decision: input.decision as never },
      actor.user.id,
    );
    return { state: account.state, version: account.version };
  });
}

const previewInput = z
  .object({
    action: z.literal("merchant-account-preview"),
    orgId: id,
    environment: env,
    decision,
  })
  .strict();

// Lets a reviewer see every blocker before attempting Live.
export async function previewMerchantLive(raw: unknown, headers: Headers) {
  await internal(true, headers);
  const input = previewInput.parse(raw);
  return atomic(async (tx) => {
    const account = await tx.merchantAccount.findUnique({
      where: { orgId_environment: { orgId: input.orgId, environment: input.environment } },
    });
    if (!account) throw new PortalError("MERCHANT_ACCOUNT_NOT_FOUND", 404);
    return { blockers: await liveBlockers(tx, account, input.decision as never) };
  });
}

const linkInput = z
  .object({
    action: z.literal("platform-link"),
    orgId: id,
    environment: env,
    platformAccountId: id,
  })
  .strict();

// Underwriting opens the merchant's sub-account under a platform account.
export async function openMerchantPlatformLink(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = linkInput.parse(raw);
  return atomic(async (tx) => {
    const link = await openPlatformLink(tx, input, actor.user.id);
    return { id: link.id, state: link.state };
  });
}

const detailsInput = z.object({ action: z.literal("verification-details"), orgId: id, input: z.unknown() }).strict();

// Identity and payout details go to PayRouta only. Sensitive, so step-up.
export async function saveMerchantVerification(raw: unknown, headers: Headers) {
  const input = detailsInput.parse(raw);
  const { session } = await merchantMember(input.orgId, "configure", headers);
  await stepUp(headers);
  return atomic(async (tx) => {
    const profile = await tx.merchantKybProfile.findFirst({
      where: { orgId: input.orgId },
      orderBy: { version: "desc" },
    });
    if (!profile) throw new PortalError("KYB_PROFILE_REQUIRED", 409);
    const saved = await saveVerificationDetails(
      tx,
      input.orgId,
      input.input,
      kybProfileSchema.parse(profile.data),
      session.user.id,
    );
    return { version: saved.version, summary: saved.summary };
  });
}

export async function acceptTerms(orgId: string, headers: Headers) {
  const { session } = await merchantMember(orgId, "configure", headers);
  const context = acceptanceContext(headers);
  return atomic(async (tx) => {
    const agreement = await acceptMerchantTerms(tx, orgId, session.user.id, context);
    return { version: agreement.version, acceptedAt: agreement.acceptedAt.toISOString() };
  });
}

const payoutInput = z
  .object({
    action: z.literal("payout"),
    orgId: id,
    asset: z.string().regex(/^fiat:[A-Z]{3}:$/),
    // Omit to pay out everything eligible.
    amountMinor: z.string().regex(/^[1-9]\d{0,29}$/).optional(),
  })
  .strict();

// A merchant-requested payout. Merchants never pick a provider: an amount is
// paid from whichever platform account holds enough of it; "everything" pays
// out each platform account's eligible balance.
export async function requestMerchantPayout(raw: unknown, headers: Headers) {
  const input = payoutInput.parse(raw);
  const { session, config } = await merchantMember(input.orgId, "configure", headers);
  await stepUp(headers);
  const now = new Date();
  return atomic(async (tx) => {
    const account = await tx.merchantAccount.findUnique({
      where: { orgId_environment: { orgId: input.orgId, environment: config.environment } },
    });
    if (!account) throw new PortalError("MERCHANT_NOT_LIVE", 409);
    const terms = merchantTerms.parse(account.terms);
    const links = await tx.merchantPlatformLink.findMany({
      where: { orgId: input.orgId, environment: config.environment, state: "Approved", payoutsEnabled: true },
      orderBy: { createdAt: "asc" },
    });
    const wanted = input.amountMinor ? BigInt(input.amountMinor) : null;
    const payouts = [];
    for (const link of links) {
      const eligible = await payoutEligible(tx, {
        orgId: input.orgId,
        environment: config.environment,
        platformAccountId: link.platformAccountId,
        asset: input.asset,
        delayDays: account.state === "Offboarding" ? 0 : terms.payout.delayDays,
        now,
      });
      if (eligible <= 0n || (wanted !== null && eligible < wanted)) continue;
      payouts.push(
        await requestPayout(tx, {
          orgId: input.orgId,
          environment: config.environment,
          platformAccountId: link.platformAccountId,
          asset: input.asset,
          amountMinor: wanted ?? eligible,
          initiatedBy: session.user.id,
          now,
        }),
      );
      if (wanted !== null) break;
    }
    if (!payouts.length) throw new PortalError(wanted ? "INSUFFICIENT_AVAILABLE_BALANCE" : "NOTHING_TO_PAY_OUT", 409);
    return { payouts: payouts.map((p) => ({ id: p!.id, amountMinor: p!.amountMinor.toFixed(0), state: p!.state })) };
  });
}

const refundInput = z
  .object({
    action: z.literal("refund"),
    orgId: id,
    intentId: id,
    // Omit to refund what remains of the payment.
    amountMinor: z.string().regex(/^[1-9]\d{0,29}$/).optional(),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict();

// Refunds move money back to a customer, so they need step-up.
export async function requestMerchantRefund(raw: unknown, headers: Headers) {
  const input = refundInput.parse(raw);
  const { session, config } = await merchantMember(input.orgId, "configure", headers);
  await stepUp(headers);
  return atomic(async (tx) => {
    const refund = await requestRefund(tx, {
      orgId: input.orgId,
      environment: config.environment,
      intentId: input.intentId,
      amountMinor: input.amountMinor ? BigInt(input.amountMinor) : undefined,
      reason: input.reason,
      initiatedBy: session.user.id,
      now: new Date(),
    });
    return { id: refund.id, amountMinor: refund.amountMinor.toFixed(0), state: refund.state };
  });
}

const evidenceInput = z
  .object({ action: z.literal("dispute-evidence"), orgId: id, disputeId: id, evidence: z.unknown() })
  .strict();

// The merchant's response to a dispute. Sent to the card network through the
// processing partner, so it needs step-up and can only be sent once.
export async function respondToDispute(raw: unknown, headers: Headers) {
  const input = evidenceInput.parse(raw);
  const { session, config } = await merchantMember(input.orgId, "configure", headers);
  await stepUp(headers);
  const d = await submitDisputeEvidence({
    orgId: input.orgId,
    environment: config.environment,
    disputeId: input.disputeId,
    evidence: input.evidence,
    actorId: session.user.id,
  });
  return { id: d.id, evidenceSubmittedAt: d.evidenceSubmittedAt?.toISOString() };
}

const rerunInput = z.object({ action: z.literal("reconciliation-rerun"), linkId: id, reason }).strict();

// Re-runs today's reconciliation for one merchant at one platform account,
// for example after operations corrected a mismatch.
export async function rerunReconciliation(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const input = rerunInput.parse(raw);
  const rows = await reconcileLink(input.linkId);
  await atomic((tx) =>
    audit(tx, rows[0]?.orgId ?? null, actor.user.id, "treasury.reconciliation.rerun", input.linkId, {
      reason: input.reason,
      results: rows.map((r) => ({ asset: r.asset, result: r.result })),
    }, true),
  );
  return { results: rows.map((r) => ({ asset: r.asset, result: r.result, providerMinor: r.providerMinor.toFixed(0), ledgerMinor: r.ledgerMinor.toFixed(0) })) };
}

export async function submitForUnderwriting(orgId: string, headers: Headers) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  return atomic(async (tx) => {
    const account = await submitMerchantAccount(tx, orgId, config.environment, session.user.id);
    return { state: account.state, version: account.version };
  });
}

export async function merchantAccountOverview(orgId: string, headers: Headers) {
  const { config } = await merchantMember(orgId, "read", headers);
  return merchantTreasury(orgId, config.environment);
}
