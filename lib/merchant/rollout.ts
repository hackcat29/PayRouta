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
  if (policy.stage === "Paused" || policy.stage === "Candidate") return false;
  if (context.environment === "sandbox")
    return policy.stage === "Sandbox qualified";
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
