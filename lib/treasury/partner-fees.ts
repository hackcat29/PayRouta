// The partner's standard processing fee, charged to the merchant on top of
// PayRouta's 1% (lib/payments/pricing.ts).
//
// On split-settlement rails (Paystack, Flutterwave) the partner already takes
// its fee from the merchant's share, so nothing is added here. Where PayRouta
// pays the partner itself (dLocal, Tink), the standard
// fee is configured on the platform account as `standardFees` and withheld
// (or invoiced) with PayRouta's fee, so the merchant bears it either way.
import { z } from "zod";
import { PortalError } from "../portal/domain";
import { minor } from "../payments/contracts";
import type { PlatformManifest } from "./platforms/contract";

const methodFee = z
  .object({
    // Percentage part in basis points (290 = 2.9%).
    bps: z.number().int().min(0).max(2000),
    // Fixed part per payment, in minor units of each currency it applies to.
    fixedMinor: z.record(z.string().regex(/^[A-Z]{3}$/), z.string().regex(/^\d{1,12}$/)).default({}),
    // Where the partner publishes this rate, for audit.
    source: z.string().min(1).max(300),
  })
  .strict();

export const standardFeesSchema = z.record(z.string().min(1).max(40), methodFee);
export type StandardFees = z.infer<typeof standardFeesSchema>;

// Splits `standardFees` off a platform account's stored config, leaving the
// keys the partner module itself validates.
export function splitPlatformConfig(config: unknown) {
  const { standardFees, ...rest } = (config ?? {}) as Record<string, unknown>;
  const parsed = standardFeesSchema.safeParse(standardFees ?? {});
  if (!parsed.success) throw new PortalError("PLATFORM_STANDARD_FEES_INVALID", 409);
  return { moduleConfig: rest, standardFees: parsed.data };
}

// Methods on a rail that PayRouta pays for but has no standard fee for. Such
// an account can't be enabled in production: every payment would lose money.
export function missingStandardFees(manifest: PlatformManifest, config: unknown) {
  if (manifest.merchantBearsProcessingFee) return [];
  const { standardFees } = splitPlatformConfig(config);
  return manifest.methods.filter((m) => !standardFees[m]);
}

export function standardPartnerFee(
  manifest: PlatformManifest,
  config: unknown,
  input: { method: string; amount: string; precision: number; currency: string },
) {
  if (manifest.merchantBearsProcessingFee) return 0n;
  const fee = splitPlatformConfig(config).standardFees[input.method];
  if (!fee) throw new PortalError("PARTNER_STANDARD_FEE_REQUIRED", 409);
  const gross = minor(input.amount, input.precision);
  const percent = (gross * BigInt(fee.bps) * 2n + 10000n) / 20000n;
  return percent + BigInt(fee.fixedMinor[input.currency] ?? "0");
}
