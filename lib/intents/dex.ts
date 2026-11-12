// Paying with any token that has DEX liquidity, found by its contract
// address (pay-picker.tsx), for example a coin launched on Pump.fun. The
// customer's wallet swaps it into USDC on the same chain, and only an exact
// USDC payment, one the checkout already takes, pays the merchant. The swap
// has to succeed first:
//
//   Solana  one transaction: Jupiter swaps an exact input into the
//           customer's own USDC with a minimum output of at least the
//           payment amount, then the same transaction transfers exactly the
//           payment amount. A swap that returns less fails the transaction,
//           and nothing is paid.
//   EVM     LI.FI swaps into the customer's own USDC; the wallet sends the
//           exact USDC payment only once that swap is confirmed and the
//           USDC is in the wallet (swap-wallet.ts).
//
// The USDC goes where any USDC payment for this checkout goes: the
// merchant's receive address when they take USDC on that chain, otherwise
// the deposit address of a NEAR Intents swap into what they settle in. The
// payment is confirmed exactly as for any USDC payment.
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { z } from "zod";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { authorizeSession } from "../payments/service";
import { minor } from "../payments/contracts";
import { providerRequest } from "../providers/adapters/http";
import { paymentAsset } from "../blockchain/crypto-assets";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "../blockchain/solana-token";
import { chainNames, tokens, type Http } from "./oneclick";
import { evmChainIds } from "./checkout";
import { solanaRpc } from "./swap-wallet";
import { tokenLogo } from "./logo-paths";

const jupiter = "https://lite-api.jup.ag";
const lifi = "https://li.quest";
// LI.FI's contract on every EVM chain it serves: approvals and swaps go
// nowhere else, whatever its API answers.
export const lifiDiamond = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const usdcMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// EVM chains with a USDC payment route, by NEAR Intents chain code.
export const dexEvmChains = ["eth", "base", "arb", "op", "pol", "avax", "bsc"] as const;
// The swap may cost the customer at most this much of its value, and the
// token's pool must be this many times the payment.
const maxImpact = 0.15;
const minLiquidityMultiple = 3;
const slippageBps = 100;

type Deps = { http?: Http; now?: Date };

const json = async <T>(http: Http, base: string, path: string, schema: z.ZodType<T>, body?: unknown) => {
  const r = await http(base, {
    method: body ? "POST" : "GET",
    path,
    ...(body ? { body: JSON.stringify(body) } : {}),
    timeoutMs: 15000,
    maxResponseBytes: 2097152,
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.body);
  } catch {
    throw new PortalError("DEX_UNAVAILABLE", 503);
  }
  if (r.status === 429) throw new PortalError("DEX_RATE_LIMITED", 503);
  const errorCode = (parsed as { errorCode?: string; code?: number })?.errorCode;
  if (errorCode === "NO_ROUTES_FOUND" || errorCode === "COULD_NOT_FIND_ANY_ROUTE" || r.status === 404) throw new PortalError("DEX_NO_ROUTE", 409);
  if (r.status !== 200) throw new PortalError(r.status === 400 ? "DEX_NO_ROUTE" : "DEX_UNAVAILABLE", r.status === 400 ? 409 : 503);
  const ok = schema.safeParse(parsed);
  if (!ok.success) throw new PortalError("DEX_UNAVAILABLE", 503);
  return ok.data;
};

const isSolanaAddress = (a: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a);
const isEvmAddress = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a);

const jupiterToken = z
  .object({
    id: z.string(),
    name: z.string().max(200),
    symbol: z.string().max(40),
    decimals: z.number().int().min(0).max(18),
    usdPrice: z.number().positive().optional(),
    liquidity: z.number().nonnegative().optional(),
    tokenProgram: z.string().optional(),
    icon: z.string().max(2000).optional().nullable(),
  })
  .passthrough();
const lifiToken = z
  .object({
    address: z.string(),
    symbol: z.string().max(40),
    name: z.string().max(200),
    decimals: z.number().int().min(0).max(36),
    priceUSD: z.string(),
    logoURI: z.string().max(2000).optional().nullable(),
  })
  .passthrough();

export type DexToken = { chain: string; chainName: string; address: string; symbol: string; name: string; decimals: number; price: number; liquidity?: number; logo?: string };

async function solanaToken(http: Http, mint: string) {
  const list = await json(http, jupiter, `/tokens/v2/search?query=${mint}`, z.array(jupiterToken).max(50));
  return list.find((t) => t.id === mint);
}

// "Load a token" by its address: on Solana from Jupiter, on EVM chains from
// LI.FI. A coin can exist on several EVM chains under one address.
export async function lookupToken(sessionId: string, token: string, address: string, deps: Deps = {}): Promise<{ tokens: DexToken[] }> {
  await authorizeSession(sessionId, token, deps.now ?? new Date(), true);
  return findToken(address, deps);
}
// The lookup itself, for any checkout including the demo (demo-checkout.ts).
export async function findToken(address: string, deps: Deps = {}): Promise<{ tokens: DexToken[] }> {
  const http = deps.http ?? providerRequest;
  const a = address.trim();
  if (isSolanaAddress(a)) {
    if (a === usdcMint) return { tokens: [] };
    const t = await solanaToken(http, a);
    return {
      tokens:
        t && t.usdPrice
          ? [{ chain: "sol", chainName: "Solana", address: t.id, symbol: t.symbol, name: t.name, decimals: t.decimals, price: t.usdPrice, liquidity: t.liquidity, logo: tokenLogo("sol", t.id) }]
          : [],
    };
  }
  if (!isEvmAddress(a)) throw new PortalError("DEX_ADDRESS_INVALID", 400);
  const found = await Promise.all(
    dexEvmChains.map(async (chain) => {
      try {
        const t = await json(http, lifi, `/v1/token?chain=${evmChainIds[chain]}&token=${a}`, lifiToken);
        const price = Number(t.priceUSD);
        if (!(price > 0) || t.symbol === "USDC") return null;
        return { chain, chainName: chainNames[chain] ?? chain, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, price, logo: tokenLogo(chain, t.address) };
      } catch {
        return null;
      }
    }),
  );
  return { tokens: found.filter((t): t is NonNullable<typeof t> => !!t) };
}

// A token's icon as Jupiter (Solana) or LI.FI (EVM) lists it, for its logo
// in checkout (token-logos.ts), or null when it has none.
export async function dexTokenIcon(chain: string, address: string, http: Http = providerRequest) {
  if (chain === "sol") return isSolanaAddress(address) ? ((await solanaToken(http, address))?.icon ?? null) : null;
  if (!(dexEvmChains as readonly string[]).includes(chain) || !isEvmAddress(address)) return null;
  try {
    return (await json(http, lifi, `/v1/token?chain=${evmChainIds[chain]}&token=${address}`, lifiToken)).logoURI ?? null;
  } catch (e) {
    // LI.FI answers 404 for a token it doesn't know.
    if (e instanceof PortalError && e.message === "DEX_NO_ROUTE") return null;
    throw e;
  }
}

// Where this checkout's USDC on a chain goes, and exactly how much: the
// merchant's receive address for a USDC payment there, or the deposit
// address of the NEAR Intents swap the customer just quoted from USDC.
export async function usdcLeg(intentId: string, chain: string, http: Http, now: Date) {
  const attempt = await db.paymentAttempt.findFirst({ where: { intentId }, orderBy: { number: "desc" } });
  if (!attempt || attempt.state !== "Requires action") throw new PortalError("PAYMENT_NOT_AWAITING_TRANSFER", 409);
  const action = attempt.action as { kind?: string; address?: string; network?: string; identifier?: string; amount?: string } | null;
  if (action?.kind === "deposit" && action.address && action.network && action.identifier && action.amount) {
    const token = paymentAsset(action.network, action.identifier);
    const code = action.network === "solana:mainnet" ? "sol" : Object.entries(evmChainIds).find(([, id]) => `eip155:${id}` === action.network)?.[0];
    if (token?.symbol === "USDC" && code === chain)
      return {
        to: action.address,
        amount: minor(action.amount, token.decimals),
        token: action.identifier.slice(action.identifier.indexOf(":") + 1),
        decimals: token.decimals,
      };
  }
  const swap = await db.crossChainPayment.findFirst({ where: { intentId }, orderBy: { createdAt: "desc" } });
  if (swap && swap.status === "PENDING_DEPOSIT" && swap.fundedBy !== "INTENTS" && swap.deadline > now && swap.originChain === chain) {
    const origin = (await tokens(http, now.getTime())).find((t) => t.assetId === swap.originAsset);
    if (origin?.symbol === "USDC" && origin.contractAddress && !swap.depositMemo)
      return { to: swap.depositAddress, amount: BigInt(swap.amountIn), token: origin.contractAddress, decimals: origin.decimals };
  }
  throw new PortalError("DEX_NO_USDC_ROUTE", 409);
}

// How much of the token to sell so the swap's minimum output still covers
// the payment: first from its price, then corrected by the first quote.
export function inputFor(target: bigint, targetDecimals: number, price: number, decimals: number) {
  const usd = Number(target) / 10 ** targetDecimals;
  const units = (usd / price) * 1.03 * 10 ** decimals;
  if (!Number.isFinite(units) || units < 1) throw new PortalError("DEX_NO_ROUTE", 409);
  return BigInt(Math.ceil(units));
}
export const scaled = (amount: bigint, target: bigint, minOut: bigint) =>
  (amount * target * 1005n) / (minOut > 0n ? minOut * 1000n : 1n) + 1n;

const jupiterQuote = z
  .object({
    inAmount: z.string().regex(/^\d+$/),
    outAmount: z.string().regex(/^\d+$/),
    otherAmountThreshold: z.string().regex(/^\d+$/),
    swapMode: z.literal("ExactIn"),
    priceImpactPct: z.string(),
  })
  .passthrough();
const instruction = z.object({
  programId: z.string(),
  accounts: z.array(z.object({ pubkey: z.string(), isSigner: z.boolean(), isWritable: z.boolean() })),
  data: z.string(),
});
const swapInstructions = z
  .object({
    computeBudgetInstructions: z.array(instruction).default([]),
    setupInstructions: z.array(instruction).default([]),
    swapInstruction: instruction,
    cleanupInstruction: instruction.nullable().optional(),
    otherInstructions: z.array(instruction).default([]),
    addressLookupTableAddresses: z.array(z.string()).default([]),
    computeUnitLimit: z.number().int().positive().optional(),
    simulationError: z.unknown().optional(),
  })
  .passthrough();

const toInstruction = (i: z.infer<typeof instruction>) =>
  new TransactionInstruction({
    programId: new PublicKey(i.programId),
    keys: i.accounts.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
    data: Buffer.from(i.data, "base64"),
  });

function guard(liquidity: number | undefined, targetUsd: number, impact: number) {
  if (liquidity !== undefined && liquidity < targetUsd * minLiquidityMultiple) throw new PortalError("DEX_LIQUIDITY_TOO_LOW", 409);
  if (!(impact <= maxImpact)) throw new PortalError("DEX_PRICE_IMPACT_TOO_HIGH", 409);
}

// The Solana transaction: compute budget, Jupiter's swap into the
// customer's USDC (minimum output at least the payment), then exactly the
// payment in USDC to where it goes.
export async function dexSolanaTransaction(sessionId: string, token: string, input: { payer: string; mint: string }, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const http = deps.http ?? providerRequest;
  const { intent } = await authorizeSession(sessionId, token, now);
  if (!isSolanaAddress(input.payer) || !isSolanaAddress(input.mint) || input.mint === usdcMint) throw new PortalError("DEX_ADDRESS_INVALID", 400);
  const leg = await usdcLeg(intent.id, "sol", http, now);
  if (leg.token !== usdcMint) throw new PortalError("DEX_NO_USDC_ROUTE", 409);
  const info = await solanaToken(http, input.mint);
  if (!info?.usdPrice) throw new PortalError("DEX_NO_ROUTE", 409);
  const quoteFor = (amount: bigint) =>
    json(
      http,
      jupiter,
      `/swap/v1/quote?inputMint=${input.mint}&outputMint=${usdcMint}&amount=${amount}&slippageBps=${slippageBps}&swapMode=ExactIn`,
      jupiterQuote,
    );
  let q = await quoteFor(inputFor(leg.amount, leg.decimals, info.usdPrice, info.decimals));
  if (BigInt(q.otherAmountThreshold) < leg.amount) q = await quoteFor(scaled(BigInt(q.inAmount), leg.amount, BigInt(q.otherAmountThreshold)));
  // The guard: the swap's own minimum output covers the payment.
  if (BigInt(q.otherAmountThreshold) < leg.amount) throw new PortalError("DEX_NO_ROUTE", 409);
  guard(info.liquidity, Number(leg.amount) / 10 ** leg.decimals, Number(q.priceImpactPct));
  const built = await json(http, jupiter, "/swap/v1/swap-instructions", swapInstructions, {
    quoteResponse: q,
    userPublicKey: input.payer,
    wrapAndUnwrapSol: true,
    dynamicComputeUnitLimit: true,
  });
  if (built.simulationError) throw new PortalError("DEX_SWAP_WOULD_FAIL", 409);
  const payer = new PublicKey(input.payer);
  const mint = new PublicKey(usdcMint);
  const to = new PublicKey(leg.to);
  const from = getAssociatedTokenAddressSync(mint, payer, TOKEN_PROGRAM_ID);
  const destination = getAssociatedTokenAddressSync(mint, to, TOKEN_PROGRAM_ID);
  const instructions = [
    // Jupiter's limit, with room for the payment transfer after it.
    ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(1_400_000, (built.computeUnitLimit ?? 1_200_000) + 80_000) }),
    ...built.computeBudgetInstructions.filter((i) => Buffer.from(i.data, "base64")[0] !== 2).map(toInstruction),
    ...built.setupInstructions.map(toInstruction),
    createAssociatedTokenAccountIdempotentInstruction(payer, from, payer, mint),
    toInstruction(built.swapInstruction),
    ...(built.cleanupInstruction ? [toInstruction(built.cleanupInstruction)] : []),
    ...built.otherInstructions.map(toInstruction),
    createAssociatedTokenAccountIdempotentInstruction(payer, destination, to, mint),
    createTransferCheckedInstruction(from, mint, destination, payer, leg.amount, leg.decimals),
  ];
  const tables = built.addressLookupTableAddresses.length
    ? await solanaRpc(
        http,
        "getMultipleAccounts",
        [built.addressLookupTableAddresses, { encoding: "base64", commitment: "confirmed" }],
        z.object({ value: z.array(z.object({ data: z.tuple([z.string(), z.literal("base64")]) }).nullable()) }),
      )
    : { value: [] };
  const lookups = built.addressLookupTableAddresses.map((key, i) => {
    const account = tables.value[i];
    if (!account) throw new PortalError("DEX_UNAVAILABLE", 503);
    return new AddressLookupTableAccount({ key: new PublicKey(key), state: AddressLookupTableAccount.deserialize(Buffer.from(account.data[0], "base64")) });
  });
  const { value } = await solanaRpc(
    http,
    "getLatestBlockhash",
    [{ commitment: "confirmed" }],
    z.object({ value: z.object({ blockhash: z.string().min(32).max(64) }) }),
  );
  let unsigned: string;
  try {
    const message = new TransactionMessage({ payerKey: payer, recentBlockhash: value.blockhash, instructions }).compileToV0Message(lookups);
    unsigned = Buffer.from(new VersionedTransaction(message).serialize()).toString("base64");
  } catch {
    // Over Solana's transaction size: the route is too long to add the payment.
    throw new PortalError("DEX_ROUTE_TOO_LARGE", 409);
  }
  return {
    unsigned,
    payer: input.payer,
    sell: { amount: q.inAmount, decimals: info.decimals, symbol: info.symbol },
    pay: { amount: leg.amount.toString(), decimals: leg.decimals, symbol: "USDC" },
    priceImpact: Number(q.priceImpactPct),
  };
}

const lifiQuote = z
  .object({
    action: z.object({ fromAddress: z.string(), toAddress: z.string().optional(), fromChainId: z.number(), toChainId: z.number() }).passthrough(),
    estimate: z
      .object({
        fromAmount: z.string().regex(/^\d+$/),
        toAmountMin: z.string().regex(/^\d+$/),
        approvalAddress: z.string(),
        fromAmountUSD: z.string().optional(),
        toAmountUSD: z.string().optional(),
      })
      .passthrough(),
    transactionRequest: z
      .object({
        to: z.string(),
        data: z.string().regex(/^0x[0-9a-fA-F]*$/),
        value: z.string().regex(/^0x[0-9a-fA-F]+$/),
        chainId: z.number(),
        gasLimit: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

// An EVM swap into the customer's own USDC, and the exact USDC payment the
// wallet sends once the swap has succeeded.
export async function dexEvmQuote(sessionId: string, token: string, input: { payer: string; chain: string; address: string }, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const http = deps.http ?? providerRequest;
  const { intent } = await authorizeSession(sessionId, token, now);
  const chainId = (dexEvmChains as readonly string[]).includes(input.chain) ? evmChainIds[input.chain] : undefined;
  if (!chainId || !isEvmAddress(input.payer) || !isEvmAddress(input.address)) throw new PortalError("DEX_ADDRESS_INVALID", 400);
  const leg = await usdcLeg(intent.id, input.chain, http, now);
  if (input.address.toLowerCase() === leg.token.toLowerCase()) throw new PortalError("DEX_ADDRESS_INVALID", 400);
  const info = await json(http, lifi, `/v1/token?chain=${chainId}&token=${input.address}`, lifiToken);
  const price = Number(info.priceUSD);
  if (!(price > 0)) throw new PortalError("DEX_NO_ROUTE", 409);
  const quoteFor = (amount: bigint) =>
    json(
      http,
      lifi,
      `/v1/quote?fromChain=${chainId}&toChain=${chainId}&fromToken=${input.address}&toToken=${leg.token}&fromAmount=${amount}&fromAddress=${input.payer}&toAddress=${input.payer}&slippage=${slippageBps / 10000}`,
      lifiQuote,
    );
  let q = await quoteFor(inputFor(leg.amount, leg.decimals, price, info.decimals));
  if (BigInt(q.estimate.toAmountMin) < leg.amount) q = await quoteFor(scaled(BigInt(q.estimate.fromAmount), leg.amount, BigInt(q.estimate.toAmountMin)));
  if (BigInt(q.estimate.toAmountMin) < leg.amount) throw new PortalError("DEX_NO_ROUTE", 409);
  const inUsd = Number(q.estimate.fromAmountUSD ?? 0),
    outUsd = Number(q.estimate.toAmountUSD ?? 0);
  guard(undefined, Number(leg.amount) / 10 ** leg.decimals, inUsd > 0 && outUsd > 0 ? Math.max(0, 1 - outUsd / inUsd) : 0);
  // Only LI.FI's own contract, on this chain, from and to this wallet.
  if (
    q.transactionRequest.to.toLowerCase() !== lifiDiamond ||
    q.estimate.approvalAddress.toLowerCase() !== lifiDiamond ||
    q.transactionRequest.chainId !== chainId ||
    q.action.fromAddress.toLowerCase() !== input.payer.toLowerCase() ||
    (q.action.toAddress ?? input.payer).toLowerCase() !== input.payer.toLowerCase()
  )
    throw new PortalError("DEX_ROUTE_UNEXPECTED", 502);
  return {
    chainId,
    chainName: chainNames[input.chain] ?? input.chain,
    sell: { token: info.address, amount: q.estimate.fromAmount, decimals: info.decimals, symbol: info.symbol },
    swap: { to: q.transactionRequest.to, data: q.transactionRequest.data, value: q.transactionRequest.value },
    // Sent only after the swap: exactly the payment, in USDC.
    pay: { token: leg.token, amount: leg.amount.toString(), to: leg.to, decimals: leg.decimals },
  };
}
