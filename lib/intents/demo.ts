// The Intents-first demo checkout (app/checkout/demo): a store's checkout
// where the customer picks any token on any chain, or pastes any token's
// contract address, and the merchant chooses what it is paid in. Every
// price and route comes live from NEAR Intents (1Click dry quotes) and the
// DEX lookups the real checkout uses; nothing is paid, because a dry quote
// opens no deposit address.
//
// What the merchant receives, as in production:
//   stable  the invoice amount, exactly, in its settlement stablecoin, in
//           its own NEAR Intents account (checkout.ts)
//   token   that, then converted to any NEAR Intents token on any chain
//           with one signature and no gas (payouts.ts)
//   fiat    that, as USDC on Base, cashed out to a bank or mobile money
//           (lib/treasury/offramp, docs/cash-out.md)
import { z } from "zod";
import { PortalError } from "../portal/domain";
import { providerRequest } from "../providers/adapters/http";
import { chainNames, destinations, dryQuote, tokens, type Http, type OneClickToken } from "./oneclick";
import { findToken } from "./dex";

type Deps = { http?: Http; now?: Date };

// Cash-out currencies (docs/cash-out.md).
export const fiatPayouts = [
  { code: "USD", label: "US dollars to a US bank", partner: "Bridge" },
  { code: "EUR", label: "Euros to an IBAN (SEPA)", partner: "Bridge" },
  { code: "NGN", label: "Naira to a bank or mobile money", partner: "Yellow Card" },
  { code: "KES", label: "Kenyan shillings to M-Pesa or a bank", partner: "Yellow Card" },
  { code: "GHS", label: "Ghanaian cedi to a bank or mobile money", partner: "Yellow Card" },
  { code: "ZAR", label: "Rand to a bank", partner: "Yellow Card" },
  { code: "UGX", label: "Ugandan shillings to a bank or mobile money", partner: "Yellow Card" },
  { code: "TZS", label: "Tanzanian shillings to a bank or mobile money", partner: "Yellow Card" },
  { code: "ZMW", label: "Zambian kwacha to a bank or mobile money", partner: "Yellow Card" },
  { code: "MXN", label: "Mexican pesos to a bank", partner: "Yellow Card" },
] as const;

// Settlement for converted and fiat payouts: USDC on Base, what cash-out
// partners take.
const baseUsdc = destinations[0];

const chainName = (code: string) => chainNames[code] ?? code;
const price = (t: OneClickToken) => Number(t.price ?? 0);

export async function demoCatalog(deps: Deps = {}) {
  const list = await tokens(deps.http ?? providerRequest, (deps.now ?? new Date()).getTime());
  return {
    tokens: list
      .filter((t) => price(t) > 0)
      .map((t) => ({
        assetId: t.assetId,
        symbol: t.symbol,
        chain: t.blockchain,
        chainName: chainName(t.blockchain),
        price: price(t),
        decimals: t.decimals,
        contract: t.contractAddress ?? null,
      })),
    chains: new Set(list.map((t) => t.blockchain)).size,
    stablecoins: destinations.map((d) => ({ assetId: d.assetId, symbol: d.symbol, chain: d.blockchain, chainName: chainName(d.blockchain) })),
    fiat: fiatPayouts,
  };
}

const receive = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stable"), assetId: z.string().min(1).max(300) }).strict(),
  z.object({ kind: z.literal("token"), assetId: z.string().min(1).max(300) }).strict(),
  z.object({ kind: z.literal("fiat"), code: z.string().length(3) }).strict(),
]);
const usd = z.number().min(1).max(10000);
const quoteInput = z.object({ originAsset: z.string().min(1).max(300), receive, usd }).strict();
const dexInput = z
  .object({ chain: z.string().min(2).max(20), address: z.string().min(32).max(64), receive, usd })
  .strict();

const toUnits = (amount: number, decimals: number) => BigInt(Math.round(amount * 100)) * 10n ** BigInt(decimals) / 100n;
const deadline = (now: Date) => new Date(now.getTime() + 30 * 60000);

// What the merchant's account receives at checkout, and what happens next.
async function settlement(input: z.infer<typeof receive>, amountUsd: number, list: OneClickToken[], http: Http, now: Date) {
  const settle = input.kind === "stable" ? destinations.find((d) => d.assetId === input.assetId) : baseUsdc;
  if (!settle) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  const amountOut = toUnits(amountUsd, settle.decimals).toString();
  const deliver = { amount: amountUsd.toFixed(2), symbol: settle.symbol, chainName: chainName(settle.blockchain), assetId: settle.assetId };
  let convert: { amount: string; symbol: string; chainName: string } | null = null;
  let cashOut: { currency: string; label: string; partner: string } | null = null;
  if (input.kind === "token") {
    const target = list.find((t) => t.assetId === input.assetId);
    if (!target) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
    if (target.assetId !== settle.assetId) {
      const q = await dryQuote({ originAsset: settle.assetId, destinationAsset: target.assetId, amount: amountOut, exactInput: true, deadline: deadline(now) }, http);
      convert = { amount: significant(Number(q.quote.amountOutFormatted)), symbol: target.symbol, chainName: chainName(target.blockchain) };
    }
  }
  if (input.kind === "fiat") {
    const f = fiatPayouts.find((x) => x.code === input.code);
    if (!f) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
    cashOut = { currency: f.code, label: f.label, partner: f.partner };
  }
  return { settle, amountOut, deliver, convert, cashOut };
}

export async function demoQuote(raw: unknown, deps: Deps = {}) {
  const http = deps.http ?? providerRequest,
    now = deps.now ?? new Date();
  const input = quoteInput.parse(raw);
  const list = await tokens(http, now.getTime());
  const origin = list.find((t) => t.assetId === input.originAsset);
  if (!origin) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  const s = await settlement(input.receive, input.usd, list, http, now);
  const pay = { symbol: origin.symbol, chainName: chainName(origin.blockchain) };
  if (origin.assetId === s.settle.assetId)
    return { route: "direct", pay: { ...pay, amount: s.deliver.amount, usd: input.usd.toFixed(2) }, deliver: s.deliver, convert: s.convert, cashOut: s.cashOut, timeEstimate: 0 };
  const q = await dryQuote({ originAsset: origin.assetId, destinationAsset: s.settle.assetId, amount: s.amountOut, deadline: deadline(now) }, http);
  return {
    route: "intents",
    pay: { ...pay, amount: significant(Number(q.quote.amountInFormatted)), usd: q.quote.amountInUsd ?? null },
    deliver: { ...s.deliver, amount: Number(q.quote.amountOutFormatted).toFixed(2) },
    exact: q.quote.minAmountOut === undefined || q.quote.minAmountOut === q.quote.amountOut,
    convert: s.convert,
    cashOut: s.cashOut,
    timeEstimate: q.quote.timeEstimate ?? null,
  };
}

export async function demoLookup(address: string, deps: Deps = {}) {
  return findToken(z.string().min(32).max(64).parse(address), deps.http ?? providerRequest);
}

// A token found by its contract address: the wallet swaps it into USDC on
// its own chain (Jupiter on Solana, LI.FI on EVM chains), and that USDC is
// paid like any USDC, directly or through NEAR Intents.
export async function demoDexQuote(raw: unknown, deps: Deps = {}) {
  const http = deps.http ?? providerRequest,
    now = deps.now ?? new Date();
  const input = dexInput.parse(raw);
  const found = (await findToken(input.address, http)).tokens.find((t) => t.chain === input.chain);
  if (!found) throw new PortalError("DEX_NO_ROUTE", 409);
  const list = await tokens(http, now.getTime());
  const usdc = list.find((t) => t.blockchain === input.chain && t.symbol === "USDC");
  if (!usdc) throw new PortalError("DEX_NO_ROUTE", 409);
  const s = await settlement(input.receive, input.usd, list, http, now);
  let usdcNeeded = input.usd,
    timeEstimate: number | null = 0;
  if (usdc.assetId !== s.settle.assetId) {
    const q = await dryQuote({ originAsset: usdc.assetId, destinationAsset: s.settle.assetId, amount: s.amountOut, deadline: deadline(now) }, http);
    usdcNeeded = Number(q.quote.amountInFormatted);
    timeEstimate = q.quote.timeEstimate ?? null;
  }
  // 1% slippage headroom, as the real wallet swap sets.
  const amount = (usdcNeeded / found.price) * 1.01;
  return {
    route: "dex",
    pay: { symbol: found.symbol, name: found.name, chainName: found.chainName, amount: significant(amount), usd: (usdcNeeded * 1.01).toFixed(2) },
    via: { symbol: "USDC", chainName: chainName(input.chain), amount: usdcNeeded.toFixed(2), swapper: input.chain === "sol" ? "Jupiter" : "LI.FI" },
    direct: usdc.assetId === s.settle.assetId,
    deliver: s.deliver,
    convert: s.convert,
    cashOut: s.cashOut,
    timeEstimate,
  };
}

function significant(n: number) {
  if (n >= 1000) return n.toFixed(0);
  return Number(n.toPrecision(6)).toString();
}
