import { z } from "zod";
import { PortalError } from "../portal/domain";
import { assetKey, minor } from "./contracts";

// PayRouta's fee on each successful payment (docs/PLATFORM-BILLING.md).
//
// v2 (from 2026-10-09):
//   partner methods  1%   where a licensed partner processes the payment;
//                         the partner's standard processing fee is charged
//                         on top (lib/treasury/partner-fees.ts)
//   direct methods   1.5% where PayRouta is the only processor (stablecoins
//                         and native crypto); there is no partner fee
// v1 ("launch-2026-10-v1"): 0.25% / 0.10% with per-payment caps. Snapshots
// saved under v1 stay valid and are always calculated with v1 rules, so
// existing payments are never repriced.
export const pricingVersion = "2026-10-v2";
export const legacyPricingVersion = "launch-2026-10-v1";

export const partnerMethods = [
  "card",
  "digital-wallet",
  "bnpl",
  "bank-transfer",
  "direct-debit",
  "ussd",
  "mobile-money",
] as const;
export const directMethods = ["stablecoin", "crypto-app"] as const;
export const defaultPartnerBps = 100;
export const defaultDirectBps = 150;

// PayRouta's partner-method fee is capped at $5 per payment. There is no FX
// feed for fiat, so each currency has a fixed cap set at or just under $5;
// review them when rates move, and add currencies here (or in
// PAYMENT_FEE_CAPS, e.g. {"CAD":"650"}) before taking payments in them.
// A fiat currency without a cap needs an explicit PAYMENT_FEE_SCHEDULES entry.
export const defaultPartnerCaps: Record<string, string> = {
  USD: "500", // $5.00
  EUR: "450", // €4.50
  GBP: "380", // £3.80
  NGN: "750000", // ₦7,500
  GHS: "5000", // GH₵50
  KES: "64000", // KSh 640
  ZAR: "8500", // R85
  XOF: "2800", // CFA 2,800 (no minor unit)
  BRL: "2500", // R$25
  MXN: "9000", // MX$90
  CAD: "650", // C$6.50
  AUD: "750", // A$7.50
  CHF: "400", // CHF 4
  SEK: "4800", // SEK 48
  JPY: "700", // ¥700 (no minor unit)
  INR: "40000", // ₹400
  PHP: "27500", // ₱275
  SGD: "600", // S$6
  AED: "1800", // AED 18
  COP: "2000000", // COL$20,000
};

const legacyHighMethods = ["card", "digital-wallet", "bnpl"] as const;
const legacyLowMethods = [
  "bank-transfer",
  "direct-debit",
  "ussd",
  "mobile-money",
  "stablecoin",
  "crypto-app",
] as const;

const positiveInteger = z.string().regex(/^[1-9]\d{0,39}$/);

const isoCurrencies = new Set(Intl.supportedValuesOf("currency"));

// Minor units of a real ISO 4217 currency; undefined for unknown codes
// (Intl formats any well-formed code, so check the supported list first).
export function currencyMinorUnits(currency: string) {
  if (!isoCurrencies.has(currency)) return undefined;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions()
      .maximumFractionDigits;
  } catch {
    return undefined;
  }
}

// Fields shared by v1 and v2 schedules: which asset is priced, in which
// billing currency, and the evidenced conversion between them.
const valuation = {
  version: z.string().min(1).max(80),
  asset: z.string().min(1).max(200),
  inputPrecision: z.number().int().min(0).max(18),
  currency: z.string().regex(/^[A-Z]{3}$/),
  billingPrecision: z.number().int().min(0).max(3),
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
};

function checkValuation(
  s: {
    asset: string;
    currency: string;
    inputPrecision: number;
    billingPrecision: number;
    conversionNumerator: string;
    conversionDenominator: string;
    validUntil?: string;
    valuationReference?: string;
  },
  ctx: z.RefinementCtx,
) {
  if (s.billingPrecision !== currencyMinorUnits(s.currency))
    ctx.addIssue({ code: "custom", message: "Billing precision must match the currency minor unit" });
  const same = s.asset === `fiat:${s.currency}:` && s.inputPrecision === s.billingPrecision;
  if (same && (s.conversionNumerator !== "1" || s.conversionDenominator !== "1"))
    ctx.addIssue({ code: "custom", message: "Same-currency pricing must use an identity conversion" });
  if (!same && (!s.validUntil || !s.valuationReference))
    ctx.addIssue({ code: "custom", message: "Cross-asset pricing requires an expiring, evidenced valuation" });
}

// Rates may be negotiated down per merchant (orgId) or capped per payment;
// the 10% ceiling only guards against configuration typos.
export const feeScheduleSchema = z
  .object({
    ...valuation,
    partnerBps: z.number().int().min(0).max(1000).default(defaultPartnerBps),
    directBps: z.number().int().min(0).max(1000).default(defaultDirectBps),
    partnerCapMinor: positiveInteger.optional(),
    directCapMinor: positiveInteger.optional(),
  })
  .strict()
  .superRefine(checkValuation);
export type FeeSchedule = z.infer<typeof feeScheduleSchema>;

const legacyScheduleSchema = z
  .object({
    ...valuation,
    highCapMinor: positiveInteger,
    lowCapMinor: positiveInteger,
    highBps: z.number().int().min(0).max(25).default(25),
    lowBps: z.number().int().min(0).max(10).default(10),
  })
  .strict()
  .superRefine(checkValuation);

export const feeSnapshotSchema = z.union([
  z
    .object({
      version: z.literal(pricingVersion),
      free: z.boolean(),
      schedule: feeScheduleSchema.nullable(),
    })
    .strict(),
  z
    .object({
      version: z.literal(legacyPricingVersion),
      free: z.boolean(),
      schedule: legacyScheduleSchema.nullable(),
    })
    .strict(),
]);
export type FeeSnapshot = z.infer<typeof feeSnapshotSchema>;

export function configuredSchedules(raw = process.env.PAYMENT_FEE_SCHEDULES) {
  const schedules = z
    .array(feeScheduleSchema)
    .max(500)
    .parse(raw ? JSON.parse(raw) : []);
  const keys = schedules.map((s) => `${s.orgId ?? "*"}:${s.asset}`);
  if (new Set(keys).size !== keys.length) throw new PortalError("DUPLICATE_FEE_SCHEDULE", 409);
  return schedules;
}

export function partnerCaps(raw = process.env.PAYMENT_FEE_CAPS) {
  const extra = z
    .record(z.string().regex(/^[A-Z]{3}$/), positiveInteger)
    .parse(raw ? JSON.parse(raw) : {});
  return { ...defaultPartnerCaps, ...extra };
}

// Standard terms for a fiat currency with a known cap: the fee is a
// percentage of the payment, billed in the same currency, so no valuation is
// needed.
function defaultFiatSchedule(key: string, precision: number, caps: Record<string, string>) {
  const currency = /^fiat:([A-Z]{3}):$/.exec(key)?.[1];
  if (!currency || currencyMinorUnits(currency) !== precision || !caps[currency]) return null;
  return feeScheduleSchema.parse({
    version: pricingVersion,
    asset: key,
    inputPrecision: precision,
    currency,
    billingPrecision: precision,
    partnerCapMinor: caps[currency],
  });
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
): FeeSnapshot {
  if (input.environment === "sandbox") return { version: pricingVersion, free: true, schedule: null };
  if (input.environment !== "production") throw new PortalError("INVALID_FEE_ENVIRONMENT");
  const key = assetKey(input.asset);
  const schedules = configuredSchedules(raw);
  const caps = partnerCaps();
  const configured =
    schedules.find((s) => s.asset === key && s.orgId === input.orgId) ??
    schedules.find((s) => s.asset === key && !s.orgId);
  // Negotiated terms can lower the cap, never lift it above the published $5.
  const published = configured && caps[configured.currency];
  const schedule = configured
    ? published &&
      (!configured.partnerCapMinor || BigInt(configured.partnerCapMinor) > BigInt(published))
      ? { ...configured, partnerCapMinor: published }
      : configured
    : defaultFiatSchedule(key, input.precision, caps);
  if (!schedule || schedule.inputPrecision !== input.precision)
    throw new PortalError("PAYMENT_FEE_SCHEDULE_REQUIRED", 409);
  // Valuation must cover the entire checkout lifetime; confirmation uses this immutable quote.
  if (schedule.validUntil && new Date(schedule.validUntil).getTime() < now.getTime() + 30 * 60000)
    throw new PortalError("PAYMENT_FEE_VALUATION_EXPIRED", 409);
  return { version: pricingVersion, free: false, schedule };
}

// Half-up rounding once, after conversion and percentage: no floating point
// and no minimum fee.
function percentage(gross: bigint, bps: number, s: { conversionNumerator: string; conversionDenominator: string }) {
  const numerator = gross * BigInt(s.conversionNumerator) * BigInt(bps);
  const denominator = BigInt(s.conversionDenominator) * 10000n;
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export function calculateFee(snapshot: unknown, method: string, amount: string, precision: number) {
  const terms = feeSnapshotSchema.parse(snapshot);
  const known = [...partnerMethods, ...directMethods] as readonly string[];
  if (!known.includes(method)) throw new PortalError("UNPRICED_PAYMENT_METHOD", 409);
  const gross = minor(amount, precision);
  if (gross <= 0n) throw new PortalError("INVALID_AMOUNT");
  const direct = (directMethods as readonly string[]).includes(method);
  if (terms.free)
    return {
      amountMinor: "0",
      currency: "",
      precision: 0,
      bps: 0,
      capMinor: "",
      partnerFeeApplies: !direct,
      version: terms.version,
    };
  const s = terms.schedule;
  if (!s || s.inputPrecision !== precision) throw new PortalError("INVALID_FEE_SNAPSHOT", 409);

  let bps: number;
  let cap: string | undefined;
  if (terms.version === legacyPricingVersion) {
    const legacy = s as z.infer<typeof legacyScheduleSchema>;
    const high = (legacyHighMethods as readonly string[]).includes(method);
    if (!high && !(legacyLowMethods as readonly string[]).includes(method))
      throw new PortalError("UNPRICED_PAYMENT_METHOD", 409);
    bps = high ? legacy.highBps : legacy.lowBps;
    cap = high ? legacy.highCapMinor : legacy.lowCapMinor;
  } else {
    const current = s as FeeSchedule;
    bps = direct ? current.directBps : current.partnerBps;
    cap = direct ? current.directCapMinor : current.partnerCapMinor;
  }
  const fee = percentage(gross, bps, s);
  const capped = cap !== undefined && fee > BigInt(cap) ? BigInt(cap) : fee;
  return {
    amountMinor: capped.toString(),
    currency: s.currency,
    precision: s.billingPrecision,
    bps,
    capMinor: cap ?? "",
    // v1 terms predate partner pass-through, so they never add a partner fee.
    partnerFeeApplies: !direct && terms.version === pricingVersion,
    version: s.version,
  };
}

// PayRouta's fee on a stablecoin or crypto payment in the payment's own token
// (minor units), for taking it at source: the same rate and cap as
// calculateFee, before conversion to the billing currency. 0 when free.
export function directFeeInAsset(snapshot: unknown, method: string, amount: string, precision: number) {
  const terms = feeSnapshotSchema.parse(snapshot);
  if (terms.free || terms.version !== pricingVersion || !(directMethods as readonly string[]).includes(method)) return 0n;
  const s = terms.schedule as FeeSchedule | null;
  if (!s || s.inputPrecision !== precision) throw new PortalError("INVALID_FEE_SNAPSHOT", 409);
  const gross = minor(amount, precision);
  const fee = (gross * BigInt(s.directBps) * 2n + 10000n) / 20000n;
  // The cap is in billing units; convert it back into the token, rounding down.
  const cap = s.directCapMinor ? (BigInt(s.directCapMinor) * BigInt(s.conversionDenominator)) / BigInt(s.conversionNumerator) : undefined;
  return cap !== undefined && fee > cap ? cap : fee;
}

export function formatFee(amount: string, precision: number) {
  const text = BigInt(amount)
    .toString()
    .padStart(precision + 1, "0");
  return precision ? `${text.slice(0, -precision)}.${text.slice(-precision)}` : text;
}
