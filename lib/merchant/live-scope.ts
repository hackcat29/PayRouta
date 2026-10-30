import { chain } from "../blockchain/chains";
import { tokenAssets as stableAssets } from "../blockchain/assets";
import {
  cryptoAssets,
  paymentAsset as tokenAsset,
  onchainMethod,
} from "../blockchain/crypto-assets";
const tokenAssets = [...stableAssets, ...cryptoAssets];
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { stablecoinDepositConfig as depositConfigSchema, isDepositAdapter } from "../blockchain/deposit-config";
import { assertLaunchMethod } from "../payments/launch";
import { supportedPaymentMethodIds } from "../providers/normalized";
import { internal } from "../portal/access";
import { atomic, audit, json } from "../portal/service";
import { PortalError, capabilitySchema } from "../portal/domain";
import type { Tx } from "../payments/service";
import { partnerModule } from "../partners/registry";

const id = z.string().min(1).max(200);
const positiveMinor = z.string().regex(/^[1-9]\d{0,29}$/);
// Live review is explicit, never a wildcard: one merchant country, an explicit
// list of payer countries, named methods and one exact asset (settled in
// the same currency). Accounts are either merchant-owned partner accounts
// (the provider contracted with the merchant directly) or connected accounts
// the merchant already held, which need uploaded permission, settlement and
// refund evidence.
const country = z.string().regex(/^[A-Z]{2}$/);
const reviewedAsset = z
  .string()
  .refine(
    (v) =>
      /^fiat:[A-Z]{3}:$/.test(v) ||
      tokenAssets.some(
        (a) =>
          `blockchain:${a.identifier}:${a.network}` === v &&
          chain(a.network)?.testnet === false,
      ),
  );
export function reviewedAssetParts(key: string) {
  const token = tokenAssets.find(
    (a) => `blockchain:${a.identifier}:${a.network}` === key,
  );
  return token
    ? {
        kind: "blockchain",
        identifier: token.identifier,
        network: token.network,
      }
    : { kind: "fiat", identifier: key.split(":")[1], network: "" };
}
export const liveScopeInput = z
  .object({
    environment: z.literal("production"),
    merchantCountry: country,
    payerCountries: z.array(country).min(1).max(50),
    methods: z
      .array(z.enum(supportedPaymentMethodIds))
      .min(1)
      .max(supportedPaymentMethodIds.length),
    asset: reviewedAsset,
    settlementAsset: reviewedAsset,
    additionalAssets: z
      .array(
        z
          .object({
            asset: reviewedAsset,
            maximumMinor: positiveMinor,
            dailyMaximumMinor: positiveMinor,
          })
          .strict(),
      )
      .max(199)
      .default([]),
    maximumMinor: positiveMinor,
    dailyMaximumMinor: positiveMinor,
    profileIds: z.array(id).max(10),
    accounts: z
      .array(
        z
          .object({
            integrationId: id,
            accountReference: id,
            permissionEvidenceId: id.optional(),
            settlementDestinationEvidenceId: id.optional(),
            refundResponsibilityEvidenceId: id.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    evidenceIds: z.array(id).min(1).max(30),
    nextReviewAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const asset = reviewedAssetParts(value.asset);
    const assetKeys = [
      value.asset,
      ...value.additionalAssets.map((a) => a.asset),
    ];
    if (
      new Set(assetKeys).size !== assetKeys.length ||
      value.additionalAssets.some(
        (a) =>
          reviewedAssetParts(a.asset).kind !== "blockchain" ||
          BigInt(a.maximumMinor) > BigInt(a.dailyMaximumMinor),
      ) ||
      (value.additionalAssets.length && asset.kind !== "blockchain")
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Additional chains need distinct supported token assets and explicit limits",
      });
    if (
      asset.kind === "blockchain" &&
      (!tokenAsset(asset.network, asset.identifier) ||
        value.methods.some((m) => !["stablecoin", "crypto-app"].includes(m)) ||
        assetKeys.some((k) => {
          const a = reviewedAssetParts(k);
          return !value.methods.includes(
            onchainMethod(a.network, a.identifier),
          );
        }) ||
        value.methods.some(
          (m) =>
            !assetKeys.some((k) => {
              const a = reviewedAssetParts(k);
              return onchainMethod(a.network, a.identifier) === m;
            }),
        ))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Blockchain live scope requires exact supported assets and their on-chain payment methods",
      });
    if (
      asset.kind === "fiat" &&
      value.methods.some((m) => ["stablecoin", "crypto-app"].includes(m))
    )
      ctx.addIssue({
        code: "custom",
        message: "Stablecoin scope requires a token asset",
      });
    if (value.settlementAsset !== value.asset)
      ctx.addIssue({
        code: "custom",
        path: ["settlementAsset"],
        message: "Settlement must be in the same currency",
      });
    if (BigInt(value.maximumMinor) > BigInt(value.dailyMaximumMinor))
      ctx.addIssue({
        code: "custom",
        path: ["dailyMaximumMinor"],
        message: "Daily limit must cover one transaction",
      });
    for (const [field, values] of [
      ["profileIds", value.profileIds],
      ["methods", value.methods],
      ["payerCountries", value.payerCountries],
      ["evidenceIds", value.evidenceIds],
      ["accounts", value.accounts.map((a) => a.integrationId)],
    ] as const)
      if (new Set(values).size !== values.length)
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Duplicate scope entry",
        });
  });
export const storedLiveScope = z
  .object({
    status: z.enum(["Proposed", "Approved", "Revoked"]),
    version: id,
    applicationVersion: z.number().int(),
    input: liveScopeInput,
    approvedAt: z.iso.datetime().optional(),
    approvedBy: id.optional(),
  })
  .strict();
export type LiveScopeInput = z.infer<typeof liveScopeInput>;
export function scopeReviewCurrent(scope: unknown, now = new Date()) {
  const parsed = storedLiveScope.safeParse(scope);
  return (
    parsed.success &&
    parsed.data.status === "Approved" &&
    new Date(parsed.data.input.nextReviewAt) > now
  );
}
function assertReviewDate(scope: LiveScopeInput, now: Date) {
  const review = new Date(scope.nextReviewAt);
  if (review <= now || review.getTime() > now.getTime() + 365 * 86400000)
    throw new PortalError("REVIEW_DATE_MUST_BE_WITHIN_ONE_YEAR", 409);
}
export async function validateScopeEvidence(
  tx: Tx,
  orgId: string,
  scope: LiveScopeInput,
  application: unknown,
  now: Date,
) {
  assertReviewDate(scope, now);
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
  if (org.fictional)
    throw new PortalError(
      "FICTIONAL_MERCHANT_CANNOT_RECEIVE_LIVE_APPROVAL",
      409,
    );
  const app = application as {
    country?: string;
    methods?: string[];
    requirementIds?: string[];
  };
  if (
    app.country !== scope.merchantCountry ||
    scope.methods.some((m) => !app.methods?.includes(m))
  )
    throw new PortalError("SCOPE_OUTSIDE_REVIEWED_APPLICATION", 409);
  if (!app.requirementIds?.length)
    throw new PortalError("MERCHANT_REQUIREMENTS_NOT_CONFIGURED", 409);
  const requirements = await tx.requirement.findMany({
    where: { id: { in: app.requirementIds } },
  });
  if (
    requirements.length !== new Set(app.requirementIds).size ||
    requirements.some(
      (r) =>
        r.illustrative ||
        (r.scope as { audience?: string }).audience !== "merchant",
    )
  )
    throw new PortalError("REAL_MERCHANT_REQUIREMENTS_REQUIRED", 409);
  const ids = [
    ...new Set([
      ...scope.evidenceIds,
      ...scope.accounts.flatMap((a) =>
        [
          a.permissionEvidenceId,
          a.settlementDestinationEvidenceId,
          a.refundResponsibilityEvidenceId,
        ].filter((v): v is string => !!v),
      ),
    ]),
  ];
  const evidence = await tx.evidence.findMany({
    where: {
      id: { in: ids },
      orgId,
      deletedAt: null,
      scanStatus: "Clean",
      reviewStatus: "Accepted",
      retentionUntil: { gt: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  if (
    evidence.length !== ids.length ||
    evidence.some((e) => !app.requirementIds!.includes(e.requirementId)) ||
    app.requirementIds.some(
      (id) => !evidence.some((e) => e.requirementId === id),
    )
  )
    throw new PortalError("CURRENT_ACCEPTED_MERCHANT_EVIDENCE_REQUIRED", 409);
  const integrations = await tx.integration.findMany({
    where: {
      id: { in: scope.accounts.map((a) => a.integrationId) },
      orgId,
      environment: "production",
    },
  });
  for (const key of [
    scope.asset,
    ...scope.additionalAssets.map((a) => a.asset),
  ]) {
    const a = reviewedAssetParts(key);
    if (
      a.kind === "blockchain" &&
      !integrations.some((i) => {
        const c = depositConfigSchema.safeParse(i.config);
        return (
          c.success &&
          c.data.network === a.network &&
          c.data.identifier === a.identifier
        );
      })
    )
      throw new PortalError("SCOPED_CHAIN_ACCOUNT_REQUIRED", 409);
  }
  // Accounts created through a partner programme are bound only while their
  // partner application is still approved and consented.
  const partnerAccounts = await tx.partnerApplication.findMany({
    where: {
      orgId,
      environment: "production",
      state: "Approved",
      integrationId: { in: integrations.map((i) => i.id) },
    },
  });
  if (
    integrations.length !== scope.accounts.length ||
    scope.accounts.some((a) => {
      const config = integrations.find((i) => i.id === a.integrationId)
        ?.config as
        | {
            accountId?: string;
            adapter?: string;
            mode?: string;
            partnerApplicationId?: string;
          }
        | undefined;
      if (!config || config.accountId !== a.accountReference) return true;
      if (isDepositAdapter(config.adapter)) {
        const parsed = depositConfigSchema.safeParse(
          integrations.find((i) => i.id === a.integrationId)?.config,
        );
        const approved = [
          scope.asset,
          ...scope.additionalAssets.map((a) => a.asset),
        ].map(reviewedAssetParts);
        return (
          !parsed.success ||
          parsed.data.environment !== "production" ||
          !approved.some(
            (a) =>
              parsed.success &&
              parsed.data.network === a.network &&
              parsed.data.identifier === a.identifier,
          ) ||
          !a.permissionEvidenceId ||
          !a.settlementDestinationEvidenceId ||
          !a.refundResponsibilityEvidenceId
        );
      }
      if (config.mode === "PARTNER")
        return !partnerAccounts.some(
          (p) =>
            p.id === config.partnerApplicationId &&
            p.integrationId === a.integrationId &&
            p.partnerId === config.adapter,
        );
      // A previously held account needs the three pieces of uploaded evidence.
      return (
        !["paystack", "flutterwave"].includes(config.adapter || "") ||
        !a.permissionEvidenceId ||
        !a.settlementDestinationEvidenceId ||
        !a.refundResponsibilityEvidenceId
      );
    })
  )
    throw new PortalError("OWNED_PROVIDER_ACCOUNT_BINDING_REQUIRED", 409);
  const profiles = await tx.publishedProfile.findMany({
    where: {
      id: { in: scope.profileIds },
      current: true,
      orgId,
      environment: "production",
    },
  });
  const asset = reviewedAssetParts(scope.asset);
  const currency = asset.identifier;
  // Methods a bound partner account can execute cover the scope directly.
  const partnerMethods = new Set(
    partnerAccounts.flatMap((p) => {
      try {
        return [...(partnerModule(p.partnerId).manifest.paymentMethods ?? [])];
      } catch {
        return [];
      }
    }),
  );
  for (const integration of integrations) {
    const parsed = depositConfigSchema.safeParse(integration.config);
    if (
      parsed.success &&
      [scope.asset, ...scope.additionalAssets.map((a) => a.asset)].some(
        (key) => {
          const a = reviewedAssetParts(key);
          return (
            parsed.data.network === a.network &&
            parsed.data.identifier === a.identifier
          );
        },
      )
    )
      partnerMethods.add(
        onchainMethod(parsed.data.network, parsed.data.identifier),
      );
  }
  if (
    profiles.length !== scope.profileIds.length ||
    profiles.some((p) => {
      const c = capabilitySchema.safeParse(p.definition);
      return (
        !c.success ||
        !scope.accounts.some((a) => a.integrationId === p.integrationId) ||
        !scope.methods.includes(p.method as (typeof scope.methods)[number]) ||
        p.operation !== "pay-in" ||
        !scope.payerCountries.includes(p.origin) ||
        p.destination !== scope.merchantCountry ||
        p.inputAsset !== currency ||
        p.inputNetwork !== asset.network ||
        c.data.fulfillment?.settlementAsset.identifier !== currency ||
        c.data.fulfillment?.settlementAsset.kind !== asset.kind ||
        c.data.fulfillment?.settlementAsset.network !== asset.network
      );
    }) ||
    scope.methods.some(
      (m) => !profiles.some((p) => p.method === m) && !partnerMethods.has(m),
    )
  )
    throw new PortalError("EXACT_APPROVED_PROFILES_REQUIRED", 409);
  return { evidenceIds: ids, profileIds: profiles.map((p) => p.id) };
}
const commandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("propose-live-scope"),
      orgId: id,
      applicationVersion: z.number().int(),
      expectedScopeVersion: id.nullable(),
      reason: z.string().min(10).max(1000),
      input: liveScopeInput,
    })
    .strict(),
  z
    .object({
      action: z.enum(["approve-live-scope", "revoke-live-scope"]),
      orgId: id,
      version: id,
      reason: z.string().min(10).max(1000),
    })
    .strict(),
]);
export async function liveScopeCommand(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const b = commandSchema.parse(raw);
  const now = new Date();
  return atomic(async (tx) => {
    const config = await tx.merchantConfig.findUniqueOrThrow({
      where: { orgId: b.orgId },
    });
    const previous = storedLiveScope.safeParse(config.liveScope);
    let scope: z.infer<typeof storedLiveScope>;
    if (b.action === "propose-live-scope") {
      for (const method of b.input.methods) assertLaunchMethod(method);
      if (
        config.applicationVersion !== b.applicationVersion ||
        !["Under review", "Approved"].includes(config.applicationState)
      )
        throw new PortalError("APPLICATION_CONFLICT", 409);
      if (
        (previous.success ? previous.data.version : null) !==
        b.expectedScopeVersion
      )
        throw new PortalError("SCOPE_VERSION_CONFLICT", 409);
      assertReviewDate(b.input, now);
      scope = {
        status: "Proposed",
        version: randomUUID(),
        applicationVersion: config.applicationVersion,
        input: b.input,
      };
    } else {
      if (!previous.success || previous.data.version !== b.version)
        throw new PortalError("SCOPE_VERSION_CONFLICT", 409);
      if (b.action === "approve-live-scope") {
        if (
          previous.data.status !== "Proposed" ||
          previous.data.applicationVersion !== config.applicationVersion ||
          !["Under review", "Approved"].includes(config.applicationState)
        )
          throw new PortalError("APPLICATION_CONFLICT", 409);
        await validateScopeEvidence(
          tx,
          b.orgId,
          previous.data.input,
          config.application,
          now,
        );
        scope = {
          ...previous.data,
          status: "Approved",
          version: randomUUID(),
          approvedAt: now.toISOString(),
          approvedBy: actor.user.id,
        };
      } else
        scope = { ...previous.data, status: "Revoked", version: randomUUID() };
    }
    await tx.merchantConfig.update({
      where: { orgId: b.orgId },
      data: {
        liveScope: json(scope),
        ...(b.action === "approve-live-scope"
          ? { applicationState: "Approved" }
          : {}),
      },
    });
    await audit(
      tx,
      b.orgId,
      actor.user.id,
      `merchant.${b.action}`,
      b.orgId,
      { reason: b.reason, previous: config.liveScope, scope },
      true,
    );
    return {
      status: scope.status,
      version: scope.version,
      executionEnabled: false,
    };
  });
}

export function liveScopeReasons(
  raw: unknown,
  context: {
    country: string;
    method: string | null;
    asset: string;
    amount: bigint;
    dailyReserved: bigint;
    alreadyReserved: boolean;
  },
  now = new Date(),
) {
  const parsed = storedLiveScope.safeParse(raw);
  if (!parsed.success || parsed.data.status !== "Approved")
    return ["LIVE_SCOPE_NOT_APPROVED"];
  const scope = parsed.data.input;
  const reasons: string[] = [];
  if (new Date(scope.nextReviewAt) <= now)
    reasons.push("LIVE_SCOPE_REVIEW_DUE");
  if (
    context.country !== scope.merchantCountry ||
    !approvedAssetLimits(scope, context.asset) ||
    (context.method &&
      !scope.methods.includes(context.method as (typeof scope.methods)[number]))
  )
    reasons.push("OUTSIDE_APPROVED_LIVE_SCOPE");
  const limits = approvedAssetLimits(scope, context.asset);
  if (limits && context.amount > BigInt(limits.maximumMinor))
    reasons.push("LIVE_SCOPE_TRANSACTION_LIMIT");
  if (
    limits &&
    !context.alreadyReserved &&
    context.dailyReserved + context.amount > BigInt(limits.dailyMaximumMinor)
  )
    reasons.push("LIVE_SCOPE_AGGREGATE_LIMIT");
  return reasons;
}

export function approvedAssetLimits(scope: LiveScopeInput, asset: string) {
  return scope.asset === asset
    ? {
        asset: scope.asset,
        maximumMinor: scope.maximumMinor,
        dailyMaximumMinor: scope.dailyMaximumMinor,
      }
    : scope.additionalAssets.find((a) => a.asset === asset);
}
