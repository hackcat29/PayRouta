import { z } from "zod";
import { minor } from "../payments/contracts";
export const rolloutSchema = z
  .object({
    stage: z.enum([
      "Candidate",
      "Sandbox qualified",
      "Pilot enabled",
      "Limited live",
      "Generally enabled",
      "Paused",
    ]),
    merchantAllowlist: z.array(z.string().max(100)).max(1000).default([]),
    maximumMinor: z.string().regex(/^[1-9]\d{0,29}$/),
    evidenceIds: z.array(z.string().max(100)).max(50),
    version: z.string().max(100),
    nextReviewAt: z.iso.datetime().optional(),
    qualificationKind: z
      .enum(["simulator", "provider-sandbox", "live-pilot"])
      .optional(),
    proofs: z
      .array(
        z
          .object({ gate: z.string().max(50), evidenceId: z.string().max(100) })
          .strict(),
      )
      .max(9)
      .optional(),
    sandboxRunIds: z.array(z.string().max(100)).max(20).optional(),
  })
  .strict();
export function rolloutPermits(
  raw: unknown,
  context: {
    environment: string;
    merchantId: string;
    amount: string;
    precision: number;
  },
  now = new Date(),
) {
  if (
    context.environment === "sandbox" &&
    raw &&
    typeof raw === "object" &&
    Object.keys(raw).length === 0
  )
    return true;
  const parsed = rolloutSchema.safeParse(raw);
  if (!parsed.success) return false;
  const policy = parsed.data;
  if (policy.nextReviewAt && new Date(policy.nextReviewAt) <= now) return false;
  if (policy.stage === "Paused" || policy.stage === "Candidate") return false;
  if (context.environment === "sandbox")
    return (
      policy.stage === "Sandbox qualified" &&
      minor(context.amount, context.precision) <= BigInt(policy.maximumMinor)
    );
  if (
    !["Pilot enabled", "Limited live", "Generally enabled"].includes(
      policy.stage,
    )
  )
    return false;
  if (!policy.evidenceIds.length) return false;
  if (
    policy.stage !== "Generally enabled" &&
    !policy.merchantAllowlist.includes(context.merchantId)
  )
    return false;
  return (
    minor(context.amount, context.precision) <= BigInt(policy.maximumMinor)
  );
}
