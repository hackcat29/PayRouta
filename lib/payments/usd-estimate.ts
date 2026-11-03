// Rough US dollar values for amounts in other currencies, from fixed
// reference rates. For estimates such as a merchant's monthly volume against
// its tier cap (lib/merchant/requirements.ts), never for pricing or payouts.
import { currencyExponent } from "../partners/money";

const SCALE = 1_000_000_000_000n; // rates are US dollars per major unit, times 1e12

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

// Approximate US dollars for an amount in minor units; null for a currency
// the table doesn't list.
export function approximateUsd(currency: string, amountMinor: bigint): number | null {
  const scaled = USD_MAJOR_PER_UNIT_SCALED[currency.toUpperCase()];
  const exponent = currencyExponent(currency) ?? 2;
  if (!scaled) return null;
  return Number((amountMinor * scaled) / SCALE) / 10 ** exponent;
}
