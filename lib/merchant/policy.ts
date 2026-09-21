import { z } from "zod";
import { assetKey, minor } from "../payments/contracts";
import { exception } from "../payments/journal";
import type { Tx } from "../payments/service";
import type { PaymentIntent } from "../generated/prisma/client";
const integer = z.string().regex(/^(0|[1-9]\d{0,29})$/);
export const riskPolicySchema = z
  .object({
    version: z.string().min(1).max(100).default("merchant-risk-v1"),
    paused: z.boolean().default(false),
    blockedMethods: z.array(z.string().max(40)).max(10).default([]),
    evidenceIds: z.array(z.string().max(100)).max(30).default([]),
    limits: z
      .array(
        z
          .object({
            asset: z.string().max(100),
            maximum: integer,
            dailyMaximum: integer,
            reviewAbove: integer.optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
  })
  .strict();
export type RiskPolicy = z.infer<typeof riskPolicySchema>;
export function riskOutcome(
  policy: RiskPolicy,
  input: {
    environment: string;
    asset: string;
    amount: bigint;
    method: string | null;
    evidenceCurrent: boolean;
    dailyReserved: bigint;
    alreadyReserved: boolean;
  },
): { decision: "Allow" | "Deny" | "Hold for review"; reasons: string[] } {
  const reasons: string[] = [];
  if (policy.paused) reasons.push("MERCHANT_PAUSED");
  if (input.method && policy.blockedMethods.includes(input.method))
    reasons.push("METHOD_RESTRICTED");
  // Production execution is closed elsewhere too. Policy cannot manufacture live approval.
  if (input.environment !== "sandbox")
    reasons.push("LIVE_QUALIFICATION_REQUIRED");
  if (!input.evidenceCurrent) reasons.push("EVIDENCE_REVIEW_REQUIRED");
  const limit = policy.limits.find((l) => l.asset === input.asset);
  if (policy.limits.length && !limit) reasons.push("ASSET_NOT_APPROVED");
  if (limit && input.amount > BigInt(limit.maximum))
    reasons.push("TRANSACTION_LIMIT");
  if (
    limit &&
    !input.alreadyReserved &&
    input.dailyReserved + input.amount > BigInt(limit.dailyMaximum)
  )
    reasons.push("AGGREGATE_LIMIT");
  if (reasons.length) return { decision: "Deny" as const, reasons };
  if (limit?.reviewAbove && input.amount > BigInt(limit.reviewAbove))
    return { decision: "Hold for review" as const, reasons: ["AMOUNT_REVIEW"] };
  return { decision: "Allow" as const, reasons: [] };
}
// Call inside the same serializable transaction that creates/claims an attempt.
// Reservations count unique intents and remain conservative after failed attempts.
export async function enforceRisk(
  tx: Tx,
  intent: PaymentIntent,
  now: Date,
  reserve: boolean,
) {
  const config = await tx.merchantConfig.findUniqueOrThrow({
    where: { orgId: intent.orgId },
  });
  const policy = riskPolicySchema.parse(config.riskPolicy);
  const asset = assetKey(
    intent.asset as { kind: string; identifier: string; network: string },
  );
  const day = now.toISOString().slice(0, 10);
  const prior = await tx.merchantReservation.findUnique({
    where: { intentId: intent.id },
  });
  const aggregate = await tx.merchantReservation.aggregate({
    where: { orgId: intent.orgId, environment: intent.environment, asset, day },
    _sum: { amount: true },
  });
  const evidence = await tx.evidence.findMany({
    where: {
      id: { in: policy.evidenceIds },
      orgId: intent.orgId,
      deletedAt: null,
      scanStatus: "Clean",
      reviewStatus: "Accepted",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  let outcome = riskOutcome(policy, {
    environment: intent.environment,
    asset,
    amount: minor(intent.amount, intent.precision),
    method: intent.selectedMethod,
    evidenceCurrent: evidence.length === new Set(policy.evidenceIds).size,
    dailyReserved: BigInt(aggregate._sum.amount?.toFixed(0) || "0"),
    alreadyReserved: !!prior,
  });
  if (outcome.decision === "Hold for review") {
    const approval = await tx.merchantRiskDecision.findFirst({
      where: {
        intentId: intent.id,
        policyVersion: policy.version,
        decision: "Review approved",
        expiresAt: { gt: now },
      },
    });
    if (approval) {
      outcome = {
        decision: "Allow",
        reasons: ["TIME_BOUNDED_REVIEW_APPROVAL"],
      };
    }
  }
  await tx.merchantRiskDecision.create({
    data: {
      intentId: intent.id,
      policyVersion: policy.version,
      decision: outcome.decision,
      reasons: outcome.reasons,
      expiresAt: new Date(now.getTime() + 5 * 60000),
    },
  });
  if (outcome.decision !== "Allow") {
    await exception(
      tx,
      intent.id,
      "MERCHANT_POLICY_REVIEW",
      {
        policyVersion: policy.version,
        decision: outcome.decision,
        reasons: outcome.reasons,
      },
      now,
    );
    return outcome;
  }
  if (reserve && !prior)
    await tx.merchantReservation.create({
      data: {
        intentId: intent.id,
        orgId: intent.orgId,
        environment: intent.environment,
        asset,
        day,
        amount: minor(intent.amount, intent.precision).toString(),
      },
    });
  return outcome;
}
