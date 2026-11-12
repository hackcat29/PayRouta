// Logos for the crypto checkout's tokens and chains, fetched once, kept in
// the database for good (logos don't change) and served from PayRouta
// (/api/logos/...), so a customer's browser never loads a third-party image.
//
//   coin:<id>             a token NEAR Intents lists, from CoinGecko by the
//                         id NEAR Intents gives it
//   chain:<code>          a chain: its CoinGecko asset platform's image where
//                         it has one (Base, Arbitrum...), else its coin's
//   token:<chain>-<addr>  a token found by its contract address: the icon
//                         Jupiter or LI.FI lists for it (dex.ts)
//
// CoinGecko logos are fetched only by the worker, never while a customer
// waits, so they can't use up the allowance checkout prices need. A pasted
// token's logo is fetched the first time it's shown. Only PNG, JPEG and WebP
// up to 256 KB are kept (CoinGecko's from its own image hosts). A logo that
// can't be found is remembered as missing for a week; the checkout shows
// the token's generated mark meanwhile.
import { db } from "../portal/db";
import { coinGeckoKey } from "../payments/crypto-prices";
import { rateLimit } from "../portal/access";
import { logoType } from "../merchant/branding";
import { providerRequest } from "../providers/adapters/http";
import { tokens, type Http } from "./oneclick";
import { dexTokenIcon } from "./dex";
import { logoKey } from "./logo-paths";

export { logoKey, coinLogo, chainLogo, tokenLogo } from "./logo-paths";

const week = 7 * 86400000;
const maxBytes = 256 * 1024;
const imageHosts = new Set(["coin-images.coingecko.com", "assets.coingecko.com"]);


// CoinGecko asset platforms for chains whose own mark isn't their gas coin's.
const platforms: Record<string, string> = {
  base: "base",
  arb: "arbitrum-one",
  op: "optimistic-ethereum",
  pol: "polygon-pos",
  bsc: "binance-smart-chain",
  avax: "avalanche",
  gnosis: "xdai",
  scroll: "scroll",
  bera: "berachain",
  xlayer: "x-layer",
  abs: "abstract",
  monad: "monad",
  plasma: "plasma",
  starknet: "starknet",
  hlevm: "hyperevm",
  hood: "robinhood-chain",
  eth: "ethereum",
};
// Chains whose mark is their coin's, where NEAR Intents' list has no native
// entry to take it from.
const chainCoins: Record<string, string> = {
  btc: "bitcoin",
  sol: "solana",
  tron: "tron",
  ton: "the-open-network",
  near: "near",
  sui: "sui",
  aptos: "aptos",
  stellar: "stellar",
  xrp: "ripple",
  doge: "dogecoin",
  ltc: "litecoin",
  bch: "bitcoin-cash",
  zec: "zcash",
  cardano: "cardano",
  dash: "dash",
  hypercore: "hyperliquid",
  aleo: "aleo",
  movement: "movement",
};

async function coinGecko(path: string, http: Http) {
  const pro = process.env.COINGECKO_API_PLAN === "pro";
  const key = await coinGeckoKey();
  return http(pro ? "https://pro-api.coingecko.com" : "https://api.coingecko.com", {
    method: "GET",
    path,
    headers: {
      "User-Agent": "PayRouta/0.1 (+https://payrouta.com)",
      ...(key ? { [pro ? "x-cg-pro-api-key" : "x-cg-demo-api-key"]: key } : {}),
    },
    timeoutMs: 10000,
    maxResponseBytes: 1048576,
  });
}

let platformImages: { at: number; images: Map<string, string> } | null = null;
async function platformImage(id: string, http: Http) {
  if (!platformImages || Date.now() - platformImages.at > week) {
    const r = await coinGecko("/api/v3/asset_platforms", http);
    if (r.status !== 200) throw new Error(`asset_platforms ${r.status}`);
    const list = JSON.parse(r.body) as { id: string; image?: { small?: string; large?: string; thumb?: string } }[];
    platformImages = { at: Date.now(), images: new Map(list.flatMap((p) => (p.image?.small || p.image?.large ? [[p.id, (p.image.small || p.image.large)!]] : []))) };
  }
  return platformImages.images.get(id) ?? null;
}

async function coinImage(id: string, http: Http) {
  const r = await coinGecko(
    `/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
    http,
  );
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`coins ${r.status}`);
  const coin = JSON.parse(r.body) as { image?: { small?: string; large?: string } };
  return coin.image?.small || coin.image?.large || null;
}

// The image's URL on CoinGecko for a key, or null when it has none.
async function imageUrl(key: string, http: Http): Promise<string | null> {
  const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "coin") return coinImage(id, http);
  if (kind === "token") return dexTokenIcon(id.slice(0, id.indexOf("-")), id.slice(id.indexOf("-") + 1), http);
  if (platforms[id]) {
    const image = await platformImage(platforms[id], http);
    if (image) return image;
  }
  if (chainCoins[id]) return coinImage(chainCoins[id], http);
  // The chain's own coin in NEAR Intents' list: the token without a contract.
  // (Never ETH: a rollup whose gas is ETH isn't Ethereum, so it keeps the
  // generated mark rather than borrow Ethereum's.)
  const native = (await tokens(http, Date.now())).find((t) => t.blockchain === id && !t.contractAddress && t.coingeckoId);
  const coinId = native?.coingeckoId ?? undefined;
  return coinId && coinId !== "ethereum" && /^[a-z0-9-]{1,100}$/.test(coinId) ? coinImage(coinId, http) : null;
}

// CoinGecko's logos only from its own image hosts; a pasted token's from
// wherever Jupiter or LI.FI points (often Arweave or IPFS gateways, which
// redirect). Each hop goes through providerRequest, which refuses private
// and internal addresses; at most three redirects.
async function download(url: string, http: Http, anyHost: boolean) {
  let next = url;
  for (let hop = 0; hop < 4; hop++) {
    let u: URL;
    try {
      u = new URL(next);
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || u.username || u.password || (!anyHost && !imageHosts.has(u.hostname))) return null;
    const r = await http(u.origin, { method: "GET", path: `${u.pathname}${u.search}`, headers: { Accept: "image/*" }, maxResponseBytes: maxBytes, redirects: "return" });
    const location = r.headers.location;
    if ([301, 302, 303, 307, 308].includes(r.status) && location) {
      next = new URL(location, u).toString();
      continue;
    }
    if (r.status !== 200 || !r.buffer) return null;
    const mime = logoType(new Uint8Array(r.buffer));
    return mime ? { mime, bytes: new Uint8Array(r.buffer) } : null;
  }
  return null;
}

// Fetches and stores one logo. Returns whether one was found.
export async function fetchLogo(key: string, http: Http = providerRequest) {
  if (!logoKey.test(key)) return false;
  const url = await imageUrl(key, http);
  const image = url ? await download(url, http, key.startsWith("token:")) : null;
  await db.tokenLogo.upsert({
    where: { key },
    create: { key, mime: image?.mime ?? null, bytes: image ? image.bytes : null, missing: !image, fetchedAt: new Date() },
    update: { mime: image?.mime ?? null, bytes: image ? image.bytes : null, missing: !image, fetchedAt: new Date() },
  });
  return !!image;
}

// A stored logo, from memory after its first read. A pasted token's logo is
// fetched the first time it's asked for (shared budget, a few a minute);
// CoinGecko logos only ever come from the worker (warmLogos).
const served = new Map<string, { mime: string; bytes: Uint8Array }>();
export async function logo(key: string, http: Http = providerRequest) {
  if (!logoKey.test(key)) return null;
  const known = served.get(key);
  if (known) return known;
  let stored = await db.tokenLogo.findUnique({ where: { key } });
  const fresh = stored?.missing && Date.now() - stored.fetchedAt.getTime() < week;
  if (key.startsWith("token:") && !stored?.bytes && !fresh) {
    try {
      await rateLimit("token-logo-fetch", 20);
      await fetchLogo(key, http);
    } catch {
      return null;
    }
    stored = await db.tokenLogo.findUnique({ where: { key } });
  }
  if (!stored?.bytes || !stored.mime) return null;
  const found = { mime: stored.mime, bytes: new Uint8Array(stored.bytes) };
  if (served.size >= 2000) served.delete(served.keys().next().value!);
  served.set(key, found);
  return found;
}

// Fetches the CoinGecko logos not stored yet, a few at a time: every token
// and chain in NEAR Intents' list (worker sweep, and `npm run logos:warm`).
// Paced to leave most of CoinGecko's allowance to checkout prices: about
// 15 a minute with an API key (30 allowed), 2 without.
const keyed = () => !!process.env.COINGECKO_API_KEY_REF;
export async function warmLogos(limit = keyed() ? 20 : 6, http: Http = providerRequest, pauseMs = keyed() ? 4000 : 8000) {
  const list = await tokens(http, Date.now());
  const keys = [
    ...new Set([
      ...list.map((t) => t.blockchain).map((c) => `chain:${c}`),
      ...list.flatMap((t) => (t.coingeckoId && /^[a-z0-9-]{1,100}$/.test(t.coingeckoId) ? [`coin:${t.coingeckoId}`] : [])),
    ]),
  ].filter((k) => logoKey.test(k));
  const known = await db.tokenLogo.findMany({ where: { key: { in: keys } }, select: { key: true, missing: true, fetchedAt: true } });
  const done = new Set(known.filter((k) => !k.missing || Date.now() - k.fetchedAt.getTime() < week).map((k) => k.key));
  const todo = keys.filter((k) => !done.has(k)).slice(0, limit);
  let found = 0;
  let checked = 0;
  for (const key of todo) {
    try {
      if (await fetchLogo(key, http)) found++;
      checked++;
    } catch {
      // Rate limited or unavailable: the next sweep tries again.
      break;
    }
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return { checked, found, remaining: keys.filter((k) => !done.has(k)).length - checked };
}
