import {
  storedLiveScope,
  validateScopeEvidence,
  scopeReviewCurrent,
} from "../merchant/live-scope";
import { assetKey, minor } from "../payments/contracts";
import { rolloutPermits, rolloutSchema } from "../merchant/rollout";
import { assessEvidence } from "./evidence-policy";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../generated/prisma/client";
import { db } from "./db";
import { atomic, audit, json } from "./service";
import { sandboxSimulation } from "./adapters";
import { CapabilityDefinition, PortalError } from "./domain";
import {
  evaluateAvailability,
  trustedContextSchema,
  TrustedContext,
  Candidate,
} from "./availability-engine";
import { fingerprint, SubmissionSnapshot } from "./registry";

export async function createTrustedContext(
  orgId: string,
  value: unknown,
  actorId: string,
  now = new Date(),
) {
  const context = trustedContextSchema.parse(value);
  if (
    context.merchantId !== orgId ||
    new Date(context.validUntil).getTime() <= now.getTime() ||
    new Date(context.validUntil).getTime() > now.getTime() + 3600000
  )
    throw new PortalError("CONTEXT_SCOPE_OR_EXPIRY_INVALID");
  return atomic(async (tx) => {
    await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
    const record = await tx.availabilityContext.create({
      data: {
        orgId,
        environment: context.environment,
        policyVersion: context.policyVersion,
        context: json(context),
        expiresAt: new Date(context.validUntil),
        createdAt: now,
      },
    });
    await audit(
      tx,
      orgId,
      actorId,
      "Trusted availability context created",
      record.id,
      {
        environment: context.environment,
        policyVersion: context.policyVersion,
      },
      true,
    );
    return { contextId: record.id };
  });
}
async function loadEvaluation(
  tx: Prisma.TransactionClient,
  context: TrustedContext,
  evaluationId: string,
  now: Date,
) {
  // Indexed method/environment discovery deliberately retains nonmatching corridors/assets for explanations.
  const profiles = await tx.publishedProfile.findMany({
    where: {
      ...(context.providerAllowlist
        ? { orgId: { in: context.providerAllowlist } }
        : {}),
      environment: context.environment,
      current: true,
      method: { in: context.methods },
    },
    orderBy: { id: "asc" },
    take: 501,
  });
  if (profiles.length > 500)
    throw new PortalError("EVALUATION_BUDGET_EXCEEDED", 503);
  const merchant =
    context.environment === "production"
      ? await tx.merchantConfig.findUnique({
          where: { orgId: context.merchantId },
        })
      : null;
  const liveScope = storedLiveScope.safeParse(merchant?.liveScope);
  let liveScopeValid = context.environment === "sandbox";
  if (
    context.environment === "production" &&
    merchant &&
    liveScope.success &&
    scopeReviewCurrent(merchant.liveScope, now)
  ) {
    try {
      await validateScopeEvidence(
        tx,
        merchant.orgId,
        liveScope.data.input,
        merchant.application,
        now,
      );
      liveScopeValid = true;
    } catch (error) {
      if (!(error instanceof PortalError)) throw error;
    }
  }
  const orgIds = [...new Set(profiles.map((p) => p.orgId))];
  const [activations, withdrawals, snapshots, observations] = await Promise.all(
    [
      tx.activation.findMany({
        where: { orgId: { in: orgIds }, environment: context.environment },
        orderBy: { sequence: "desc" },
        distinct: ["orgId"],
      }),
      tx.activation.findMany({
        where: {
          orgId: { in: orgIds },
          environment: context.environment,
          action: "withdraw",
        },
        orderBy: { sequence: "desc" },
        distinct: ["orgId"],
      }),
      tx.registrySnapshot.findMany({
        where: {
          key: { in: [...new Set(profiles.map((p) => p.publicationKey))] },
        },
      }),
      // Latest record per exact trust/type/configuration scope, retaining stale records as stale evidence.
      tx.$queryRaw<Awaited<ReturnType<typeof tx.availability.findMany>>>`
      SELECT DISTINCT ON ("integrationId", "capabilityId", "capabilityVersion", "observationType", trust) *
      FROM "Availability" WHERE environment = ${context.environment}
      AND "integrationId" = ANY(${[...new Set(profiles.map((p) => p.integrationId))]}::text[])
      AND "observationType" IS NOT NULL
      ORDER BY "integrationId", "capabilityId", "capabilityVersion", "observationType", trust, sequence DESC, "observedAt" DESC LIMIT 10001`,
    ],
  );
  if (observations.length > 10000)
    throw new PortalError("EVALUATION_BUDGET_EXCEEDED", 503);
  const [organizations, evidenceRows] = await Promise.all([
    tx.organization.findMany({
      where: { id: { in: orgIds } },
      select: { id: true, fictional: true },
    }),
    tx.evidence.findMany({
      where: {
        orgId: { in: orgIds },
        deletedAt: null,
        id: {
          in: [
            ...snapshots.flatMap((s) =>
              (s.snapshot as unknown as SubmissionSnapshot).evidence.map(
                (e) => e.id,
              ),
            ),
            ...profiles.flatMap((p) => {
              const r = rolloutSchema.safeParse(p.rollout);
              return r.success ? r.data.evidenceIds : [];
            }),
          ],
        },
      },
    }),
  ]);
  const evidence = new Map<
    string,
    { valid: boolean; fictional: boolean; expiresAt: number }
  >();
  for (const snapshot of snapshots) {
    const content = snapshot.snapshot as unknown as SubmissionSnapshot;
    const fictional =
      organizations.find((o) => o.id === snapshot.orgId)?.fictional ?? true;
    const rows = evidenceRows.filter(
      (e) =>
        e.orgId === snapshot.orgId &&
        content.evidence.some((ref) => ref.id === e.id),
    );
    const fixture =
      context.environment === "sandbox" && sandboxSimulation() && fictional;
    evidence.set(snapshot.key, {
      ...assessEvidence(content.requirements, rows, fixture, now),
      fictional,
    });
  }
  const candidates: Candidate[] = profiles.map((p) => {
    const latest = activations.find((a) => a.orgId === p.orgId);
    const e = evidence.get(p.publicationKey);
    const withinMerchantScope =
      context.environment === "sandbox" ||
      (liveScopeValid &&
        liveScope.success &&
        liveScope.data.input.profileIds.includes(p.id) &&
        liveScope.data.input.merchantCountry === context.merchantCountry &&
        context.payerCountry !== null &&
        liveScope.data.input.payerCountries.some(
          (country) => country === context.payerCountry,
        ) &&
        liveScope.data.input.methods.some((method) => method === p.method) &&
        assetKey(context.input) === liveScope.data.input.asset &&
        assetKey(context.settlement) === liveScope.data.input.settlementAsset &&
        minor(context.amount, context.precision) <=
          BigInt(liveScope.data.input.maximumMinor));
    const rollout = rolloutSchema.safeParse(p.rollout);
    const qualificationEvidenceCurrent = !rollout.success
      ? Object.keys(p.rollout as object).length === 0
      : rollout.data.evidenceIds.every((id) =>
          evidenceRows.some(
            (row) =>
              row.id === id &&
              row.orgId === p.orgId &&
              row.scanStatus === "Clean" &&
              row.reviewStatus === "Accepted" &&
              row.retentionUntil > now &&
              (!row.expiresAt || row.expiresAt > now),
          ),
        );
    // A pending replacement retains the live version; any newer withdrawal blocks immediately.
    return {
      ...p,
      definition: p.definition as unknown as CapabilityDefinition,
      active: !!latest && latest.action === "publish",
      restricted:
        !withinMerchantScope ||
        !rolloutPermits(p.rollout, context, now) ||
        !qualificationEvidenceCurrent ||
        (withdrawals.find((a) => a.orgId === p.orgId)?.sequence ?? 0) >
          p.revision,
      evidenceValid: !!e?.valid,
      fictional: e?.fictional ?? true,
      evidenceExpiresAt: Math.min(
        e?.expiresAt ?? now.getTime(),
        rollout.success && rollout.data.nextReviewAt
          ? new Date(rollout.data.nextReviewAt).getTime()
          : Infinity,
        ...(rollout.success
          ? rollout.data.evidenceIds.map((id) => {
              const row = evidenceRows.find(
                (e) => e.id === id && e.orgId === p.orgId,
              );
              return row
                ? Math.min(
                    row.expiresAt?.getTime() ?? Infinity,
                    row.retentionUntil.getTime(),
                  )
                : now.getTime();
            })
          : []),
      ),
    };
  });
  return evaluateAvailability({
    evaluationId,
    context,
    candidates,
    observations,
    now,
  });
}
export async function evaluateContext(
  orgId: string,
  contextId: string,
  now = new Date(),
) {
  const id = randomUUID();
  const start = performance.now();
  const result = await atomic(async (tx) => {
    const record = await tx.availabilityContext.findFirst({
      where: { id: contextId, orgId },
    });
    if (!record) throw new PortalError("CONTEXT_NOT_FOUND", 404);
    if (record.expiresAt <= now) throw new PortalError("CONTEXT_EXPIRED", 409);
    const context = trustedContextSchema.parse(record.context);
    const evaluation = await loadEvaluation(tx, context, id, now);
    await tx.availabilityEvaluation.create({
      data: {
        id,
        contextId,
        orgId,
        environment: context.environment,
        policyVersion: context.policyVersion,
        contextFingerprint: fingerprint(context),
        safe: json(evaluation.safe),
        trace: json(evaluation.internal),
        expiresAt: new Date(evaluation.safe.expiresAt),
        retentionUntil: new Date(now.getTime() + 7 * 86400000),
        createdAt: now,
      },
    });
    return evaluation;
  });
  console.info(
    JSON.stringify({
      event: "availability.evaluated",
      correlationId: id,
      latencyMs: Math.round(performance.now() - start),
      candidates: result.internal.candidates.length,
      outcomes: result.safe.methods.map((m) => m.status),
      exclusions: result.internal.candidates.flatMap((c) =>
        c.reasons.map((r) => r.code),
      ),
    }),
  );
  return result.safe;
}
export async function explainEvaluation(
  orgId: string,
  evaluationId: string,
  internal = false,
  now = new Date(),
) {
  const result = await db.availabilityEvaluation.findFirst({
    where: { id: evaluationId, orgId, retentionUntil: { gt: now } },
  });
  if (!result) throw new PortalError("EVALUATION_NOT_FOUND", 404);
  return internal ? { safe: result.safe, trace: result.trace } : result.safe;
}
// Interface for future routing. It does not select a provider or execute a payment.
export async function revalidateSelectedMethod(
  orgId: string,
  contextId: string,
  evaluationId: string,
  method: string,
  now = new Date(),
) {
  return atomic(async (tx) => {
    const [evaluation, record] = await Promise.all([
      tx.availabilityEvaluation.findFirst({
        where: { id: evaluationId, orgId, contextId },
      }),
      tx.availabilityContext.findFirst({ where: { id: contextId, orgId } }),
    ]);
    if (
      !evaluation ||
      !record ||
      evaluation.expiresAt <= now ||
      record.expiresAt <= now
    )
      throw new PortalError("EVALUATION_EXPIRED_OR_MISMATCHED", 409);
    const context = trustedContextSchema.parse(record.context);
    if (
      evaluation.contextFingerprint !== fingerprint(context) ||
      evaluation.environment !== context.environment ||
      evaluation.policyVersion !== context.policyVersion
    )
      throw new PortalError("EVALUATION_EXPIRED_OR_MISMATCHED", 409);
    const prior = evaluation.safe as {
      methods: { method: string; status: string }[];
    };
    if (
      !prior.methods.some(
        (m) => m.method === method && m.status === "AVAILABLE",
      )
    )
      throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
    const current = await loadEvaluation(tx, context, evaluation.id, now);
    if (
      !current.safe.methods.some(
        (m) => m.method === method && m.status === "AVAILABLE",
      )
    )
      throw new PortalError("SELECTED_METHOD_NO_LONGER_AVAILABLE", 409);
    return {
      method,
      candidateIds: current.internal.candidates
        .filter((c) => c.method === method && c.status === "AVAILABLE")
        .map((c) => c.id),
      requiresExecutionPrerequisiteCheck: true,
    };
  });
}
