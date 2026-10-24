// Global Subscriptions, Millisecond Usage Metering & Smart Payday Dunning Engine.
//
// 1. Subscription & Proration State Machine:
//    Multi-currency recurring plans with exact UTC millisecond proration across
//    seat changes, mid-cycle upgrades/downgrades, trials, and pause/resume.
// 2. Timezone-Agnostic Event Ingestion & Metering Engine:
//    High-throughput idempotent usage ingestion with UTC epoch millisecond
//    normalization, clock-drift tracking, watermarks, and graduated/volume tier pricing.
// 3. Global Smart Dunning & Regional Payday Syncing:
//    Adapts retry schedules to failure semantics and regional economic payday
//    calendars (e.g. 25th–last business day in NG/ZA/KE/GH/DE/JP, 15th & last
//    business day in US/CA/BR/MX, and immediate exponential cascade for transient
//    network errors).
import { createHash, randomUUID } from "node:crypto";
import { currencyExponent, fromMinorUnits } from "../partners/money";
import { PortalError } from "../portal/domain";

export type BillingInterval = "weekly" | "monthly" | "quarterly" | "annual";
export type SubscriptionState =
  | "Trialing"
  | "Active"
  | "PastDueRetrying"
  | "PastDueActionRequired"
  | "Paused"
  | "Canceled";

export type SubscriptionPlan = {
  planId: string;
  name: string;
  currency: string;
  interval: BillingInterval;
  unitAmountMinor: string;
  includedUnits?: string;
};

export type SubscriptionRecord = {
  subscriptionId: string;
  orgId: string;
  customerId: string;
  customerCountry: string;
  plan: SubscriptionPlan;
  quantity: number;
  state: SubscriptionState;
  currentPeriodStartMs: number;
  currentPeriodEndMs: number;
  trialEndMs: number | null;
  cancelAtPeriodEnd: boolean;
  canceledAtMs: number | null;
  pausedAtMs: number | null;
  dunningAttemptCount: number;
  nextRetryAtMs: number | null;
  version: number;
};

export type ProrationLineItem = {
  type: "UNUSED_TIME_CREDIT" | "REMAINING_TIME_CHARGE";
  description: string;
  planId: string;
  quantity: number;
  windowStartMs: number;
  windowEndMs: number;
  durationMs: number;
  amountMinor: string;
};

export type ProrationResult = {
  currency: string;
  exponent: number;
  periodStartMs: number;
  periodEndMs: number;
  changeAtMs: number;
  totalPeriodMs: number;
  remainingPeriodMs: number;
  remainingRatioScaled: string; // scaled by 1e9
  unusedCreditMinor: string;
  newChargeMinor: string;
  netAdjustmentMinor: string; // positive = charge customer, negative = credit balance
  formattedNetAdjustment: string;
  lines: ProrationLineItem[];
};

function formatMinorWithSign(minor: bigint, currency: string): string {
  const exp = currencyExponent(currency) ?? 2;
  const sign = minor < 0n ? "-" : "";
  const abs = minor < 0n ? -minor : minor;
  const formatted = fromMinorUnits(abs, currency);
  if (formatted !== null) return `${sign}${formatted}`;
  if (exp === 0) return `${sign}${abs.toString()}`;
  const s = abs.toString().padStart(exp + 1, "0");
  return `${sign}${s.slice(0, -exp)}.${s.slice(-exp)}`;
}

export function advanceBillingPeriodMs(startMs: number, interval: BillingInterval): number {
  const d = new Date(startMs);
  if (interval === "weekly") {
    return startMs + 7 * 86_400_000;
  }
  const monthsToAdd = interval === "monthly" ? 1 : interval === "quarterly" ? 3 : 12;
  const next = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + monthsToAdd,
      d.getUTCDate(),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
  return next.getTime();
}

export function createSubscription(input: {
  orgId: string;
  customerId: string;
  customerCountry: string;
  plan: SubscriptionPlan;
  quantity?: number;
  trialDays?: number;
  nowMs?: number;
}): SubscriptionRecord {
  const nowMs = input.nowMs ?? Date.now();
  const quantity = input.quantity ?? 1;
  if (quantity <= 0 || !Number.isInteger(quantity)) {
    throw new PortalError("INVALID_SUBSCRIPTION_QUANTITY", 400);
  }
  if (BigInt(input.plan.unitAmountMinor) < 0n) {
    throw new PortalError("INVALID_PLAN_AMOUNT", 400);
  }
  const hasTrial = (input.trialDays ?? 0) > 0;
  const trialEndMs = hasTrial ? nowMs + input.trialDays! * 86_400_000 : null;
  const currentPeriodEndMs = trialEndMs ?? advanceBillingPeriodMs(nowMs, input.plan.interval);

  return {
    subscriptionId: `sub_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
    orgId: input.orgId,
    customerId: input.customerId,
    customerCountry: input.customerCountry.trim().toUpperCase(),
    plan: input.plan,
    quantity,
    state: hasTrial ? "Trialing" : "Active",
    currentPeriodStartMs: nowMs,
    currentPeriodEndMs,
    trialEndMs,
    cancelAtPeriodEnd: false,
    canceledAtMs: null,
    pausedAtMs: null,
    dunningAttemptCount: 0,
    nextRetryAtMs: null,
    version: 1,
  };
}

// Calculates exact UTC millisecond-precision proration for mid-cycle seat changes
// or plan upgrades/downgrades.
export function calculateMillisecondProration(input: {
  currentPlan: SubscriptionPlan;
  currentQuantity: number;
  newPlan: SubscriptionPlan;
  newQuantity: number;
  periodStartMs: number;
  periodEndMs: number;
  changeAtMs: number;
}): ProrationResult {
  if (input.currentPlan.currency !== input.newPlan.currency) {
    throw new PortalError("PRORATION_CURRENCY_MISMATCH_USE_FX_SPLICE", 409);
  }
  if (input.periodEndMs <= input.periodStartMs) {
    throw new PortalError("INVALID_BILLING_PERIOD_WINDOW", 400);
  }
  if (input.changeAtMs < input.periodStartMs || input.changeAtMs > input.periodEndMs) {
    throw new PortalError("PRORATION_TIMESTAMP_OUTSIDE_PERIOD", 400);
  }
  if (input.currentQuantity < 0 || input.newQuantity < 0) {
    throw new PortalError("INVALID_PRORATION_QUANTITY", 400);
  }

  const currency = input.currentPlan.currency.toUpperCase();
  const exponent = currencyExponent(currency) ?? 2;
  const totalPeriodMs = BigInt(input.periodEndMs - input.periodStartMs);
  const remainingPeriodMs = BigInt(input.periodEndMs - input.changeAtMs);

  const oldFullMinor = BigInt(input.currentPlan.unitAmountMinor) * BigInt(input.currentQuantity);
  const newFullMinor = BigInt(input.newPlan.unitAmountMinor) * BigInt(input.newQuantity);

  // Unused credit on current plan (rounded half-up to nearest minor unit)
  const unusedNum = oldFullMinor * remainingPeriodMs;
  const unusedCreditMinor =
    (unusedNum / totalPeriodMs) + ((unusedNum % totalPeriodMs) * 2n >= totalPeriodMs ? 1n : 0n);

  // Remaining charge on new plan (rounded half-up to nearest minor unit)
  const newNum = newFullMinor * remainingPeriodMs;
  const newChargeMinor =
    (newNum / totalPeriodMs) + ((newNum % totalPeriodMs) * 2n >= totalPeriodMs ? 1n : 0n);

  const netAdjustmentMinor = newChargeMinor - unusedCreditMinor;
  const remainingRatioScaled = (remainingPeriodMs * 1_000_000_000n) / totalPeriodMs;

  return {
    currency,
    exponent,
    periodStartMs: input.periodStartMs,
    periodEndMs: input.periodEndMs,
    changeAtMs: input.changeAtMs,
    totalPeriodMs: Number(totalPeriodMs),
    remainingPeriodMs: Number(remainingPeriodMs),
    remainingRatioScaled: remainingRatioScaled.toString(),
    unusedCreditMinor: unusedCreditMinor.toString(),
    newChargeMinor: newChargeMinor.toString(),
    netAdjustmentMinor: netAdjustmentMinor.toString(),
    formattedNetAdjustment: formatMinorWithSign(netAdjustmentMinor, currency),
    lines: [
      {
        type: "UNUSED_TIME_CREDIT",
        description: `Unused time on ${input.currentPlan.name} (qty ${input.currentQuantity})`,
        planId: input.currentPlan.planId,
        quantity: input.currentQuantity,
        windowStartMs: input.changeAtMs,
        windowEndMs: input.periodEndMs,
        durationMs: Number(remainingPeriodMs),
        amountMinor: (-unusedCreditMinor).toString(),
      },
      {
        type: "REMAINING_TIME_CHARGE",
        description: `Remaining time on ${input.newPlan.name} (qty ${input.newQuantity})`,
        planId: input.newPlan.planId,
        quantity: input.newQuantity,
        windowStartMs: input.changeAtMs,
        windowEndMs: input.periodEndMs,
        durationMs: Number(remainingPeriodMs),
        amountMinor: newChargeMinor.toString(),
      },
    ],
  };
}

export function changeSubscriptionPlan(
  sub: SubscriptionRecord,
  newPlan: SubscriptionPlan,
  newQuantity: number,
  changeAtMs: number,
): { subscription: SubscriptionRecord; proration: ProrationResult } {
  if (sub.state === "Canceled" || sub.state === "Paused") {
    throw new PortalError(`CANNOT_CHANGE_PLAN_IN_STATE:${sub.state}`, 409);
  }
  const proration = calculateMillisecondProration({
    currentPlan: sub.plan,
    currentQuantity: sub.quantity,
    newPlan,
    newQuantity,
    periodStartMs: sub.currentPeriodStartMs,
    periodEndMs: sub.currentPeriodEndMs,
    changeAtMs,
  });
  return {
    subscription: {
      ...sub,
      plan: newPlan,
      quantity: newQuantity,
      version: sub.version + 1,
    },
    proration,
  };
}

// ============================================================================
// 2. Timezone-Agnostic Millisecond Usage Metering Engine
// ============================================================================

export type UsageEventInput = {
  idempotencyKey: string;
  subscriptionId: string;
  metric: string;
  // Accepts bigint/number/string quantity (e.g. API calls, compute ms, GB-seconds, tokens)
  quantity: bigint | number | string;
  // Accepts ISO-8601 string with any regional offset (e.g. "2026-10-24T18:00:00+09:00"),
  // Date object, or UTC epoch milliseconds.
  occurredAt: string | Date | number;
  dimensionKey?: string;
  region?: string;
};

export type NormalizedUsageEvent = {
  eventId: string;
  idempotencyKey: string;
  subscriptionId: string;
  metric: string;
  quantity: bigint;
  occurredAtEpochMs: number;
  occurredAtUtcIso: string;
  ingestedAtEpochMs: number;
  clockDriftMs: number;
  dimensionKey?: string;
  region: string;
};

export type MeterAggregationMode = "sum" | "max" | "unique" | "last";

export type PricingTier = {
  // Upper bound of units in this bracket (null = infinity / unbounded top tier)
  upToUnits: bigint | number | string | null;
  unitPriceMinor: bigint | number | string;
  flatFeeMinor?: bigint | number | string;
};

export type MeterPricingRules =
  | {
      model: "flat-per-unit";
      currency: string;
      unitPriceMinor: bigint | number | string;
      includedUnits?: bigint | number | string;
    }
  | {
      model: "package";
      currency: string;
      packageSizeUnits: bigint | number | string;
      packagePriceMinor: bigint | number | string;
      includedUnits?: bigint | number | string;
    }
  | {
      model: "tiered-graduated" | "tiered-volume";
      currency: string;
      tiers: PricingTier[];
      includedUnits?: bigint | number | string;
    };

export type MeteredTierBreakdown = {
  tierIndex: number;
  fromUnits: string;
  toUnits: string | null;
  billedUnits: string;
  unitPriceMinor: string;
  flatFeeMinor: string;
  tierAmountMinor: string;
};

export type MeteredBillingSummary = {
  subscriptionId: string;
  metric: string;
  aggregationMode: MeterAggregationMode;
  windowStartMs: number;
  windowEndMs: number;
  windowStartUtcIso: string;
  windowEndUtcIso: string;
  eventCount: number;
  deduplicatedCount: number;
  lateEventsRejectedCount: number;
  rawTotalUnits: string;
  includedUnits: string;
  billableUnits: string;
  currency: string;
  amountMinor: string;
  formattedAmount: string;
  tierBreakdown: MeteredTierBreakdown[];
  watermarkDigest: string;
};

export function normalizeTimestampToUtcMs(value: string | Date | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new PortalError("INVALID_USAGE_TIMESTAMP", 400);
    }
    return Math.trunc(value);
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isNaN(ms)) throw new PortalError("INVALID_USAGE_TIMESTAMP", 400);
    return ms;
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new PortalError(`INVALID_USAGE_TIMESTAMP:${value}`, 400);
  }
  return ms;
}

export class UsageMeterStream {
  private readonly seenKeys = new Map<string, NormalizedUsageEvent>();
  private readonly eventsBySubMetric = new Map<string, NormalizedUsageEvent[]>();
  private duplicateDrops = 0;

  ingestBatch(
    events: readonly UsageEventInput[],
    ingestedAtMs = Date.now(),
  ): { accepted: number; duplicatesSkipped: number; normalized: NormalizedUsageEvent[] } {
    let accepted = 0;
    let duplicatesSkipped = 0;
    const normalized: NormalizedUsageEvent[] = [];

    for (const raw of events) {
      if (!raw.idempotencyKey || !raw.subscriptionId || !raw.metric) {
        throw new PortalError("INVALID_USAGE_EVENT_SCHEMA", 400);
      }
      const dedupKey = `${raw.subscriptionId}:${raw.idempotencyKey}`;
      if (this.seenKeys.has(dedupKey)) {
        duplicatesSkipped += 1;
        this.duplicateDrops += 1;
        continue;
      }
      const quantity = BigInt(raw.quantity);
      if (quantity < 0n) {
        throw new PortalError("NEGATIVE_USAGE_QUANTITY", 400);
      }
      const occurredAtEpochMs = normalizeTimestampToUtcMs(raw.occurredAt);
      const event: NormalizedUsageEvent = {
        eventId: `evt_${createHash("sha256").update(dedupKey).digest("hex").slice(0, 18)}`,
        idempotencyKey: raw.idempotencyKey,
        subscriptionId: raw.subscriptionId,
        metric: raw.metric,
        quantity,
        occurredAtEpochMs,
        occurredAtUtcIso: new Date(occurredAtEpochMs).toISOString(),
        ingestedAtEpochMs: ingestedAtMs,
        clockDriftMs: ingestedAtMs - occurredAtEpochMs,
        ...(raw.dimensionKey ? { dimensionKey: raw.dimensionKey } : {}),
        region: raw.region ?? "global",
      };
      this.seenKeys.set(dedupKey, event);
      const bucketKey = `${raw.subscriptionId}::${raw.metric}`;
      const list = this.eventsBySubMetric.get(bucketKey) ?? [];
      list.push(event);
      this.eventsBySubMetric.set(bucketKey, list);
      normalized.push(event);
      accepted += 1;
    }

    return { accepted, duplicatesSkipped, normalized };
  }

  aggregateWindow(input: {
    subscriptionId: string;
    metric: string;
    windowStartMs: number;
    windowEndMs: number;
    aggregationMode?: MeterAggregationMode;
    pricing: MeterPricingRules;
    watermarkGraceMs?: number;
  }): MeteredBillingSummary {
    if (input.windowEndMs <= input.windowStartMs) {
      throw new PortalError("INVALID_METERING_WINDOW", 400);
    }
    const mode: MeterAggregationMode = input.aggregationMode ?? "sum";
    const bucketKey = `${input.subscriptionId}::${input.metric}`;
    const allEvents = this.eventsBySubMetric.get(bucketKey) ?? [];
    const maxIngestAllowedMs =
      input.watermarkGraceMs !== undefined
        ? input.windowEndMs + input.watermarkGraceMs
        : Number.MAX_SAFE_INTEGER;

    const matching: NormalizedUsageEvent[] = [];
    let lateEventsRejectedCount = 0;

    for (const ev of allEvents) {
      if (ev.occurredAtEpochMs >= input.windowStartMs && ev.occurredAtEpochMs < input.windowEndMs) {
        if (ev.ingestedAtEpochMs > maxIngestAllowedMs) {
          lateEventsRejectedCount += 1;
          continue;
        }
        matching.push(ev);
      }
    }

    // Deterministic ordering by UTC millisecond timestamp, then eventId
    matching.sort((a, b) =>
      a.occurredAtEpochMs !== b.occurredAtEpochMs
        ? a.occurredAtEpochMs - b.occurredAtEpochMs
        : a.eventId.localeCompare(b.eventId),
    );

    let rawTotalUnits = 0n;
    if (mode === "sum") {
      for (const ev of matching) rawTotalUnits += ev.quantity;
    } else if (mode === "max") {
      for (const ev of matching) {
        if (ev.quantity > rawTotalUnits) rawTotalUnits = ev.quantity;
      }
    } else if (mode === "unique") {
      const uniqueDims = new Set(matching.map((e) => e.dimensionKey ?? e.idempotencyKey));
      rawTotalUnits = BigInt(uniqueDims.size);
    } else if (mode === "last") {
      rawTotalUnits = matching.length ? matching[matching.length - 1]!.quantity : 0n;
    }

    const includedUnits = BigInt(input.pricing.includedUnits ?? 0);
    const billableUnits = rawTotalUnits > includedUnits ? rawTotalUnits - includedUnits : 0n;
    const currency = input.pricing.currency.toUpperCase();
    const { amountMinor, tierBreakdown } = priceMeteredUnits(billableUnits, input.pricing);

    const watermarkDigest = createHash("sha256")
      .update(
        `${input.subscriptionId}:${input.metric}:${input.windowStartMs}:${input.windowEndMs}:${matching.map((m) => m.eventId).join(",")}`,
      )
      .digest("hex")
      .slice(0, 24);

    return {
      subscriptionId: input.subscriptionId,
      metric: input.metric,
      aggregationMode: mode,
      windowStartMs: input.windowStartMs,
      windowEndMs: input.windowEndMs,
      windowStartUtcIso: new Date(input.windowStartMs).toISOString(),
      windowEndUtcIso: new Date(input.windowEndMs).toISOString(),
      eventCount: matching.length,
      deduplicatedCount: this.duplicateDrops,
      lateEventsRejectedCount,
      rawTotalUnits: rawTotalUnits.toString(),
      includedUnits: includedUnits.toString(),
      billableUnits: billableUnits.toString(),
      currency,
      amountMinor: amountMinor.toString(),
      formattedAmount: formatMinorWithSign(amountMinor, currency),
      tierBreakdown,
      watermarkDigest,
    };
  }
}

export function priceMeteredUnits(
  billableUnits: bigint,
  pricing: MeterPricingRules,
): { amountMinor: bigint; tierBreakdown: MeteredTierBreakdown[] } {
  if (billableUnits <= 0n) {
    return { amountMinor: 0n, tierBreakdown: [] };
  }

  if (pricing.model === "flat-per-unit") {
    const unitPrice = BigInt(pricing.unitPriceMinor);
    const total = billableUnits * unitPrice;
    return {
      amountMinor: total,
      tierBreakdown: [
        {
          tierIndex: 0,
          fromUnits: "0",
          toUnits: null,
          billedUnits: billableUnits.toString(),
          unitPriceMinor: unitPrice.toString(),
          flatFeeMinor: "0",
          tierAmountMinor: total.toString(),
        },
      ],
    };
  }

  if (pricing.model === "package") {
    const pkgSize = BigInt(pricing.packageSizeUnits);
    if (pkgSize <= 0n) throw new PortalError("INVALID_PACKAGE_SIZE", 400);
    const pkgPrice = BigInt(pricing.packagePriceMinor);
    const packages = (billableUnits + pkgSize - 1n) / pkgSize;
    const total = packages * pkgPrice;
    return {
      amountMinor: total,
      tierBreakdown: [
        {
          tierIndex: 0,
          fromUnits: "0",
          toUnits: (packages * pkgSize).toString(),
          billedUnits: billableUnits.toString(),
          unitPriceMinor: pkgPrice.toString(),
          flatFeeMinor: "0",
          tierAmountMinor: total.toString(),
        },
      ],
    };
  }

  if (pricing.model === "tiered-volume") {
    let selectedIndex = pricing.tiers.length - 1;
    let prevBound = 0n;
    for (let i = 0; i < pricing.tiers.length; i++) {
      const t = pricing.tiers[i]!;
      if (t.upToUnits === null || BigInt(t.upToUnits) >= billableUnits) {
        selectedIndex = i;
        break;
      }
      prevBound = BigInt(t.upToUnits);
    }
    const chosen = pricing.tiers[selectedIndex]!;
    const unitPrice = BigInt(chosen.unitPriceMinor);
    const flatFee = BigInt(chosen.flatFeeMinor ?? 0);
    const total = billableUnits * unitPrice + flatFee;
    return {
      amountMinor: total,
      tierBreakdown: [
        {
          tierIndex: selectedIndex,
          fromUnits: prevBound.toString(),
          toUnits: chosen.upToUnits !== null ? BigInt(chosen.upToUnits).toString() : null,
          billedUnits: billableUnits.toString(),
          unitPriceMinor: unitPrice.toString(),
          flatFeeMinor: flatFee.toString(),
          tierAmountMinor: total.toString(),
        },
      ],
    };
  }

  // tiered-graduated
  let remaining = billableUnits;
  let lowerBound = 0n;
  let totalAmount = 0n;
  const breakdown: MeteredTierBreakdown[] = [];

  for (let i = 0; i < pricing.tiers.length; i++) {
    if (remaining <= 0n) break;
    const tier = pricing.tiers[i]!;
    const upperBound = tier.upToUnits !== null ? BigInt(tier.upToUnits) : null;
    const bracketCapacity = upperBound !== null ? upperBound - lowerBound : remaining;
    if (bracketCapacity <= 0n) {
      throw new PortalError("INVALID_GRADUATED_TIER_BOUNDS", 400);
    }
    const unitsInTier = remaining < bracketCapacity ? remaining : bracketCapacity;
    const unitPrice = BigInt(tier.unitPriceMinor);
    const flatFee = unitsInTier > 0n ? BigInt(tier.flatFeeMinor ?? 0) : 0n;
    const tierCost = unitsInTier * unitPrice + flatFee;

    totalAmount += tierCost;
    breakdown.push({
      tierIndex: i,
      fromUnits: lowerBound.toString(),
      toUnits: upperBound !== null ? upperBound.toString() : null,
      billedUnits: unitsInTier.toString(),
      unitPriceMinor: unitPrice.toString(),
      flatFeeMinor: flatFee.toString(),
      tierAmountMinor: tierCost.toString(),
    });

    remaining -= unitsInTier;
    if (upperBound !== null) lowerBound = upperBound;
  }

  return { amountMinor: totalAmount, tierBreakdown: breakdown };
}

// ============================================================================
// 3. Global Smart Dunning & Regional Payday-Synced Retry Engine
// ============================================================================

export type DeclineCategory =
  | "TRANSIENT_NETWORK"
  | "INSUFFICIENT_FUNDS"
  | "SOFT_ISSUER_DECLINE"
  | "EXPIRED_OR_REPLACED_CARD"
  | "HARD_PERMANENT_DECLINE";

export type DunningStrategy =
  | "IMMEDIATE_EXPONENTIAL_CASCADE"
  | "REGIONAL_PAYDAY_SYNC"
  | "COOLING_OFF_RETRY"
  | "ACCOUNT_UPDATER_AND_CUSTOMER_NOTIFY"
  | "HALT_HARD_DECLINE";

export type PaydayCalendarPattern =
  | "MONTHLY_25TH_TO_MONTH_END"
  | "MONTHLY_25TH_STRICT"
  | "MONTHLY_LAST_WORKING_DAY"
  | "SEMI_MONTHLY_15TH_AND_MONTH_END";

export type SmartDunningDecision = {
  declineCode: string;
  category: DeclineCategory;
  strategy: DunningStrategy;
  shouldRetry: boolean;
  cascadeToSecondaryAcquirer: boolean;
  triggerNetworkAccountUpdater: boolean;
  notifyCustomerForPaymentUpdate: boolean;
  nextSubscriptionState: SubscriptionState;
  nextRetryAtMs: number | null;
  nextRetryAtUtcIso: string | null;
  delaySeconds: number | null;
  paydaySynced: boolean;
  paydayCalendarPattern?: PaydayCalendarPattern;
  rationale: string;
};

const TRANSIENT_DECLINE_CODES = new Set([
  "network_timeout",
  "issuer_unavailable",
  "switch_timeout",
  "processor_throttled",
  "try_again_later",
  "acquirer_connection_error",
  "reenter_transaction",
]);

const INSUFFICIENT_FUNDS_CODES = new Set([
  "insufficient_funds",
  "low_balance",
  "exceeds_withdrawal_limit",
  "activity_amount_limit_exceeded",
  "do_not_honor_payday_candidate",
]);

const EXPIRED_CARD_CODES = new Set([
  "expired_card",
  "card_expired",
  "invalid_expiry",
]);

const HARD_DECLINE_CODES = new Set([
  "stolen_card",
  "lost_card",
  "fraud_suspected",
  "pickup_card",
  "invalid_account_number",
  "no_such_issuer",
  "revocation_of_all_authorizations",
  "account_closed",
  "transaction_not_permitted_to_cardholder",
]);

// Regional economic payday calendars by ISO country code
const COUNTRY_PAYDAY_PATTERNS: Record<
  string,
  { pattern: PaydayCalendarPattern; utcOffsetHours: number; description: string }
> = {
  NG: {
    pattern: "MONTHLY_25TH_TO_MONTH_END",
    utcOffsetHours: 1,
    description: "Nigeria monthly salary cycle (25th to last business day WAT)",
  },
  GH: {
    pattern: "MONTHLY_25TH_TO_MONTH_END",
    utcOffsetHours: 0,
    description: "Ghana monthly salary cycle (25th to last business day GMT)",
  },
  KE: {
    pattern: "MONTHLY_25TH_TO_MONTH_END",
    utcOffsetHours: 3,
    description: "Kenya monthly salary cycle (25th to last business day EAT)",
  },
  ZA: {
    pattern: "MONTHLY_25TH_TO_MONTH_END",
    utcOffsetHours: 2,
    description: "South Africa monthly salary cycle (25th to last business day SAST)",
  },
  DE: {
    pattern: "MONTHLY_25TH_TO_MONTH_END",
    utcOffsetHours: 1,
    description: "Germany Gehaltsabrechnung cycle (25th to last business day CET)",
  },
  FR: {
    pattern: "MONTHLY_25TH_TO_MONTH_END",
    utcOffsetHours: 1,
    description: "France monthly payroll cycle (25th to last business day CET)",
  },
  NL: {
    pattern: "MONTHLY_25TH_TO_MONTH_END",
    utcOffsetHours: 1,
    description: "Netherlands monthly salary cycle (24th–26th CET)",
  },
  JP: {
    pattern: "MONTHLY_25TH_STRICT",
    utcOffsetHours: 9,
    description: "Japan standard Gotobi/25th salary day (JST)",
  },
  SE: {
    pattern: "MONTHLY_25TH_STRICT",
    utcOffsetHours: 1,
    description: "Sweden Löning 25th monthly salary day (CET)",
  },
  GB: {
    pattern: "MONTHLY_LAST_WORKING_DAY",
    utcOffsetHours: 0,
    description: "UK monthly payroll (28th / last working day of month)",
  },
  US: {
    pattern: "SEMI_MONTHLY_15TH_AND_MONTH_END",
    utcOffsetHours: -5,
    description: "United States semi-monthly payroll (15th and last business day)",
  },
  CA: {
    pattern: "SEMI_MONTHLY_15TH_AND_MONTH_END",
    utcOffsetHours: -5,
    description: "Canada semi-monthly payroll (15th and last business day)",
  },
  BR: {
    pattern: "SEMI_MONTHLY_15TH_AND_MONTH_END",
    utcOffsetHours: -3,
    description: "Brazil Quinto Dia Útil / 15th & end-of-month payroll (BRT)",
  },
  MX: {
    pattern: "SEMI_MONTHLY_15TH_AND_MONTH_END",
    utcOffsetHours: -6,
    description: "Mexico Quincena payroll (15th and last day of month)",
  },
  ID: {
    pattern: "MONTHLY_25TH_TO_MONTH_END",
    utcOffsetHours: 7,
    description: "Indonesia Gajian monthly salary cycle (25th–last business day WIB)",
  },
  IN: {
    pattern: "MONTHLY_LAST_WORKING_DAY",
    utcOffsetHours: 5,
    description: "India end-of-month / 1st business day salary credit (IST)",
  },
};

function lastDayOfUtcMonth(year: number, monthZeroIndexed: number): number {
  return new Date(Date.UTC(year, monthZeroIndexed + 1, 0)).getUTCDate();
}

// Adjusts a target date if it falls on Saturday (6) or Sunday (0) to the nearest
// business day (preceding Friday for payroll credit, or following Monday if that
// Friday has already passed).
function adjustToBusinessDayUtcMs(
  year: number,
  monthZeroIndexed: number,
  dayOfMonth: number,
  localHour: number,
  utcOffsetHours: number,
  failedAtMs: number,
): number {
  const maxDay = lastDayOfUtcMonth(year, monthZeroIndexed);
  const clampedDay = Math.min(dayOfMonth, maxDay);
  const candidateUtc = new Date(
    Date.UTC(year, monthZeroIndexed, clampedDay, localHour - utcOffsetHours, 0, 0, 0),
  );
  const dow = candidateUtc.getUTCDay();
  if (dow === 6) {
    // Saturday -> Preceding Friday (employers credit payroll before weekend)
    const fridayMs = candidateUtc.getTime() - 86_400_000;
    return fridayMs > failedAtMs ? fridayMs : candidateUtc.getTime() + 2 * 86_400_000;
  }
  if (dow === 0) {
    // Sunday -> Preceding Friday if in future, else Monday
    const fridayMs = candidateUtc.getTime() - 2 * 86_400_000;
    return fridayMs > failedAtMs ? fridayMs : candidateUtc.getTime() + 86_400_000;
  }
  return candidateUtc.getTime();
}

export function computeNextRegionalPaydayMs(
  countryCode: string,
  failedAtMs: number,
  attemptNumber: number,
): { retryAtMs: number; pattern: PaydayCalendarPattern; description: string } {
  const normalizedCountry = countryCode.trim().toUpperCase();
  const profile = COUNTRY_PAYDAY_PATTERNS[normalizedCountry] ?? {
    pattern: "SEMI_MONTHLY_15TH_AND_MONTH_END" as const,
    utcOffsetHours: 0,
    description: "Global semi-monthly payday schedule (15th and month-end)",
  };

  const failedDate = new Date(failedAtMs);
  const year = failedDate.getUTCFullYear();
  const month = failedDate.getUTCMonth();

  const candidateDates: number[] = [];

  if (profile.pattern === "MONTHLY_25TH_STRICT") {
    // 25th of current month, 28th follow-up, then 25th of next month
    candidateDates.push(
      adjustToBusinessDayUtcMs(year, month, 25, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month, 28, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, 25, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, 28, 9, profile.utcOffsetHours, failedAtMs),
    );
  } else if (profile.pattern === "MONTHLY_25TH_TO_MONTH_END") {
    // Payday window: 25th of month, last business day of month, 2nd of next month, 25th of next month
    const lastDayCur = lastDayOfUtcMonth(year, month);
    const lastDayNext = lastDayOfUtcMonth(year, month + 1);
    candidateDates.push(
      adjustToBusinessDayUtcMs(year, month, 25, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month, lastDayCur, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, 2, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, 25, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, lastDayNext, 9, profile.utcOffsetHours, failedAtMs),
    );
  } else if (profile.pattern === "MONTHLY_LAST_WORKING_DAY") {
    const lastDayCur = lastDayOfUtcMonth(year, month);
    const lastDayNext = lastDayOfUtcMonth(year, month + 1);
    candidateDates.push(
      adjustToBusinessDayUtcMs(year, month, 28, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month, lastDayCur, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, 1, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, 28, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, lastDayNext, 9, profile.utcOffsetHours, failedAtMs),
    );
  } else {
    // SEMI_MONTHLY_15TH_AND_MONTH_END (US, CA, BR, MX)
    const lastDayCur = lastDayOfUtcMonth(year, month);
    const lastDayNext = lastDayOfUtcMonth(year, month + 1);
    candidateDates.push(
      adjustToBusinessDayUtcMs(year, month, 15, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month, lastDayCur, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, 1, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, 15, 9, profile.utcOffsetHours, failedAtMs),
      adjustToBusinessDayUtcMs(year, month + 1, lastDayNext, 9, profile.utcOffsetHours, failedAtMs),
    );
  }

  // Filter strictly future windows (at least 6 hours after the failure)
  const minFutureMs = failedAtMs + 6 * 3_600_000;
  const futureWindows = [...new Set(candidateDates)]
    .filter((ms) => ms >= minFutureMs)
    .sort((a, b) => a - b);

  const idx = Math.min(Math.max(0, attemptNumber - 1), futureWindows.length - 1);
  const retryAtMs = futureWindows[idx] ?? failedAtMs + 3 * 86_400_000;

  return {
    retryAtMs,
    pattern: profile.pattern,
    description: profile.description,
  };
}

export function classifyDeclineCode(rawCode: string): DeclineCategory {
  const code = rawCode.trim().toLowerCase();
  if (HARD_DECLINE_CODES.has(code)) return "HARD_PERMANENT_DECLINE";
  if (EXPIRED_CARD_CODES.has(code)) return "EXPIRED_OR_REPLACED_CARD";
  if (TRANSIENT_DECLINE_CODES.has(code)) return "TRANSIENT_NETWORK";
  if (INSUFFICIENT_FUNDS_CODES.has(code)) return "INSUFFICIENT_FUNDS";
  return "SOFT_ISSUER_DECLINE";
}

export function scheduleSmartDunning(input: {
  declineCode: string;
  customerCountry: string;
  attemptNumber: number; // 1-indexed retry attempt (1 = first failure)
  maxAttempts?: number;
  failedAtMs?: number;
}): SmartDunningDecision {
  const failedAtMs = input.failedAtMs ?? Date.now();
  const maxAttempts = input.maxAttempts ?? 4;
  const category = classifyDeclineCode(input.declineCode);

  if (category === "HARD_PERMANENT_DECLINE") {
    return {
      declineCode: input.declineCode,
      category,
      strategy: "HALT_HARD_DECLINE",
      shouldRetry: false,
      cascadeToSecondaryAcquirer: false,
      triggerNetworkAccountUpdater: false,
      notifyCustomerForPaymentUpdate: true,
      nextSubscriptionState: "PastDueActionRequired",
      nextRetryAtMs: null,
      nextRetryAtUtcIso: null,
      delaySeconds: null,
      paydaySynced: false,
      rationale:
        "Hard permanent card/account decline; automatic retries halted per card network compliance mandates.",
    };
  }

  if (input.attemptNumber > maxAttempts) {
    return {
      declineCode: input.declineCode,
      category,
      strategy: "HALT_HARD_DECLINE",
      shouldRetry: false,
      cascadeToSecondaryAcquirer: false,
      triggerNetworkAccountUpdater: false,
      notifyCustomerForPaymentUpdate: true,
      nextSubscriptionState: "PastDueActionRequired",
      nextRetryAtMs: null,
      nextRetryAtUtcIso: null,
      delaySeconds: null,
      paydaySynced: false,
      rationale: `Exhausted maximum smart dunning attempts (${maxAttempts}); awaiting customer payment method update.`,
    };
  }

  if (category === "EXPIRED_OR_REPLACED_CARD") {
    // Give Visa Account Updater (VAU) / Mastercard Automatic Billing Updater (ABU) 24h to refresh credentials
    const nextRetryAtMs = failedAtMs + 24 * 3_600_000;
    return {
      declineCode: input.declineCode,
      category,
      strategy: "ACCOUNT_UPDATER_AND_CUSTOMER_NOTIFY",
      shouldRetry: input.attemptNumber === 1,
      cascadeToSecondaryAcquirer: false,
      triggerNetworkAccountUpdater: true,
      notifyCustomerForPaymentUpdate: true,
      nextSubscriptionState: input.attemptNumber === 1 ? "PastDueRetrying" : "PastDueActionRequired",
      nextRetryAtMs: input.attemptNumber === 1 ? nextRetryAtMs : null,
      nextRetryAtUtcIso: input.attemptNumber === 1 ? new Date(nextRetryAtMs).toISOString() : null,
      delaySeconds: input.attemptNumber === 1 ? 86_400 : null,
      paydaySynced: false,
      rationale:
        "Expired card detected; triggered network token / Account Updater refresh and scheduled single verification retry in 24h.",
    };
  }

  if (category === "TRANSIENT_NETWORK") {
    // Immediate exponential backoff: 30s, 5m, 30m, 2h with cross-acquirer failover cascade
    const backoffSecondsByAttempt = [30, 300, 1800, 7200];
    const delaySeconds =
      backoffSecondsByAttempt[Math.min(input.attemptNumber - 1, backoffSecondsByAttempt.length - 1)]!;
    const nextRetryAtMs = failedAtMs + delaySeconds * 1000;
    return {
      declineCode: input.declineCode,
      category,
      strategy: "IMMEDIATE_EXPONENTIAL_CASCADE",
      shouldRetry: true,
      cascadeToSecondaryAcquirer: true,
      triggerNetworkAccountUpdater: false,
      notifyCustomerForPaymentUpdate: false,
      nextSubscriptionState: "PastDueRetrying",
      nextRetryAtMs,
      nextRetryAtUtcIso: new Date(nextRetryAtMs).toISOString(),
      delaySeconds,
      paydaySynced: false,
      rationale: `Transient gateway/issuer network failure; cascading to secondary acquirer with ${delaySeconds}s exponential backoff.`,
    };
  }

  if (category === "INSUFFICIENT_FUNDS") {
    const payday = computeNextRegionalPaydayMs(
      input.customerCountry,
      failedAtMs,
      input.attemptNumber,
    );
    const delaySeconds = Math.round((payday.retryAtMs - failedAtMs) / 1000);
    return {
      declineCode: input.declineCode,
      category,
      strategy: "REGIONAL_PAYDAY_SYNC",
      shouldRetry: true,
      cascadeToSecondaryAcquirer: false,
      triggerNetworkAccountUpdater: false,
      notifyCustomerForPaymentUpdate: input.attemptNumber >= 2,
      nextSubscriptionState: "PastDueRetrying",
      nextRetryAtMs: payday.retryAtMs,
      nextRetryAtUtcIso: new Date(payday.retryAtMs).toISOString(),
      delaySeconds,
      paydaySynced: true,
      paydayCalendarPattern: payday.pattern,
      rationale: `Synced retry to ${payday.description} at ${new Date(payday.retryAtMs).toISOString()}.`,
    };
  }

  // SOFT_ISSUER_DECLINE (e.g. generic do_not_honor, velocity limit):
  // Cool off for 24h on attempt 1, 72h on attempt 2, then payday-sync on attempt 3+
  if (input.attemptNumber <= 2) {
    const delayHours = input.attemptNumber === 1 ? 24 : 72;
    const delaySeconds = delayHours * 3600;
    const nextRetryAtMs = failedAtMs + delaySeconds * 1000;
    return {
      declineCode: input.declineCode,
      category,
      strategy: "COOLING_OFF_RETRY",
      shouldRetry: true,
      cascadeToSecondaryAcquirer: input.attemptNumber === 1,
      triggerNetworkAccountUpdater: false,
      notifyCustomerForPaymentUpdate: false,
      nextSubscriptionState: "PastDueRetrying",
      nextRetryAtMs,
      nextRetryAtUtcIso: new Date(nextRetryAtMs).toISOString(),
      delaySeconds,
      paydaySynced: false,
      rationale: `Soft issuer decline; scheduled ${delayHours}h cooling-off retry.`,
    };
  }

  const payday = computeNextRegionalPaydayMs(
    input.customerCountry,
    failedAtMs,
    input.attemptNumber - 2,
  );
  const delaySeconds = Math.round((payday.retryAtMs - failedAtMs) / 1000);
  return {
    declineCode: input.declineCode,
    category,
    strategy: "REGIONAL_PAYDAY_SYNC",
    shouldRetry: true,
    cascadeToSecondaryAcquirer: false,
    triggerNetworkAccountUpdater: false,
    notifyCustomerForPaymentUpdate: true,
    nextSubscriptionState: "PastDueRetrying",
    nextRetryAtMs: payday.retryAtMs,
    nextRetryAtUtcIso: new Date(payday.retryAtMs).toISOString(),
    delaySeconds,
    paydaySynced: true,
    paydayCalendarPattern: payday.pattern,
    rationale: `Follow-up soft decline synced to ${payday.description}.`,
  };
}
