// Merchant underwriting for aggregator custody (docs/AGGREGATOR.md §3).
//
// A merchant submits once its fiat requirements are met (lib/merchant/
// requirements.ts) → operations underwrite it
// (legal entity, risk tier, terms) → only a Live merchant may take payments
// through a PayRouta platform account. Every transition is an immutable
// MerchantAccountTransition row; the account row carries an optimistic
// version so two reviewers cannot both act on the same state.
import { randomUUID } from "node:crypto";
import { PortalError } from "../portal/domain";
import { audit, json } from "../portal/service";
import type { Tx } from "../payments/service";
import { custodyBlocker, type PlatformCustody } from "./custody";
import { merchantTerms, riskTiers, termsBlockers, type RiskTier } from "./terms";
import { merchantTermsVersion } from "./verification";
import { platformModule } from "./platforms/registry";
import { loadRequirements } from "../merchant/requirements";

export const merchantAccountStates = [
  "Submitted",
  "Underwriting",
  "Returned",
  "Live",
  "Restricted",
  "Offboarding",
  "Closed",
] as const;
export type MerchantAccountState = (typeof merchantAccountStates)[number];

// Operations transitions. Submitted (first time or after Returned) is the
// merchant's own action, see submitMerchantAccount.
const transitions: Record<MerchantAccountState, readonly MerchantAccountState[]> = {
  Submitted: ["Underwriting"],
  Underwriting: ["Live", "Returned", "Closed"],
  Returned: [],
  Live: ["Restricted", "Offboarding"],
  Restricted: ["Live", "Offboarding"],
  Offboarding: ["Closed"],
  Closed: [],
};
export function canTransition(from: MerchantAccountState, to: MerchantAccountState) {
  return transitions[from].includes(to);
}

// What each state still permits on a platform account. Restricted freezes new
// payments and payouts but customers can still be refunded; Offboarding pays
// out what remains.
export type FundsOperation = "pay-in" | "refund" | "payout";
const permitted: Record<MerchantAccountState, readonly FundsOperation[]> = {
  Submitted: [],
  Underwriting: [],
  Returned: [],
  Live: ["pay-in", "refund", "payout"],
  Restricted: ["refund"],
  Offboarding: ["refund", "payout"],
  Closed: [],
};
export function permits(state: MerchantAccountState, operation: FundsOperation) {
  return permitted[state].includes(operation);
}

export type UnderwritingDecision = {
  legalEntityId: string;
  riskTier: RiskTier;
  terms: unknown;
};

async function latestProfile(tx: Tx, orgId: string) {
  return tx.merchantKybProfile.findFirst({
    where: { orgId },
    orderBy: { version: "desc" },
  });
}
async function latestDetails(tx: Tx, orgId: string) {
  return tx.merchantVerificationDetails.findFirst({
    where: { orgId },
    orderBy: { version: "desc" },
  });
}
async function currentAgreement(tx: Tx, orgId: string) {
  return tx.merchantAgreement.findFirst({
    where: { orgId, version: merchantTermsVersion },
    orderBy: { acceptedAt: "desc" },
  });
}

export async function submitMerchantAccount(
  tx: Tx,
  orgId: string,
  environment: string,
  actorId: string,
) {
  const profile = await latestProfile(tx, orgId);
  if (!profile) throw new PortalError("KYB_PROFILE_REQUIRED", 409);
  const agreement = await currentAgreement(tx, orgId);
  if (!agreement) throw new PortalError("MERCHANT_TERMS_NOT_ACCEPTED", 409);
  // What fiat needs depends on the merchant's type and volume
  // (lib/merchant/requirements.ts); documents may still be in review.
  if (!(await loadRequirements(tx, orgId, environment)).ready.fiat)
    throw new PortalError("FIAT_REQUIREMENTS_DUE", 409);
  const details = await latestDetails(tx, orgId);
  if (!details) throw new PortalError("VERIFICATION_DETAILS_REQUIRED", 409);
  const pinned = {
    profileVersion: profile.version,
    detailsVersion: details.version,
    agreementId: agreement.id,
  };
  const existing = await tx.merchantAccount.findUnique({
    where: { orgId_environment: { orgId, environment } },
  });
  if (existing && existing.state !== "Returned")
    throw new PortalError("MERCHANT_ACCOUNT_ALREADY_SUBMITTED", 409);
  const account = existing
    ? await tx.merchantAccount.update({
        where: { id: existing.id, version: existing.version },
        data: { state: "Submitted", ...pinned, version: { increment: 1 } },
      })
    : await tx.merchantAccount.create({ data: { orgId, environment, ...pinned } });
  await tx.merchantAccountTransition.create({
    data: {
      id: randomUUID(),
      merchantAccountId: account.id,
      from: existing?.state ?? null,
      to: "Submitted",
      reason: "Merchant submitted its business profile for review",
      actorId,
      evidence: json(pinned),
    },
  });
  await audit(tx, orgId, actorId, "merchant.account.submitted", account.id, {
    environment,
    ...pinned,
  });
  return account;
}

// Every reason the merchant cannot be Live under `decision`. Empty means the
// gate passes. Checked on Underwriting → Live and again on Restricted → Live.
export async function liveBlockers(
  tx: Tx,
  account: {
    orgId: string;
    environment: string;
    profileVersion: number;
    detailsVersion: number | null;
    agreementId: string | null;
  },
  decision: UnderwritingDecision,
) {
  const blockers: string[] = [];
  const profile = await latestProfile(tx, account.orgId);
  if (profile?.version !== account.profileVersion)
    blockers.push("PROFILE_CHANGED_RESUBMIT");
  const details = await latestDetails(tx, account.orgId);
  if (!account.detailsVersion || details?.version !== account.detailsVersion)
    blockers.push("DETAILS_CHANGED_RESUBMIT");
  const agreement = account.agreementId
    ? await tx.merchantAgreement.findUnique({ where: { id: account.agreementId } })
    : null;
  if (agreement?.version !== merchantTermsVersion) blockers.push("MERCHANT_TERMS_NOT_ACCEPTED");
  const production = account.environment === "production";
  const screening = await tx.merchantScreening.findFirst({
    where: {
      orgId: account.orgId,
      profileVersion: account.profileVersion,
      ...(production ? { provider: { not: "sandbox-fixture" } } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!screening) blockers.push("SCREENING_REQUIRED");
  else if (screening.verdict !== "clear") blockers.push("SCREENING_NOT_CLEAR");
  if (production) {
    const org = await tx.organization.findUniqueOrThrow({
      where: { id: account.orgId },
    });
    if (org.fictional) blockers.push("FICTIONAL_ORGANIZATION");
  }
  if (!riskTiers.includes(decision.riskTier)) blockers.push("RISK_TIER_INVALID");
  const terms = merchantTerms.safeParse(decision.terms);
  if (!terms.success) blockers.push("TERMS_INVALID");
  else if (riskTiers.includes(decision.riskTier))
    blockers.push(...termsBlockers(decision.riskTier, terms.data));
  const entity = await tx.legalEntity.findUnique({
    where: { id: decision.legalEntityId },
  });
  if (!entity) return [...blockers, "LEGAL_ENTITY_UNKNOWN"];
  const country = (
    (await tx.merchantKybProfile.findUnique({
      where: {
        orgId_version: { orgId: account.orgId, version: account.profileVersion },
      },
    }))?.data as { country?: string } | undefined
  )?.country;
  const platforms = await tx.platformAccount.findMany({
    where: {
      legalEntityId: entity.id,
      environment: account.environment,
      enabled: true,
      ...(production ? { qualifiedAt: { not: null } } : {}),
    },
  });
  const reserve = terms.success ? terms.data.reserve.basisPoints : 0;
  const platformBlockers = platforms.map((p) => {
    const blocked = custodyBlocker({
      custody: p.custody as PlatformCustody,
      merchantCountry: country ?? "",
      merchantCountries: p.merchantCountries as string[],
      licensedCountries: entity.licensedCountries as string[],
    });
    if (blocked) return blocked;
    let manifest;
    try {
      manifest = platformModule(p.provider).manifest;
    } catch {
      return "PLATFORM_UNAVAILABLE";
    }
    if (manifest.merchantCountries && !manifest.merchantCountries.includes(country ?? ""))
      return "PLATFORM_ACCOUNT_COUNTRY_NOT_COVERED";
    // Split settlement pays merchants directly: nowhere to hold a reserve.
    if (!manifest.holdsFunds && reserve > 0) return "RESERVE_NOT_SUPPORTED_BY_PLATFORM";
    return null;
  });
  if (!platformBlockers.includes(null))
    return [
      ...blockers,
      platformBlockers.includes("RESERVE_NOT_SUPPORTED_BY_PLATFORM")
        ? "RESERVE_NOT_SUPPORTED_BY_PLATFORM"
        : platformBlockers.includes("PAYROUTA_LICENCE_REQUIRED")
          ? "PAYROUTA_LICENCE_REQUIRED"
          : "NO_PLATFORM_ACCOUNT_FOR_MERCHANT_COUNTRY",
    ];
  // The provider must also have verified the merchant's sub-account.
  const approved = await tx.merchantPlatformLink.count({
    where: {
      orgId: account.orgId,
      environment: account.environment,
      platformAccountId: {
        in: platforms.filter((_, i) => platformBlockers[i] === null).map((p) => p.id),
      },
      state: "Approved",
      paymentsEnabled: true,
      payoutsEnabled: true,
    },
  });
  if (!approved) blockers.push("PLATFORM_SUB_ACCOUNT_NOT_APPROVED");
  return blockers;
}

// Merchant liabilities that must be zero before an account can close.
const owedAccounts = [
  "merchant-pending",
  "merchant-available",
  "merchant-reserve",
  "merchant-dispute-hold",
  "merchant-receivable",
  "payout-in-transit",
];

export async function transitionMerchantAccount(
  tx: Tx,
  input: {
    orgId: string;
    environment: string;
    expectedVersion: number;
    to: MerchantAccountState;
    reason: string;
    decision?: UnderwritingDecision;
  },
  actorId: string,
) {
  const account = await tx.merchantAccount.findUnique({
    where: {
      orgId_environment: { orgId: input.orgId, environment: input.environment },
    },
  });
  if (!account) throw new PortalError("MERCHANT_ACCOUNT_NOT_FOUND", 404);
  if (account.version !== input.expectedVersion)
    throw new PortalError("MERCHANT_ACCOUNT_VERSION_CONFLICT", 409);
  const from = account.state as MerchantAccountState;
  if (!canTransition(from, input.to))
    throw new PortalError("MERCHANT_ACCOUNT_TRANSITION_NOT_ALLOWED", 409);
  if (input.decision && input.to !== "Live")
    throw new PortalError("UNDERWRITING_DECISION_ONLY_ON_LIVE", 400);
  // Underwriting decides the terms; reinstating a restricted merchant may
  // revise them or keep the current ones.
  const decision =
    input.decision ??
    (from === "Restricted"
      ? {
          legalEntityId: account.legalEntityId!,
          riskTier: account.riskTier as RiskTier,
          terms: account.terms,
        }
      : undefined);
  if (input.to === "Live") {
    if (!decision) throw new PortalError("UNDERWRITING_DECISION_REQUIRED", 400);
    if (
      from === "Restricted" &&
      decision.legalEntityId !== account.legalEntityId
    )
      throw new PortalError("LEGAL_ENTITY_CHANGE_REQUIRES_OFFBOARDING", 409);
    const blockers = await liveBlockers(tx, account, decision);
    if (blockers.length)
      throw new PortalError(`MERCHANT_LIVE_BLOCKED: ${blockers.join(", ")}`, 409);
  }
  if (input.to === "Closed" && from === "Offboarding") {
    const open = await tx.merchantBalance.findFirst({
      where: {
        orgId: account.orgId,
        environment: account.environment,
        account: { in: owedAccounts },
        balance: { not: 0 },
      },
    });
    if (open) throw new PortalError("MERCHANT_BALANCES_OUTSTANDING", 409);
  }
  const updated = await tx.merchantAccount.update({
    where: { id: account.id, version: account.version },
    data: {
      state: input.to,
      version: { increment: 1 },
      ...(input.to === "Live"
        ? {
            legalEntityId: decision!.legalEntityId,
            riskTier: decision!.riskTier,
            terms: json(decision!.terms),
          }
        : {}),
    },
  });
  await tx.merchantAccountTransition.create({
    data: {
      id: randomUUID(),
      merchantAccountId: account.id,
      from,
      to: input.to,
      reason: input.reason,
      actorId,
      evidence: json({ decision: input.decision ?? null }),
    },
  });
  await audit(tx, account.orgId, actorId, "merchant.account.transition", account.id, {
    environment: account.environment,
    from,
    to: input.to,
    reason: input.reason,
    decision: input.decision ?? null,
  }, true);
  return updated;
}

// The guard every aggregator money movement calls first (phase 2 execution,
// refunds and payouts). Returns the merchant and the platform account only
// when this operation is allowed for this merchant on that account.
export async function requireFundsAccess(
  tx: Tx,
  input: {
    orgId: string;
    environment: string;
    platformAccountId: string;
    operation: FundsOperation;
  },
) {
  const account = await tx.merchantAccount.findUnique({
    where: {
      orgId_environment: { orgId: input.orgId, environment: input.environment },
    },
  });
  if (!account || !permits(account.state as MerchantAccountState, input.operation))
    throw new PortalError("MERCHANT_NOT_LIVE", 409);
  const platform = await tx.platformAccount.findUnique({
    where: { id: input.platformAccountId },
  });
  if (
    !platform?.enabled ||
    platform.environment !== account.environment ||
    platform.legalEntityId !== account.legalEntityId ||
    (account.environment === "production" && !platform.qualifiedAt)
  )
    throw new PortalError("PLATFORM_ACCOUNT_NOT_AVAILABLE", 409);
  return { account, platform };
}
