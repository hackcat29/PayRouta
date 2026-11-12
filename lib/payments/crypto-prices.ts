import {
  quoteAsset,
  validPaymentAmount,
  type CryptoAsset,
} from "../blockchain/crypto-assets";
import {
  providerRequest,
  type ProviderHttpResponse,
} from "../providers/adapters/http";
import { secretManager } from "../portal/adapters";
import { PortalError } from "../portal/domain";
import { feeScheduleSchema, pricingVersion } from "./pricing";
import { assetKey } from "./contracts";
export const cryptoQuoteLifetimeMs = 120000;
// A checkout priced only in US-dollar stablecoins keeps its price for 30
// minutes: their USD price barely moves, and paying any other token through
// NEAR Intents needs at least 5 minutes left on the checkout
// (lib/intents/checkout.ts minimumWindowMs). Any other coin: 2 minutes.
export const stablecoinQuoteLifetimeMs = 30 * 60000;
const usdStablecoins = new Set(["usd-coin", "tether", "dai", "paypal-usd", "usdt0", "first-digital-usd"]);
export function quoteLifetimeMs(assets: readonly Pick<CryptoAsset, "coinGeckoId">[]) {
  return assets.length && assets.every((a) => usdStablecoins.has(a.coinGeckoId)) ? stablecoinQuoteLifetimeMs : cryptoQuoteLifetimeMs;
}
export type CryptoPrice = {
  usd: string;
  updatedAt: string;
  source: "CoinGecko";
};
export function rationalDecimal(value: string) {
  const match = /^(\d{1,40})(?:\.(\d{1,40}))?(?:[eE]([+-]?\d{1,2}))?$/.exec(
    value,
  );
  if (!match) throw new PortalError("INVALID_CRYPTO_PRICE", 502);
  const scale = (match[2]?.length ?? 0) - Number(match[3] ?? 0);
  if (Math.abs(scale) > 60) throw new PortalError("INVALID_CRYPTO_PRICE", 502);
  const numerator =
    BigInt(match[1] + (match[2] ?? "")) *
    (scale < 0 ? 10n ** BigInt(-scale) : 1n);
  const denominator = scale > 0 ? 10n ** BigInt(scale) : 1n;
  if (numerator <= 0n || numerator / denominator > 1000000000000n)
    throw new PortalError("INVALID_CRYPTO_PRICE", 502);
  return { numerator, denominator };
}
function gcd(a: bigint, b: bigint): bigint {
  return b ? gcd(b, a % b) : a;
}
// Node's JSON source context preserves numeric literals, including tiny prices,
// before IEEE-754 parsing can round them. An unavailable context fails closed.
export function parseCoinGeckoPrice(
  body: string,
  key: string,
  now = new Date(),
): CryptoPrice {
  const parse = JSON.parse as (
    text: string,
    reviver: (
      key: string,
      value: unknown,
      context?: { source?: string },
    ) => unknown,
  ) => Record<string, unknown>;
  const payload = parse(body, (_key, value, context) =>
    typeof value === "number" ? context?.source : value,
  );
  const price = payload[key] as
    { usd?: unknown; last_updated_at?: unknown } | undefined;
  if (
    !price ||
    typeof price.usd !== "string" ||
    typeof price.last_updated_at !== "string" ||
    !/^\d{1,12}$/.test(price.last_updated_at)
  )
    throw new PortalError("INVALID_CRYPTO_PRICE", 502);
  rationalDecimal(price.usd);
  const updated = Number(price.last_updated_at) * 1000;
  const maxAge = process.env.COINGECKO_API_PLAN === "pro" ? 120000 : 300000;
  if (updated > now.getTime() + 30000 || now.getTime() - updated > maxAge)
    throw new PortalError("CRYPTO_PRICE_STALE", 503);
  return {
    usd: price.usd,
    updatedAt: new Date(updated).toISOString(),
    source: "CoinGecko",
  };
}
// The CoinGecko key from the secret store, if there is a usable one. A key
// that can't be read, or that holds characters a header can't carry (a
// pasted line break, a second line), is left out with a warning, so prices
// fall back to the keyless API instead of every crypto checkout failing.
let warnedKey = "";
export async function coinGeckoKey(
  get: (ref: string) => Promise<string> = (ref) => secretManager.get(ref),
): Promise<string | undefined> {
  const ref = process.env.COINGECKO_API_KEY_REF;
  if (!ref) return undefined;
  let problem: string;
  try {
    const key = (await get(ref)).trim();
    if (/^[\x21-\x7e]{1,200}$/.test(key)) return key;
    problem = "holds characters an HTTP header can't carry; store it again as one line";
  } catch (e) {
    problem = `can't be read (${e instanceof Error ? e.message : String(e)})`;
  }
  if (warnedKey !== ref) {
    warnedKey = ref;
    console.error(`[coingecko] COINGECKO_API_KEY_REF ${problem}. Using the keyless API.`);
  }
  return undefined;
}

export async function coinGeckoPrices(
  assets: readonly CryptoAsset[],
  now = new Date(),
  http = providerRequest,
) {
  const pro = process.env.COINGECKO_API_PLAN === "pro";
  const key = await coinGeckoKey();
  if (pro && !key) throw new PortalError("COINGECKO_KEY_REQUIRED", 503);
  const base = pro
    ? "https://pro-api.coingecko.com"
    : "https://api.coingecko.com";
  const headers: Record<string, string> = {
    "User-Agent": "PayRouta/0.1 (+https://payrouta.com)",
    ...(key ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {}),
  };
  // IDs come only from the reviewed deployment registry, never a ticker search.
  // One batch also avoids a request per token on the public API.
  for (const a of assets) {
    const registered = quoteAsset(a.network, a.identifier);
    if (
      !registered ||
      registered.coinGeckoId !== a.coinGeckoId ||
      registered.contractAddress !== a.contractAddress ||
      registered.decimals !== a.decimals
    )
      throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  }
  const ids = [...new Set(assets.map((a) => a.coinGeckoId))];
  const get = async (path: string): Promise<ProviderHttpResponse> => {
    const response = await http(base, {
      method: "GET",
      path,
      headers,
      timeoutMs: 8000,
      maxResponseBytes: 65536,
    });
    if (response.status !== 200)
      throw new PortalError(
        response.status === 429
          ? "CRYPTO_PRICE_RATE_LIMITED"
          : "CRYPTO_PRICE_UNAVAILABLE",
        503,
      );
    return response;
  };
  const out: Record<string, CryptoPrice> = {};
  if (ids.length) {
    const response = await get(
      `/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_last_updated_at=true&precision=full`,
    );
    for (const id of ids) out[id] = parseCoinGeckoPrice(response.body, id, now);
  }
  return out;
}
export function cryptoPaymentTerms(
  a: CryptoAsset,
  usdAmount: string,
  price: CryptoPrice,
  environment: string,
  expiresAt: Date,
) {
  if (!/^(0|[1-9]\d{0,11})\.\d{2}$/.test(usdAmount))
    throw new PortalError("INVALID_USD_AMOUNT", 400);
  const cents = BigInt(usdAmount.replace(".", ""));
  if (cents <= 0n) throw new PortalError("INVALID_USD_AMOUNT", 400);
  const p = rationalDecimal(price.usd);
  const numerator = cents * p.denominator * 10n ** BigInt(a.decimals),
    denominator = 100n * p.numerator;
  const units = (numerator + denominator - 1n) / denominator;
  if (
    units <= 0n ||
    units >= 2n ** 256n ||
    units / 10n ** BigInt(a.decimals) >= 10n ** 29n
  )
    throw new PortalError("CRYPTO_AMOUNT_OUT_OF_RANGE", 409);
  const text = units.toString().padStart(a.decimals + 1, "0");
  const amount = a.decimals
    ? `${text.slice(0, -a.decimals)}.${text.slice(-a.decimals)}`
    : units.toString();
  if (!validPaymentAmount(a.network, a.identifier, amount))
    throw new PortalError("CRYPTO_AMOUNT_OUT_OF_RANGE", 409);
  const asset = {
    kind: "blockchain",
    network: a.network,
    identifier: a.identifier,
  };
  let n = p.numerator * 100n,
    d = p.denominator * 10n ** BigInt(a.decimals);
  const divisor = gcd(n, d);
  n /= divisor;
  d /= divisor;
  const feeSnapshot =
    environment === "sandbox"
      ? { version: pricingVersion, free: true, schedule: null }
      : {
          version: pricingVersion,
          free: false,
          schedule: feeScheduleSchema.parse({
            version: pricingVersion,
            asset: assetKey(asset),
            inputPrecision: a.decimals,
            currency: "USD",
            billingPrecision: 2,
            // PayRouta is the only processor for crypto: the direct rate
            // applies, valued in USD from this quote.
            conversionNumerator: n.toString(),
            conversionDenominator: d.toString(),
            validUntil: expiresAt.toISOString(),
            valuationReference: `coingecko:${a.coinGeckoId}:${price.updatedAt}`,
          }),
        };
  return {
    asset,
    settlement: asset,
    precision: a.decimals,
    amount,
    feeSnapshot,
    price,
  };
}
