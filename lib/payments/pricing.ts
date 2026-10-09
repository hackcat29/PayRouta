import { z } from "zod";
import { PortalError } from "../portal/domain";
import { assetKey, minor } from "./contracts";

export const pricingVersion = "launch-2026-10-v1";
export const highFeeMethods = ["card", "digital-wallet", "bnpl"] as const;
export const lowFeeMethods = [
  "bank-transfer",
  "direct-debit",
  "ussd",
  "mobile-money",
  "stablecoin",
  "crypto-app",
] as const;
const positiveInteger = z.string().regex(/^[1-9]\d{0,39}$/);
export const feeScheduleSchema = z
  .object({
    version: z.string().min(1).max(80),
    asset: z.string().min(1).max(200),
    inputPrecision: z.number().int().min(0).max(18),
    currency: z.string().regex(/^[A-Z]{3}$/),
    billingPrecision: z.number().int().min(0).max(3),
    highCapMinor: positiveInteger,
    lowCapMinor: positiveInteger,
    highBps: z.number().int().min(0).max(25).default(25),
    lowBps: z.number().int().min(0).max(10).default(10),
    conversionNumerator: z
      .string()
      .regex(/^[1-9]\d{0,95}$/)
      .default("1"),
    conversionDenominator: z
      .string()
      .regex(/^[1-9]\d{0,95}$/)
      .default("1"),
    validUntil: z.iso.datetime().optional(),
    valuationReference: z.string().min(1).max(200).optional(),
    orgId: z.string().min(1).max(100).optional(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.billingPrecision !==
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: s.currency,
      }).resolvedOptions().maximumFractionDigits
    )
      ctx.addIssue({
        code: "custom",
        message: "Billing precision must match the currency minor unit",
      });
    const same =
      s.asset === `fiat:${s.currency}:` &&
      s.inputPrecision === s.billingPrecision;
    if (
      same &&
      (s.conversionNumerator !== "1" || s.conversionDenominator !== "1")
    )
      ctx.addIssue({
        code: "custom",
        message: "Same-currency pricing must use an identity conversion",
      });
    if (!same && (!s.validUntil || !s.valuationReference))
      ctx.addIssue({
        code: "custom",
        message:
          "Cross-asset pricing requires an expiring, evidenced valuation",
      });
  });
export type FeeSchedule = z.infer<typeof feeScheduleSchema>;
export const feeSnapshotSchema = z
  .object({
    version: z.literal(pricingVersion),
    free: z.boolean(),
    schedule: feeScheduleSchema.nullable(),
  })
  .strict();
export function configuredSchedules(raw = process.env.PAYMENT_FEE_SCHEDULES) {
  const schedules = z
    .array(feeScheduleSchema)
    .max(500)
    .parse(raw ? JSON.parse(raw) : []);
  const keys = schedules.map((s) => `${s.orgId ?? "*"}:${s.asset}`);
  if (new Set(keys).size !== keys.length)
    throw new PortalError("DUPLICATE_FEE_SCHEDULE", 409);
  return schedules;
}
export function snapshotFees(
  input: {
    orgId: string;
    environment: string;
    asset: { kind: string; identifier: string; network: string };
    precision: number;
  },
  now = new Date(),
  raw = process.env.PAYMENT_FEE_SCHEDULES,
) {
  if (input.environment === "sandbox")
    return { version: pricingVersion, free: true, schedule: null };
  if (input.environment !== "production")
    throw new PortalError("INVALID_FEE_ENVIRONMENT");
  const key = assetKey(input.asset);
  const schedules = configuredSchedules(raw);
  const selected =
    schedules.find((s) => s.asset === key && s.orgId === input.orgId) ??
    schedules.find((s) => s.asset === key && !s.orgId);
  const schedule =
    selected ??
    (key === "fiat:USD:"
      ? feeScheduleSchema.parse({
          version: pricingVersion,
          asset: key,
          inputPrecision: 2,
          currency: "USD",
          billingPrecision: 2,
          highCapMinor: "200",
          lowCapMinor: "100",
        })
      : null);
  if (!schedule || schedule.inputPrecision !== input.precision)
    throw new PortalError("PAYMENT_FEE_SCHEDULE_REQUIRED", 409);
  // Valuation must cover the entire checkout lifetime; confirmation uses this immutable quote.
  if (
    schedule.validUntil &&
    new Date(schedule.validUntil).getTime() < now.getTime() + 30 * 60000
  )
    throw new PortalError("PAYMENT_FEE_VALUATION_EXPIRED", 409);
  return { version: pricingVersion, free: false, schedule };
}
export function calculateFee(
  snapshot: unknown,
  method: string,
  amount: string,
  precision: number,
) {
  const terms = feeSnapshotSchema.parse(snapshot);
  const high = (highFeeMethods as readonly string[]).includes(method);
  if (!high && !(lowFeeMethods as readonly string[]).includes(method))
    throw new PortalError("UNPRICED_PAYMENT_METHOD", 409);
  const gross = minor(amount, precision);
  if (gross <= 0n) throw new PortalError("INVALID_AMOUNT");
  if (terms.free)
    return {
      amountMinor: "0",
      currency: "",
      precision: 0,
      bps: 0,
      capMinor: "0",
      version: pricingVersion,
    };
  const s = terms.schedule;
  if (!s || s.inputPrecision !== precision)
    throw new PortalError("INVALID_FEE_SNAPSHOT", 409);
  const bps = high ? s.highBps : s.lowBps;
  const cap = BigInt(high ? s.highCapMinor : s.lowCapMinor);
  // One half-up rounding after conversion and percentage, with no floating point or minimum fee.
  const numerator = gross * BigInt(s.conversionNumerator) * BigInt(bps);
  const denominator = BigInt(s.conversionDenominator) * 10000n;
  const rounded = (numerator * 2n + denominator) / (denominator * 2n);
  return {
    amountMinor: (rounded > cap ? cap : rounded).toString(),
    currency: s.currency,
    precision: s.billingPrecision,
    bps,
    capMinor: cap.toString(),
    version: s.version,
  };
}
export function formatFee(amount: string, precision: number) {
  const text = BigInt(amount)
    .toString()
    .padStart(precision + 1, "0");
  return precision
    ? `${text.slice(0, -precision)}.${text.slice(-precision)}`
    : text;
}
