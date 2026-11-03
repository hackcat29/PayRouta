// Subscription billing arithmetic, kept pure so it can be tested on its own:
// billing periods from a fixed anchor (so 31 January renews on 28 or 29
// February, then 31 March), and invoice lines from a plan's price and the
// usage recorded in the period that closed. Amounts are exact: decimal
// strings in, integer minor units in between, decimal strings out.
import { z } from "zod";
import { currencyExponent } from "../partners/money";
import { fiatPaymentMethodIds } from "../providers/normalized";
import { PortalError } from "../portal/domain";

export const intervals = ["day", "week", "month", "year"] as const;
export type Interval = (typeof intervals)[number];

// Days a customer has to pay an invoice before the subscription is past due.
export const graceDays = 7;

const decimal = (max: number) => z.string().trim().regex(new RegExp(`^(0|[1-9]\\d{0,12})(\\.\\d{1,${max}})?$`), "INVALID_AMOUNT");

export const meterInput = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/, "INVALID_METER_KEY").describe("e.g. api_calls"),
    name: z.string().trim().min(1).max(60).describe("Shown on invoices, e.g. API calls"),
    unitAmount: decimal(8).describe('Price per unit, e.g. "0.002"'),
    includedUnits: decimal(6).default("0").describe("Units each period includes before charging"),
  })
  .strict();
export type Meter = z.infer<typeof meterInput>;

export const planInput = z
  .object({
    name: z.string().trim().min(1).max(80),
    amount: decimal(8).describe('Charged at the start of each period; "0" for usage only'),
    currency: z.string().regex(/^[A-Z]{3}$/),
    interval: z.enum(intervals),
    intervalCount: z.number().int().min(1).max(12).default(1),
    meters: z.array(meterInput).max(10).default([]),
    methods: z.array(z.enum(fiatPaymentMethodIds)).max(fiatPaymentMethodIds.length).default([]),
    crypto: z.boolean().default(false).describe("Accept stablecoins and any token (USD plans)"),
  })
  .strict()
  .refine((p) => p.methods.length || p.crypto, "Offer at least one way to pay")
  .refine((p) => new Set(p.meters.map((m) => m.key)).size === p.meters.length, "Duplicate meter key")
  .refine((p) => p.amount !== "0" || p.meters.length, "A plan needs a price, a meter or both");
export type PlanInput = z.infer<typeof planInput>;

export const usageInput = z
  .object({
    meter: z.string().trim().regex(/^[a-z][a-z0-9_]{0,39}$/),
    quantity: decimal(6),
    occurredAt: z.iso.datetime().optional(),
    idempotencyKey: z.string().regex(/^[\w.:-]{8,120}$/).optional(),
  })
  .strict();

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

// The end of period `index` (0-based) for a subscription anchored at `anchor`.
export function periodEnd(anchor: Date, interval: Interval, count: number, index: number) {
  const steps = (index + 1) * count;
  if (interval === "day") return new Date(anchor.getTime() + steps * 86400000);
  if (interval === "week") return new Date(anchor.getTime() + steps * 7 * 86400000);
  const months = interval === "year" ? steps * 12 : steps;
  const y = anchor.getUTCFullYear() + Math.floor((anchor.getUTCMonth() + months) / 12);
  const m = (anchor.getUTCMonth() + months) % 12;
  const d = Math.min(anchor.getUTCDate(), daysInMonth(y, m));
  return new Date(Date.UTC(y, m, d, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds(), anchor.getUTCMilliseconds()));
}

// Which period (0-based) ends at `end`.
export function periodIndex(anchor: Date, interval: Interval, count: number, end: Date) {
  for (let i = 0; i < 10000; i++) if (periodEnd(anchor, interval, count, i).getTime() >= end.getTime()) return i;
  throw new PortalError("SUBSCRIPTION_PERIOD_OUT_OF_RANGE", 409);
}

// "12.5" with scale 6 → 12500000n.
function scaled(value: string, scale: number) {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) throw new PortalError("INVALID_AMOUNT", 400);
  return BigInt(whole + fraction.padEnd(scale, "0"));
}

export function exponentOf(currency: string) {
  const exp = currencyExponent(currency);
  if (exp === null || exp === undefined) throw new PortalError("UNSUPPORTED_CURRENCY", 409);
  return exp;
}

// Decimal amount → minor units, rounding half up.
export function toMinor(amount: string, currency: string) {
  const exp = exponentOf(currency);
  const value = scaled(amount, 8);
  const divisor = 10n ** BigInt(8 - exp);
  return (value + divisor / 2n) / divisor;
}

export function fromMinor(minor: bigint, currency: string) {
  const exp = exponentOf(currency);
  const s = minor.toString().padStart(exp + 1, "0");
  return exp ? `${s.slice(0, -exp)}.${s.slice(-exp)}` : s;
}

const quantityText = (q: bigint) => {
  const s = q.toString().padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`.replace(/\.?0+$/, "");
};

export type InvoiceLine = { description: string; quantity: string; unitAmount: string; amount: string };

// The lines of one invoice: the plan's price for the period starting now
// (when there is one) and each meter's billable usage in the period that
// just closed.
export function invoiceLines(
  plan: { name: string; amount: string; currency: string; meters: Meter[] },
  usage: { meter: string; quantity: string }[],
  options: { base: boolean },
) {
  const lines: InvoiceLine[] = [];
  let total = 0n;
  if (options.base && plan.amount !== "0" && toMinor(plan.amount, plan.currency) > 0n) {
    const minor = toMinor(plan.amount, plan.currency);
    lines.push({ description: plan.name, quantity: "1", unitAmount: plan.amount, amount: fromMinor(minor, plan.currency) });
    total += minor;
  }
  const exp = BigInt(exponentOf(plan.currency));
  for (const meter of plan.meters) {
    const used = usage.filter((u) => u.meter === meter.key).reduce((sum, u) => sum + scaled(u.quantity, 6), 0n);
    const billable = used - scaled(meter.includedUnits, 6);
    if (billable <= 0n) continue;
    // quantity (1e6) × unit price (1e8) = 1e14; to minor units, half up.
    const product = billable * scaled(meter.unitAmount, 8);
    const divisor = 10n ** (14n - exp);
    const minor = (product + divisor / 2n) / divisor;
    lines.push({
      description: meter.name,
      quantity: quantityText(billable),
      unitAmount: meter.unitAmount,
      amount: fromMinor(minor, plan.currency),
    });
    total += minor;
  }
  return { lines, totalMinor: total, total: fromMinor(total, plan.currency) };
}

export const subscriptionInput = z
  .object({
    plan: z.string().min(1).max(100),
    customer: z
      .object({
        email: z.email().max(200),
        name: z.string().trim().min(1).max(120).optional(),
        reference: z.string().trim().min(1).max(100).optional(),
      })
      .strict(),
    metadata: z
      .record(z.string().max(40), z.string().max(200))
      .refine((v) => Object.keys(v).length <= 20)
      .default({}),
  })
  .strict();
export const cancelInput = z.object({ atPeriodEnd: z.boolean().default(false) }).strict();

const wireMeter = z.object({ key: z.string(), name: z.string(), unitAmount: z.string(), includedUnits: z.string() }).strict();
export const wirePlan = z
  .object({
    id: z.string(),
    name: z.string(),
    amount: z.string(),
    currency: z.string(),
    interval: z.enum(intervals),
    intervalCount: z.number().int(),
    meters: z.array(wireMeter),
    methods: z.array(z.string()),
    crypto: z.boolean(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const wireInvoice = z
  .object({
    id: z.string(),
    number: z.number().int(),
    amount: z.string(),
    currency: z.string(),
    state: z.enum(["Open", "Paid", "Void"]),
    lines: z.array(z.object({ description: z.string(), quantity: z.string(), unitAmount: z.string(), amount: z.string() }).strict()),
    periodStart: z.iso.datetime(),
    periodEnd: z.iso.datetime(),
    dueAt: z.iso.datetime(),
    paidAt: z.iso.datetime().nullable(),
    paymentId: z.string().nullable(),
    url: z.string(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const wireSubscription = z
  .object({
    id: z.string(),
    state: z.enum(["Incomplete", "Active", "PastDue", "Canceled"]),
    plan: z
      .object({ id: z.string(), name: z.string(), amount: z.string(), currency: z.string(), interval: z.string(), intervalCount: z.number().int() })
      .strict(),
    customer: z.object({ id: z.string(), email: z.string(), name: z.string().nullable(), reference: z.string().nullable() }).strict(),
    currentPeriodStart: z.iso.datetime(),
    currentPeriodEnd: z.iso.datetime(),
    cancelAtPeriodEnd: z.boolean(),
    canceledAt: z.iso.datetime().nullable(),
    metadata: z.record(z.string(), z.string()),
    latestInvoice: wireInvoice.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const wireSubscriptionDetail = wireSubscription
  .extend({
    invoices: z.array(wireInvoice),
    usageThisPeriod: z.array(z.object({ meter: z.string(), name: z.string(), quantity: z.string(), records: z.number().int() }).strict()),
  })
  .strict();
export const wireUsage = z
  .object({ id: z.string(), meter: z.string(), quantity: z.string(), occurredAt: z.iso.datetime(), idempotencyKey: z.string() })
  .strict();
