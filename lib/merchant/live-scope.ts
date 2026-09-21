import { randomUUID } from "node:crypto";
import { z } from "zod";
import { internal } from "../portal/access";
import { atomic, audit, json } from "../portal/service";
import { PortalError, capabilitySchema } from "../portal/domain";
import type { Tx } from "../payments/service";

const id = z.string().min(1).max(200);
const positiveMinor = z.string().regex(/^[1-9]\d{0,29}$/);
// Initial live review is deliberately limited to the requested Nigeria/NGN scope.
// Adding a market or rail requires a schema + qualification change, not a wildcard.
export const liveScopeInput = z
  .object({
    environment: z.literal("production"),
    merchantCountry: z.literal("NG"),
    payerCountries: z.array(z.literal("NG")).length(1),
    methods: z
      .array(z.enum(["bank-transfer", "card"]))
      .min(1)
      .max(2),
    asset: z.literal("fiat:NGN:"),
    settlementAsset: z.literal("fiat:NGN:"),
    maximumMinor: positiveMinor,
    dailyMaximumMinor: positiveMinor,
    profileIds: z.array(id).min(1).max(10),
    accounts: z
      .array(
        z
          .object({
            integrationId: id,
            accountReference: id,
            permissionEvidenceId: id,
            settlementDestinationEvidenceId: id,
            refundResponsibilityEvidenceId: id,
          })
          .strict(),
      )
      .min(1)
      .max(4),
    evidenceIds: z.array(id).min(1).max(30),
    nextReviewAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (BigInt(value.maximumMinor) > BigInt(value.dailyMaximumMinor))
      ctx.addIssue({
        code: "custom",
        path: ["dailyMaximumMinor"],
        message: "Daily limit must cover one transaction",
      });
    for (const [field, values] of [
      ["profileIds", value.profileIds],
      ["methods", value.methods],
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
      ...scope.accounts.flatMap((a) => [
        a.permissionEvidenceId,
        a.settlementDestinationEvidenceId,
        a.refundResponsibilityEvidenceId,
      ]),
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
  if (
    integrations.length !== scope.accounts.length ||
    scope.accounts.some((a) => {
      const config = integrations.find((i) => i.id === a.integrationId)
        ?.config as { accountId?: string; adapter?: string } | undefined;
      return (
        !config ||
        config.accountId !== a.accountReference ||
        !["paystack", "flutterwave"].includes(config.adapter || "")
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
  if (
    profiles.length !== scope.profileIds.length ||
    profiles.some((p) => {
      const c = capabilitySchema.safeParse(p.definition);
      return (
        !c.success ||
        !scope.accounts.some((a) => a.integrationId === p.integrationId) ||
        !scope.methods.includes(p.method as "card" | "bank-transfer") ||
        p.operation !== "pay-in" ||
        p.origin !== "NG" ||
        p.destination !== "NG" ||
        p.inputAsset !== "NGN" ||
        p.inputNetwork !== "" ||
        c.data.fulfillment?.settlementAsset.identifier !== "NGN" ||
        c.data.fulfillment?.settlementAsset.kind !== "fiat"
      );
    }) ||
    scope.methods.some((m) => !profiles.some((p) => p.method === m))
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
    context.asset !== scope.asset ||
    (context.method &&
      !scope.methods.includes(context.method as "card" | "bank-transfer"))
  )
    reasons.push("OUTSIDE_APPROVED_LIVE_SCOPE");
  if (context.amount > BigInt(scope.maximumMinor))
    reasons.push("LIVE_SCOPE_TRANSACTION_LIMIT");
  if (
    !context.alreadyReserved &&
    context.dailyReserved + context.amount > BigInt(scope.dailyMaximumMinor)
  )
    reasons.push("LIVE_SCOPE_AGGREGATE_LIMIT");
  return reasons;
}
