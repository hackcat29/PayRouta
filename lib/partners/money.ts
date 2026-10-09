// Currency exponents for provider payment amounts (ISO 4217). A provider is
// only ever sent an amount whose declared precision equals the currency's
// exponent; anything else is refused rather than scaled, because a mismatch
// would charge the customer the wrong amount.
const zeroDecimal = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF",
  "UGX", "VND", "VUV", "XAF", "XOF", "XPF",
]);
const threeDecimal = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

export function currencyExponent(code: string) {
  if (!/^[A-Z]{3}$/.test(code)) return null;
  if (zeroDecimal.has(code)) return 0;
  if (threeDecimal.has(code)) return 3;
  return 2;
}

// Exact decimal string → integer minor units. Returns null on any mismatch.
export function toMinorUnits(amount: string, precision: number, currency: string) {
  const exponent = currencyExponent(currency);
  if (exponent === null || exponent !== precision) return null;
  const m = amount.match(/^(0|[1-9]\d{0,17})(?:\.(\d+))?$/);
  if (!m || (m[2]?.length ?? 0) > precision) return null;
  const value = BigInt(m[1]) * 10n ** BigInt(precision) + BigInt((m[2] ?? "").padEnd(precision, "0") || "0");
  return value > 0n ? value : null;
}

export function fromMinorUnits(minor: bigint | number | string, currency: string) {
  const exponent = currencyExponent(currency);
  if (exponent === null) return null;
  const v = BigInt(minor);
  if (v < 0n) return null;
  if (exponent === 0) return v.toString();
  const s = v.toString().padStart(exponent + 1, "0");
  return `${s.slice(0, -exponent)}.${s.slice(-exponent)}`;
}
