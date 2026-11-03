// Abstracted "Global-First" Ledger & Any-to-Any FX Splicing Engine.
//
// Treats fiat currencies, mobile-money wallets, and digital assets (stablecoins)
// as equal primitives using exact integer minor-unit arithmetic (BigInt) and
// 1e12-scaled fixed-point exchange rates.
//
// Every spliced transaction records a Triple-Entry Accounting valuation:
//   1. Presentment Currency (what the buyer paid, e.g. KES via M-Pesa)
//   2. Settlement Currency  (what the merchant holds, e.g. USDC or EUR)
//   3. System Base Currency (real-time USD treasury equivalent)
import { createHash } from "node:crypto";
import { currencyExponent, fromMinorUnits } from "../partners/money";
import { PortalError } from "../portal/domain";
import { post, type Posting } from "./journal";
import type { Tx } from "./service";

export const FX_RATE_SCALE = 1_000_000_000_000n; // 1e12 fixed-point precision

export type AssetClass = "fiat" | "mobile-wallet" | "stablecoin";

export type LedgerAssetPrimitive = {
  code: string;
  assetClass: AssetClass;
  exponent: number;
  network?: string;
};

const STABLECOIN_CODES = new Set(["USDC", "USDT", "EURC", "PYUSD"]);
const MOBILE_WALLET_RAILS = new Set(["MPESA", "MTN_MOMO", "AIRTEL_MONEY", "GOPAY", "OVO", "PAYPAY"]);

export function resolveAssetPrimitive(
  code: string,
  options?: { network?: string; rail?: string; onChainAtomic?: boolean },
): LedgerAssetPrimitive {
  const normalized = code.trim().toUpperCase();
  if (STABLECOIN_CODES.has(normalized)) {
    return {
      code: normalized,
      assetClass: "stablecoin",
      // In ledger minor units we default to 2 decimals (cents) for uniform
      // accounting alongside ISO 4217 currencies unless onChainAtomic (6) is requested.
      exponent: options?.onChainAtomic ? 6 : 2,
      network: options?.network ?? "solana",
    };
  }
  const exp = currencyExponent(normalized);
  if (exp === null) {
    throw new PortalError(`UNSUPPORTED_LEDGER_ASSET:${normalized}`, 400);
  }
  const isMobile = options?.rail ? MOBILE_WALLET_RAILS.has(options.rail.toUpperCase()) : false;
  return {
    code: normalized,
    assetClass: isMobile ? "mobile-wallet" : "fiat",
    exponent: exp,
    network: options?.network,
  };
}

export type FxCorridorRate = {
  rateId: string;
  from: string;
  to: string;
  // Number of 1.00 (major unit) of `to` per 1.00 (major unit) of `from`, scaled by 1e12.
  majorRateScaled: bigint;
  spreadBps: number;
  source: string;
  quotedAt: string;
  expiresAt: string;
};

export type FxRateBook = {
  rates: FxCorridorRate[];
};

// Default institutional reference rates (major-unit to major-unit, scaled by 1e12)
// for deterministic quoting and sandbox verification when no custom rate book is passed.
// 1 USD = 1.00 USDC = 1.00 USDT = 0.92 EUR = 0.79 GBP = 155 JPY = 1600 NGN = 129 KES
// = 15.4 GHS = 18.2 ZAR = 5.65 BRL = 19.8 MXN = 84.0 INR = 15800 IDR = 1.38 CAD = 1.52 AUD = 1.34 SGD
const USD_MAJOR_PER_UNIT_SCALED: Record<string, bigint> = {
  USD: 1_000_000_000_000n,       // 1.000000000000 USD
  USDC: 1_000_000_000_000n,      // 1.000000000000 USD
  USDT: 1_000_000_000_000n,      // 1.000000000000 USD
  PYUSD: 1_000_000_000_000n,     // 1.000000000000 USD
  EUR: 1_086_956_521_739n,       // ~1.0869565 USD per EUR (1 USD = 0.92 EUR)
  EURC: 1_086_956_521_739n,      // ~1.0869565 USD per EURC
  GBP: 1_265_822_784_810n,       // ~1.2658228 USD per GBP (1 USD = 0.79 GBP)
  JPY: 6_451_612_903n,           // ~0.0064516 USD per JPY (1 USD = 155 JPY)
  NGN: 625_000_000n,             // 0.000625 USD per NGN (1 USD = 1600 NGN)
  KES: 7_751_937_984n,           // ~0.0077519 USD per KES (1 USD = 129 KES)
  GHS: 64_935_064_935n,          // ~0.0649351 USD per GHS (1 USD = 15.4 GHS)
  ZAR: 54_945_054_945n,          // ~0.0549451 USD per ZAR (1 USD = 18.2 ZAR)
  BRL: 176_991_150_442n,         // ~0.1769912 USD per BRL (1 USD = 5.65 BRL)
  MXN: 50_505_050_505n,          // ~0.0505051 USD per MXN (1 USD = 19.8 MXN)
  INR: 11_904_761_905n,          // ~0.0119048 USD per INR (1 USD = 84 INR)
  IDR: 63_291_139n,              // ~0.0000633 USD per IDR (1 USD = 15800 IDR)
  CAD: 724_637_681_159n,         // ~0.7246377 USD per CAD (1 USD = 1.38 CAD)
  AUD: 657_894_736_842n,         // ~0.6578947 USD per AUD (1 USD = 1.52 AUD)
  SGD: 746_268_656_716n,         // ~0.7462687 USD per SGD (1 USD = 1.34 SGD)
  CHF: 1_136_363_636_364n,       // ~1.1363636 USD per CHF (1 USD = 0.88 CHF)
  AED: 272_294_077_604n,         // ~0.2722941 USD per AED (1 USD = 3.6725 AED)
  XOF: 1_657_050_280n,           // ~0.0016571 USD per XOF (CFA Franc)
  XAF: 1_657_050_280n,           // ~0.0016571 USD per XAF
  UGX: 270_270_270n,             // ~0.0002703 USD per UGX (1 USD = 3700 UGX)
  RWF: 740_740_741n,             // ~0.0007407 USD per RWF (1 USD = 1350 RWF)
};

// Direct corridor pairs where liquidity providers quote direct Any-to-Any crosses
// with tighter spreads (no forced double USD conversion).
const DIRECT_CORRIDOR_SPREAD_BPS: Record<string, number> = {
  "USD->USDC": 0,
  "USDC->USD": 0,
  "USD->USDT": 5,
  "USDT->USD": 5,
  "EUR->EURC": 0,
  "EURC->EUR": 0,
  "EUR->USDC": 12,
  "USDC->EUR": 12,
  "JPY->KES": 20,
  "KES->USDC": 25,
  "KES->EUR": 28,
  "JPY->EUR": 15,
  "JPY->USDC": 15,
  "NGN->USDC": 30,
  "NGN->USDT": 30,
  "NGN->EUR": 35,
  "NGN->GBP": 35,
  "BRL->USDC": 20,
  "BRL->EUR": 25,
  "GBP->EUR": 12,
  "GBP->USDC": 12,
  "GHS->USDC": 35,
  "ZAR->USDC": 25,
  "IDR->USDC": 25,
  "INR->USDC": 25,
};

// Approximate US dollars for an amount in minor units, from the reference
// table above; null for a currency it doesn't list. For estimates such as a
// merchant's monthly volume, never for pricing.
export function approximateUsd(currency: string, amountMinor: bigint): number | null {
  const scaled = USD_MAJOR_PER_UNIT_SCALED[currency.toUpperCase()];
  const exponent = currencyExponent(currency) ?? 2;
  if (!scaled) return null;
  return Number((amountMinor * scaled) / FX_RATE_SCALE) / 10 ** exponent;
}

export function buildDefaultRateBook(now = new Date(), ttlMs = 5 * 60_000): FxRateBook {
  const quotedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const codes = Object.keys(USD_MAJOR_PER_UNIT_SCALED);
  const rates: FxCorridorRate[] = [];

  for (const from of codes) {
    for (const to of codes) {
      if (from === to) continue;
      const fromUsd = USD_MAJOR_PER_UNIT_SCALED[from]!;
      const toUsd = USD_MAJOR_PER_UNIT_SCALED[to]!;
      // majorRateScaled = (fromUsd * 1e12) / toUsd
      const majorRateScaled = (fromUsd * FX_RATE_SCALE) / toUsd;
      const key = `${from}->${to}`;
      const isDirect = key in DIRECT_CORRIDOR_SPREAD_BPS;
      const spreadBps = isDirect ? DIRECT_CORRIDOR_SPREAD_BPS[key]! : 35;
      const digest = createHash("sha256")
        .update(`${from}:${to}:${majorRateScaled.toString()}:${quotedAt}`)
        .digest("hex")
        .slice(0, 16);
      rates.push({
        rateId: `fx_${from.toLowerCase()}_${to.toLowerCase()}_${digest}`,
        from,
        to,
        majorRateScaled,
        spreadBps,
        source: isDirect ? "direct-corridor-lp" : "synthetic-single-cross",
        quotedAt,
        expiresAt,
      });
    }
  }
  return { rates };
}

// Converts an amount in `from` minor units into `to` minor units using `majorRateScaled`
// and exact exponent scaling:
//   toMinor = fromMinor * majorRateScaled * 10^(toExp) / (10^(fromExp) * 1e12)
export function convertMinorUnits(
  fromMinor: bigint,
  fromExponent: number,
  toExponent: number,
  majorRateScaled: bigint,
  rounding: "floor" | "ceil" | "half-up" = "half-up",
): bigint {
  if (fromMinor < 0n) throw new PortalError("NEGATIVE_FX_AMOUNT", 400);
  if (fromMinor === 0n) return 0n;
  const expDiff = toExponent - fromExponent;
  const numerator =
    expDiff >= 0
      ? fromMinor * majorRateScaled * 10n ** BigInt(expDiff)
      : fromMinor * majorRateScaled;
  const denominator =
    expDiff >= 0
      ? FX_RATE_SCALE
      : FX_RATE_SCALE * 10n ** BigInt(-expDiff);

  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  if (rounding === "floor") return quotient;
  if (rounding === "ceil") return quotient + 1n;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

export type TripleCurrencyValuation = {
  presentment: {
    currency: string;
    assetClass: AssetClass;
    exponent: number;
    amountMinor: string;
    formatted: string;
  };
  settlement: {
    currency: string;
    assetClass: AssetClass;
    exponent: number;
    network?: string;
    grossMinor: string;
    providerFeeMinor: string;
    platformFeeMinor: string;
    netMinor: string;
    formattedNet: string;
  };
  systemBase: {
    currency: "USD";
    exponent: 2;
    presentmentUsdMinor: string;
    settlementNetUsdMinor: string;
    totalFeeUsdMinor: string;
    formattedPresentmentUsd: string;
  };
};

export type SpliceRouteHop = {
  from: string;
  to: string;
  rateId: string;
  majorRateScaled: string;
  effectiveRateScaled: string;
  spreadBps: number;
  source: string;
};

export type SpliceQuote = {
  quoteId: string;
  routingMode: "SAME_CURRENCY" | "DIRECT_SPLICE" | "PRICING_TO_PRESENTMENT_TO_SETTLEMENT";
  forcedDoubleUsdConversion: false;
  pricing: {
    currency: string;
    exponent: number;
    amountMinor: string;
    formatted: string;
  };
  tripleEntry: TripleCurrencyValuation;
  hops: SpliceRouteHop[];
  quotedAt: string;
  expiresAt: string;
};

export type CreateSpliceQuoteInput = {
  // What the merchant priced the product in (e.g., JPY 15500). Optional if equal to presentmentCurrency.
  pricingCurrency?: string;
  pricingAmountMinor?: bigint | number | string;
  // What the buyer actually pays in (e.g., KES via M-Pesa).
  presentmentCurrency: string;
  presentmentAmountMinor?: bigint | number | string;
  presentmentRail?: string;
  // What the merchant wants to hold (e.g., USDC on Solana or EUR via SEPA).
  settlementCurrency: string;
  settlementNetwork?: string;
  // Fee parameters in basis points applied to the settlement leg.
  providerFeeBps?: number;
  platformFeeBps?: number;
  rateBook?: FxRateBook;
  now?: Date;
};

function findValidRate(book: FxRateBook, from: string, to: string, now: Date): FxCorridorRate {
  const rate = book.rates.find((r) => r.from === from && r.to === to);
  if (!rate) {
    throw new PortalError(`FX_CORRIDOR_UNAVAILABLE:${from}->${to}`, 409);
  }
  if (Date.parse(rate.expiresAt) <= now.getTime()) {
    throw new PortalError(`FX_RATE_EXPIRED:${from}->${to}`, 409);
  }
  return rate;
}

function formatAssetAmount(minorValue: bigint, code: string, exponent: number): string {
  const isoFormatted = fromMinorUnits(minorValue, code);
  if (isoFormatted !== null) return isoFormatted;
  if (exponent === 0) return minorValue.toString();
  const s = minorValue.toString().padStart(exponent + 1, "0");
  return `${s.slice(0, -exponent)}.${s.slice(-exponent)}`;
}

// Any-to-Any Splicing Engine:
// Allows a merchant to price in `pricingCurrency` (e.g. JPY), accept payment in
// `presentmentCurrency` (e.g. KES via M-Pesa), and settle into `settlementCurrency`
// (e.g. USDC or EUR) while simultaneously calculating System Base Currency (USD)
// without forcing a double USD conversion spread.
export function createSpliceQuote(input: CreateSpliceQuoteInput): SpliceQuote {
  const now = input.now ?? new Date();
  const book = input.rateBook ?? buildDefaultRateBook(now);

  const presentmentAsset = resolveAssetPrimitive(input.presentmentCurrency, {
    rail: input.presentmentRail,
  });
  const settlementAsset = resolveAssetPrimitive(input.settlementCurrency, {
    network: input.settlementNetwork,
  });
  const pricingAsset = resolveAssetPrimitive(
    input.pricingCurrency ?? presentmentAsset.code,
  );

  const hops: SpliceRouteHop[] = [];
  let pricingMinor: bigint;
  let presentmentMinor: bigint;

  if (input.presentmentAmountMinor !== undefined) {
    presentmentMinor = BigInt(input.presentmentAmountMinor);
    if (presentmentMinor <= 0n) throw new PortalError("INVALID_PRESENTMENT_AMOUNT", 400);
    if (pricingAsset.code === presentmentAsset.code) {
      pricingMinor = presentmentMinor;
    } else if (input.pricingAmountMinor !== undefined) {
      pricingMinor = BigInt(input.pricingAmountMinor);
    } else {
      const rate = findValidRate(book, presentmentAsset.code, pricingAsset.code, now);
      pricingMinor = convertMinorUnits(
        presentmentMinor,
        presentmentAsset.exponent,
        pricingAsset.exponent,
        rate.majorRateScaled,
      );
    }
  } else if (input.pricingAmountMinor !== undefined) {
    pricingMinor = BigInt(input.pricingAmountMinor);
    if (pricingMinor <= 0n) throw new PortalError("INVALID_PRICING_AMOUNT", 400);
    if (pricingAsset.code === presentmentAsset.code) {
      presentmentMinor = pricingMinor;
    } else {
      // Convert merchant's display price (e.g. JPY) into buyer's local currency (e.g. KES)
      const rate = findValidRate(book, pricingAsset.code, presentmentAsset.code, now);
      // For buyer presentment when priced in another currency, apply half of corridor spread or 0 if direct display
      const effectiveRate =
        (rate.majorRateScaled * BigInt(10_000 + rate.spreadBps)) / 10_000n;
      presentmentMinor = convertMinorUnits(
        pricingMinor,
        pricingAsset.exponent,
        presentmentAsset.exponent,
        effectiveRate,
        "ceil",
      );
      hops.push({
        from: pricingAsset.code,
        to: presentmentAsset.code,
        rateId: rate.rateId,
        majorRateScaled: rate.majorRateScaled.toString(),
        effectiveRateScaled: effectiveRate.toString(),
        spreadBps: rate.spreadBps,
        source: rate.source,
      });
    }
  } else {
    throw new PortalError("MISSING_SPLICE_AMOUNT", 400);
  }

  // Convert Presentment Currency -> Settlement Currency directly without double USD conversion
  let settlementGrossMinor: bigint;
  let expiresAtMs = now.getTime() + 5 * 60_000;

  if (presentmentAsset.code === settlementAsset.code) {
    settlementGrossMinor = presentmentMinor;
  } else {
    const spliceRate = findValidRate(book, presentmentAsset.code, settlementAsset.code, now);
    expiresAtMs = Math.min(expiresAtMs, Date.parse(spliceRate.expiresAt));
    const netEffectiveRate =
      (spliceRate.majorRateScaled * BigInt(10_000 - spliceRate.spreadBps)) / 10_000n;
    settlementGrossMinor = convertMinorUnits(
      presentmentMinor,
      presentmentAsset.exponent,
      settlementAsset.exponent,
      netEffectiveRate,
      "floor",
    );
    hops.push({
      from: presentmentAsset.code,
      to: settlementAsset.code,
      rateId: spliceRate.rateId,
      majorRateScaled: spliceRate.majorRateScaled.toString(),
      effectiveRateScaled: netEffectiveRate.toString(),
      spreadBps: spliceRate.spreadBps,
      source: spliceRate.source,
    });
  }

  const providerFeeBps = BigInt(input.providerFeeBps ?? 0);
  const platformFeeBps = BigInt(input.platformFeeBps ?? 0);
  if (providerFeeBps < 0n || platformFeeBps < 0n || providerFeeBps + platformFeeBps >= 10_000n) {
    throw new PortalError("INVALID_FEE_BPS", 400);
  }

  const providerFeeMinor = (settlementGrossMinor * providerFeeBps) / 10_000n;
  const platformFeeMinor = (settlementGrossMinor * platformFeeBps) / 10_000n;
  const totalFeeMinor = providerFeeMinor + platformFeeMinor;
  const settlementNetMinor = settlementGrossMinor - totalFeeMinor;

  // Compute System Base Currency (USD) valuation simultaneously for real-time treasury tracking
  const presentmentUsdMinor =
    presentmentAsset.code === "USD"
      ? presentmentMinor
      : convertMinorUnits(
          presentmentMinor,
          presentmentAsset.exponent,
          2,
          findValidRate(book, presentmentAsset.code, "USD", now).majorRateScaled,
        );

  const settlementToUsdRate =
    settlementAsset.code === "USD"
      ? FX_RATE_SCALE
      : findValidRate(book, settlementAsset.code, "USD", now).majorRateScaled;

  const settlementNetUsdMinor =
    settlementAsset.code === "USD"
      ? settlementNetMinor
      : convertMinorUnits(
          settlementNetMinor,
          settlementAsset.exponent,
          2,
          settlementToUsdRate,
        );

  const totalFeeUsdMinor =
    settlementAsset.code === "USD"
      ? totalFeeMinor
      : convertMinorUnits(
          totalFeeMinor,
          settlementAsset.exponent,
          2,
          settlementToUsdRate,
        );

  const routingMode: SpliceQuote["routingMode"] =
    pricingAsset.code === presentmentAsset.code && presentmentAsset.code === settlementAsset.code
      ? "SAME_CURRENCY"
      : pricingAsset.code !== presentmentAsset.code && presentmentAsset.code !== settlementAsset.code
        ? "PRICING_TO_PRESENTMENT_TO_SETTLEMENT"
        : "DIRECT_SPLICE";

  const quoteDigest = createHash("sha256")
    .update(
      `${pricingAsset.code}:${pricingMinor}:${presentmentAsset.code}:${presentmentMinor}:${settlementAsset.code}:${settlementNetMinor}:${now.toISOString()}`,
    )
    .digest("hex")
    .slice(0, 20);

  return {
    quoteId: `splice_${quoteDigest}`,
    routingMode,
    forcedDoubleUsdConversion: false,
    pricing: {
      currency: pricingAsset.code,
      exponent: pricingAsset.exponent,
      amountMinor: pricingMinor.toString(),
      formatted: formatAssetAmount(pricingMinor, pricingAsset.code, pricingAsset.exponent),
    },
    tripleEntry: {
      presentment: {
        currency: presentmentAsset.code,
        assetClass: presentmentAsset.assetClass,
        exponent: presentmentAsset.exponent,
        amountMinor: presentmentMinor.toString(),
        formatted: formatAssetAmount(presentmentMinor, presentmentAsset.code, presentmentAsset.exponent),
      },
      settlement: {
        currency: settlementAsset.code,
        assetClass: settlementAsset.assetClass,
        exponent: settlementAsset.exponent,
        ...(settlementAsset.network ? { network: settlementAsset.network } : {}),
        grossMinor: settlementGrossMinor.toString(),
        providerFeeMinor: providerFeeMinor.toString(),
        platformFeeMinor: platformFeeMinor.toString(),
        netMinor: settlementNetMinor.toString(),
        formattedNet: formatAssetAmount(settlementNetMinor, settlementAsset.code, settlementAsset.exponent),
      },
      systemBase: {
        currency: "USD",
        exponent: 2,
        presentmentUsdMinor: presentmentUsdMinor.toString(),
        settlementNetUsdMinor: settlementNetUsdMinor.toString(),
        totalFeeUsdMinor: totalFeeUsdMinor.toString(),
        formattedPresentmentUsd: formatAssetAmount(presentmentUsdMinor, "USD", 2),
      },
    },
    hops,
    quotedAt: now.toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

// Encodes the Triple-Entry Accounting valuation stamp into the JournalEntry purpose
// field so every ledger entry carries Presentment, Settlement, and System Base (USD)
// primitives without altering existing PostgreSQL journal triggers.
export function encodeTripleEntryPurpose(label: string, quote: SpliceQuote): string {
  const { presentment, settlement, systemBase } = quote.tripleEntry;
  const payload = {
    label,
    quoteId: quote.quoteId,
    routingMode: quote.routingMode,
    presentment: `${presentment.amountMinor} ${presentment.currency}`,
    settlement: `${settlement.netMinor} ${settlement.currency}`,
    settlementGross: `${settlement.grossMinor} ${settlement.currency}`,
    systemBaseUsd: `${systemBase.presentmentUsdMinor} USD`,
    settlementNetUsd: `${systemBase.settlementNetUsdMinor} USD`,
  };
  return `${label} | TRIPLE_LEDGER:${JSON.stringify(payload)}`;
}

export function decodeTripleEntryPurpose(purpose: string): {
  label: string;
  quoteId: string;
  routingMode: string;
  presentment: string;
  settlement: string;
  settlementGross: string;
  systemBaseUsd: string;
  settlementNetUsd: string;
} | null {
  const marker = " | TRIPLE_LEDGER:";
  const idx = purpose.indexOf(marker);
  if (idx === -1) return null;
  try {
    return JSON.parse(purpose.slice(idx + marker.length));
  } catch {
    return null;
  }
}

export function buildSplicedPostings(quote: SpliceQuote): {
  presentmentLeg: { asset: string; lines: Posting[] } | null;
  settlementLeg: { asset: string; lines: Posting[] };
  platformAccrualLeg: { asset: string; lines: Posting[] } | null;
} {
  const { presentment, settlement } = quote.tripleEntry;
  const gross = BigInt(settlement.grossMinor);
  const net = BigInt(settlement.netMinor);
  const providerFee = BigInt(settlement.providerFeeMinor);
  const platformFee = BigInt(settlement.platformFeeMinor);
  const totalFee = providerFee + platformFee;

  if (presentment.currency === settlement.currency) {
    const lines: Posting[] = [
      { account: "provider-clearing", debit: gross.toString(), credit: "0" },
      { account: "merchant-payable", debit: "0", credit: net.toString() },
    ];
    if (totalFee > 0n) {
      lines.push({ account: "provider-fee", debit: "0", credit: totalFee.toString() });
    }
    return {
      presentmentLeg: null,
      settlementLeg: { asset: settlement.currency, lines },
      platformAccrualLeg:
        platformFee > 0n
          ? {
              asset: settlement.currency,
              lines: [
                { account: "platform-receivable", debit: platformFee.toString(), credit: "0" },
                { account: "platform-fee-revenue", debit: "0", credit: platformFee.toString() },
              ],
            }
          : null,
    };
  }

  // Cross-currency splice:
  // 1) Presentment leg clears buyer's currency into conversion-clearing
  const presentmentLeg = {
    asset: presentment.currency,
    lines: [
      { account: "provider-clearing", debit: presentment.amountMinor, credit: "0" },
      { account: "conversion-clearing", debit: "0", credit: presentment.amountMinor },
    ],
  };

  // 2) Settlement leg splices out of conversion-clearing into merchant-payable & provider-fee
  const settlementLines: Posting[] = [
    { account: "conversion-clearing", debit: gross.toString(), credit: "0" },
    { account: "merchant-payable", debit: "0", credit: net.toString() },
  ];
  if (totalFee > 0n) {
    settlementLines.push({ account: "provider-fee", debit: "0", credit: totalFee.toString() });
  }

  return {
    presentmentLeg,
    settlementLeg: { asset: settlement.currency, lines: settlementLines },
    platformAccrualLeg:
      platformFee > 0n
        ? {
            asset: settlement.currency,
            lines: [
              { account: "platform-receivable", debit: platformFee.toString(), credit: "0" },
              { account: "platform-fee-revenue", debit: "0", credit: platformFee.toString() },
            ],
          }
        : null,
  };
}

export async function postSplicedCollection(
  tx: Tx,
  input: {
    orgId: string;
    environment: string;
    sourcePrefix: string;
    quote: SpliceQuote;
    effectiveAt?: Date;
  },
) {
  const effectiveAt = input.effectiveAt ?? new Date();
  if (Date.parse(input.quote.expiresAt) <= effectiveAt.getTime()) {
    throw new PortalError("FX_QUOTE_EXPIRED_AT_POSTING", 409);
  }
  const legs = buildSplicedPostings(input.quote);
  const entries = [];

  if (legs.presentmentLeg) {
    const pEntry = await post(
      tx,
      {
        orgId: input.orgId,
        environment: input.environment,
        source: `${input.sourcePrefix}:presentment`,
        asset: legs.presentmentLeg.asset,
        purpose: encodeTripleEntryPurpose("Spliced presentment clearing", input.quote),
        effectiveAt,
        book: "provider-merchant-operational",
      },
      legs.presentmentLeg.lines,
    );
    entries.push(pEntry);
  }

  const sEntry = await post(
    tx,
    {
      orgId: input.orgId,
      environment: input.environment,
      source: `${input.sourcePrefix}:settlement`,
      asset: legs.settlementLeg.asset,
      purpose: encodeTripleEntryPurpose("Spliced merchant settlement", input.quote),
      effectiveAt,
      book: "provider-merchant-operational",
    },
    legs.settlementLeg.lines,
  );
  entries.push(sEntry);

  if (legs.platformAccrualLeg) {
    const aEntry = await post(
      tx,
      {
        orgId: input.orgId,
        environment: input.environment,
        source: `${input.sourcePrefix}:platform-fee`,
        asset: legs.platformAccrualLeg.asset,
        purpose: encodeTripleEntryPurpose("Spliced platform fee accrual", input.quote),
        effectiveAt,
        book: "payrouta-platform-accrual",
      },
      legs.platformAccrualLeg.lines,
    );
    entries.push(aEntry);
  }

  return {
    quoteId: input.quote.quoteId,
    tripleEntry: input.quote.tripleEntry,
    entries,
  };
}
