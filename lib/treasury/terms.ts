import { z } from "zod";

export const riskTiers = ["low", "standard", "elevated", "high"] as const;
export type RiskTier = (typeof riskTiers)[number];

// Higher-risk merchants always carry a rolling reserve; underwriting may set
// more, never less.
export const minimumReserveBasisPoints: Record<RiskTier, number> = {
  low: 0,
  standard: 0,
  elevated: 500,
  high: 1000,
};

const positiveMinor = z.string().regex(/^[1-9]\d{0,29}$/);

// Commercial terms fixed at underwriting. Changing them is a new transition,
// so the history shows which terms applied to which period.
export const merchantTerms = z
  .object({
    reserve: z
      .object({
        basisPoints: z.number().int().min(0).max(5000),
        holdDays: z.number().int().min(0).max(180),
      })
      .strict()
      .refine((r) => (r.basisPoints === 0) === (r.holdDays === 0), {
        message: "A reserve needs both a percentage and a hold period",
      }),
    payout: z
      .object({
        schedule: z.enum(["daily", "weekly", "monthly", "manual"]),
        delayDays: z.number().int().min(0).max(30),
      })
      .strict(),
    // "payrouta-mor" (PayRouta resells as Merchant of Record) is phase 5.
    taxMode: z.enum(["merchant-seller", "payrouta-mor"]),
    limits: z
      .object({
        currency: z.string().regex(/^[A-Z]{3}$/),
        maximumMinor: positiveMinor,
        dailyMaximumMinor: positiveMinor,
      })
      .strict()
      .refine((l) => BigInt(l.maximumMinor) <= BigInt(l.dailyMaximumMinor), {
        message: "A single payment cannot exceed the daily limit",
      }),
  })
  .strict();
export type MerchantTerms = z.infer<typeof merchantTerms>;

export function termsBlockers(tier: RiskTier, terms: MerchantTerms) {
  const blockers: string[] = [];
  if (terms.taxMode === "payrouta-mor") blockers.push("MOR_NOT_AVAILABLE");
  if (terms.reserve.basisPoints < minimumReserveBasisPoints[tier])
    blockers.push("RESERVE_BELOW_TIER_MINIMUM");
  return blockers;
}
