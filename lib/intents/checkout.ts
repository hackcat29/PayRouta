// "Pay from another chain or token" in the crypto checkout (docs/cross-chain.md).
//
// Once a crypto checkout shows its deposit instructions (exact amount of the
// merchant's stablecoin to the merchant's receive address for this attempt),
// the customer may instead pay with any token 1Click supports, on any of its
// chains. PayRouta asks for an exact-output quote to that same receive
// address and shows the one-time deposit address and amount. Nothing else
// changes: the payment is confirmed only when the existing on-chain checks
// see the exact transfer to the receive address before the quote deadline.
//
// When the merchant settles into a NEAR Intents account (action kind
// `intents`), this is the only way to pay: the quote delivers into that
// account instead, any token including the invoice token itself is accepted,
// and the settlement adapter (near-intents-deposit) confirms the delivery
// from the swap's intents.near events.
//
// On for production checkouts (1Click has no testnet, and sandbox never moves
// real money). CROSS_CHAIN_PAYMENTS=off is the kill switch.
import { db } from "../portal/db";
import { json } from "../portal/service";
import { PortalError } from "../portal/domain";
import { authorizeSession, checkoutOptions, refreshAttempt } from "../payments/service";
import { minor } from "../payments/contracts";
import { directFeeInAsset } from "../payments/pricing";
import { stablecoinCandidates } from "../payments/stablecoin-routes";
import { chain as registeredChain, networkName } from "../blockchain/chains";
import { paymentAsset, onchainMethod } from "../blockchain/crypto-assets";
import { z } from "zod";
import { chainNames, destinationFor, generateIntent, quote, status, submitIntent, tokens, type GeneratedIntent, type Http } from "./oneclick";
import { intentsAccount, solanaOwner } from "./near";
import { evmChainIds } from "./evm-chains";
import { checkFundingIntent } from "./payouts";
import { chainLogo, coinLogo } from "./logo-paths";
import { ed25519Signature, secp256k1Signature, type SignedIntent } from "./signing";
import { erc191Signer, verifyNep413 } from "./verify";
import { providerRequest } from "../providers/adapters/http";
import { merchantMember } from "../merchant/access";
import { Prisma } from "../generated/prisma/client";

export const crossChainEnabled = () => process.env.CROSS_CHAIN_PAYMENTS !== "off";
const provider = "near-intents";
// The swap must be able to land well before the checkout's deadline.
const minimumWindowMs = 5 * 60000;
const deadlineMarginMs = 90000;

type Deps = { http?: Http; now?: Date; enabled?: boolean };

// PayRouta's own NEAR Intents account, paid its fee at source on checkouts
// that settle through NEAR Intents: a NEAR account, an EVM address, or a
// Solana address (its account is the key in hex). The fee is held for it in
// intents.near, withdrawn by signing with that wallet. Unset: the fee is
// billed on the monthly statement instead.
export function feeAccount() {
  const raw = process.env.PAYROUTA_INTENTS_FEE_ACCOUNT?.trim();
  return raw ? (intentsAccount(raw)?.accountId ?? solanaOwner(raw)?.accountId ?? null) : null;
}

// What the merchant's account receives and what 1Click withholds for
// PayRouta: the invoice less PayRouta's fee, the fee as a share of the
// amount in. The rate in basis points is rounded to the nearest whole one.
function withheld(
  intent: { feeSnapshot: unknown; selectedMethod: string | null; amount: string; precision: number },
  gross: bigint,
  decimals: number,
) {
  const recipient = feeAccount();
  if (!recipient || !intent.feeSnapshot || !intent.selectedMethod) return null;
  // The fee in the price's units, then in the delivered token's (a stablecoin
  // at par with the price, possibly with other decimals).
  const priced = directFeeInAsset(intent.feeSnapshot, intent.selectedMethod, intent.amount, intent.precision);
  const fee =
    decimals >= intent.precision ? priced * 10n ** BigInt(decimals - intent.precision) : priced / 10n ** BigInt(intent.precision - decimals);
  if (fee <= 0n || fee >= gross) return null;
  const bps = Number((fee * 10000n * 2n + gross) / (gross * 2n));
  return bps > 0 ? { recipient, bps, fee } : null;
}

// What a checkout delivers: the registered stablecoin, or for settlement to
// an address the merchant's chosen token from the 1Click list.
function deliveredAsset(
  scope: { destination: { assetId: string; decimals: number; symbol: string; contract: string }; destinationAsset: string | null },
  list: Awaited<ReturnType<typeof tokens>>,
) {
  if (!scope.destinationAsset) return scope.destination;
  const t = list.find((x) => x.assetId === scope.destinationAsset);
  return t ? { assetId: t.assetId, decimals: t.decimals, symbol: t.symbol, contract: t.contractAddress ?? "" } : null;
}

async function awaitingDeposit(sessionId: string, token: string, now: Date) {
  const { intent } = await authorizeSession(sessionId, token, now);
  const attempt = await db.paymentAttempt.findFirst({ where: { intentId: intent.id }, orderBy: { number: "desc" } });
  const action = attempt?.action as {
    kind?: string;
    settle?: string;
    destinationAsset?: string;
    address?: string;
    network?: string;
    identifier?: string;
    amount?: string;
  } | null;
  if (
    !attempt ||
    attempt.state !== "Requires action" ||
    (action?.kind !== "deposit" && action?.kind !== "intents") ||
    !action.address ||
    !action.network ||
    !action.identifier ||
    !action.amount
  )
    return { intent, attempt: null, reason: "CROSS_CHAIN_NO_TRANSFER_AWAITED" } as const;
  const destination = destinationFor(action.network, action.identifier);
  if (!destination) return { intent, attempt: null, reason: "CROSS_CHAIN_ASSET_NOT_SUPPORTED" } as const;
  if (intent.environment !== "production") return { intent, attempt: null, reason: "CROSS_CHAIN_LIVE_ONLY" } as const;
  if (intent.expiresAt.getTime() - now.getTime() < minimumWindowMs)
    return { intent, attempt: null, reason: "CROSS_CHAIN_TOO_LATE" } as const;
  return {
    intent,
    attempt,
    action: { ...action, address: action.address, amount: action.amount },
    destination,
    // Into the merchant's intents account, or delivered on chain: to their
    // bank's funding address, or to an address of theirs on any chain (in
    // the stablecoin `destinationAsset`, from the 1Click token list).
    intoIntents: action.kind === "intents" && !action.settle,
    toBank: action.kind === "intents" && action.settle === "bank",
    toAddress: action.kind === "intents" && action.settle === "address",
    destinationAsset: action.settle === "address" ? (action.destinationAsset ?? null) : null,
    reason: null,
  } as const;
}

// NEAR Intents chain codes of PayRouta's mainnet networks.
const chainCodes: Record<string, string> = {
  "eip155:1": "eth",
  "eip155:8453": "base",
  "eip155:42161": "arb",
  "eip155:137": "pol",
  "eip155:43114": "avax",
  "solana:mainnet": "sol",
  "stellar:pubnet": "stellar",
};

// The wallet a customer can pay a token from, in the checkout itself. Other
// chains (Bitcoin, Tron, TON and so on) are paid by sending to an address.
export type WalletTarget =
  | { family: "evm"; chainId: number }
  | { family: "solana" }
  | { family: "stellar" }
  | { family: "near" };

// EVM chains NEAR Intents takes deposits on, by 1Click blockchain code.
export { evmChainIds };
export function swapWallet(blockchain: string): WalletTarget | undefined {
  if (evmChainIds[blockchain]) return { family: "evm", chainId: evmChainIds[blockchain] };
  if (blockchain === "sol") return { family: "solana" };
  if (blockchain === "near") return { family: "near" };
  return undefined;
}
function directWallet(network: string): WalletTarget | undefined {
  const c = registeredChain(network);
  if (c?.family === "evm") return { family: "evm", chainId: Number(network.split(":")[1]) };
  if (c?.family === "solana") return { family: "solana" };
  if (c?.family === "stellar") return { family: "stellar" };
  return undefined;
}

// USD-pegged settlement coins: a swap's price in another token is the USD
// amount over that token's USD price.
const usdStable = new Set(["USDC", "USDT", "USDT0", "DAI"]);
export function approximate(usd: number, price: number) {
  if (!(usd > 0) || !(price > 0)) return undefined;
  return (usd / price).toLocaleString("en-US", { maximumSignificantDigits: 6, useGrouping: false });
}

export type PayToken = {
  key: string;
  symbol: string;
  // direct: the merchant receives this exact token, sent to their address.
  // swap: NEAR Intents swaps it into the checkout's settlement stablecoin.
  route: "direct" | "swap";
  method: string;
  optionId: string | null;
  amount?: string;
  assetId?: string;
  // Direct tokens: the receiving network and token.
  network?: string;
  identifier?: string;
  // Swap tokens: the amount at today's price, before a quote; the token's
  // USD price; and its contract, mint or account, for search.
  approx?: string;
  price?: number;
  contract?: string;
  wallet?: WalletTarget;
  // Its logo (/api/logos/...), when CoinGecko knows it.
  logo?: string;
};

// CoinGecko ids for the stablecoins merchants receive directly.
const directCoins: Record<string, string> = { USDC: "usd-coin", USDT: "tether", EURC: "euro-coin", DAI: "dai", PYUSD: "paypal-usd" };

// The checkout's crypto picker: every token the customer could pay with,
// grouped by the network they pay from. The customer only says what they
// hold; which of the merchant's accounts receives it, a receive address or
// their NEAR Intents account, is routing and never a customer choice.
export async function payOptions(sessionId: string, token: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const { intent } = await authorizeSession(sessionId, token, now);
  const locked = (await db.paymentAttempt.count({ where: { intentId: intent.id } })) > 0;
  const asset = intent.asset as { network: string; identifier: string };
  // A multi-coin checkout offers its quoted options; a single-asset one its
  // own asset.
  const offered = (intent.paymentOptions as unknown[] | null)?.length
    ? (await checkoutOptions(intent)).filter((o) => o.available)
    : [
        {
          id: null,
          network: asset.network,
          identifier: asset.identifier,
          symbol: paymentAsset(asset.network, asset.identifier)?.symbol,
          amount: intent.amount,
          method: onchainMethod(asset.network, asset.identifier),
        },
      ];
  const routed = await Promise.all(
    offered.map(async (o) => {
      const [first] = await stablecoinCandidates(intent.orgId, intent.environment, { kind: "blockchain", network: o.network, identifier: o.identifier }, db, intent.id);
      return first ? { ...o, intents: first.intents } : null;
    }),
  );
  const options = routed.filter((o): o is NonNullable<typeof o> => !!o && !!o.symbol);
  const swaps = intent.environment === "production" && (deps.enabled ?? crossChainEnabled());
  let listed: Awaited<ReturnType<typeof tokens>> = [];
  if (swaps)
    try {
      listed = await tokens(deps.http ?? providerRequest, now.getTime());
    } catch {
      listed = [];
    }
  const config = await db.merchantConfig.findUnique({ where: { orgId: intent.orgId }, select: { swapSettlement: true } });
  return { locked, ...payTokens(options, swaps, listed, config?.swapSettlement as { network: string; identifier: string } | null) };
}

type Routed = { id: string | null; network: string; identifier: string; symbol?: string; amount: string; method: string; intents: boolean };
// What each token the customer holds pays as. A token the merchant receives
// directly (an address pool) is sent as is and listed once; with swaps on,
// every NEAR Intents token swaps into one settlement stablecoin, preferably
// one that settles into the merchant's intents account.
type Listed = { assetId: string; blockchain: string; symbol: string; price?: number | string; contractAddress?: string | null; coingeckoId?: string | null };
// `preferred`: the merchant's choice of the receive stablecoin swaps settle
// into, when this checkout offers it.
export function payTokens(options: Routed[], swaps: boolean, listed: Listed[], preferred?: { network: string; identifier: string } | null) {
  const deliverable = (o: Routed) => o.method === "stablecoin" && !!destinationFor(o.network, o.identifier);
  const target = swaps
    ? (options.find((o) => o.intents) ??
      options.find((o) => deliverable(o) && o.network === preferred?.network && o.identifier.toLowerCase() === preferred?.identifier.toLowerCase()) ??
      options.find(deliverable))
    : undefined;
  const chains = new Map<string, { id: string; name: string; logo?: string; tokens: PayToken[] }>();
  // A token the merchant receives directly is listed instead of swapping the
  // same token; two different tokens a chain lists under one symbol (bridged
  // and native USDC, say) are both shown, told apart by contract.
  const add = (id: string, name: string, t: PayToken) => {
    if (!chains.has(id)) chains.set(id, { id, name, logo: chainLogo(id), tokens: [] });
    const c = chains.get(id)!;
    if (c.tokens.some((x) => x.key === t.key || (x.symbol === t.symbol && x.route === "direct" && t.route === "swap"))) return;
    c.tokens.push(t);
  };
  for (const o of options.filter((o) => !o.intents && o.symbol)) {
    const code = chainCodes[o.network] ?? o.network;
    add(code, chainNames[code] ?? networkName(o.network), {
      key: `direct:${o.id ?? "asset"}`,
      symbol: o.symbol!,
      route: "direct",
      method: o.method,
      optionId: o.id,
      amount: o.amount,
      network: o.network,
      identifier: o.identifier,
      contract: o.identifier.slice(o.identifier.indexOf(":") + 1),
      wallet: directWallet(o.network),
      logo: coinLogo(directCoins[o.symbol!.toUpperCase()]),
    });
  }
  const usd = target && usdStable.has(target.symbol ?? "") ? Number(target.amount) : 0;
  if (target)
    for (const t of listed)
      add(t.blockchain, chainNames[t.blockchain] ?? t.blockchain.toUpperCase(), {
        key: `swap:${t.assetId}`,
        symbol: t.symbol,
        route: "swap",
        method: target.method,
        optionId: target.id,
        assetId: t.assetId,
        ...(Number(t.price) > 0 ? { price: Number(t.price), approx: approximate(usd, Number(t.price)) } : {}),
        ...(t.contractAddress ? { contract: t.contractAddress } : {}),
        wallet: swapWallet(t.blockchain),
        logo: coinLogo(t.coingeckoId),
      });
  return {
    settle: target ? { symbol: target.symbol!, amount: target.amount } : null,
    chains: [...chains.values()]
      .map((c) => ({ ...c, tokens: c.tokens.sort((a, b) => (a.route === b.route ? a.symbol.localeCompare(b.symbol) : a.route === "direct" ? -1 : 1)) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// Whether the customer can pay from another chain, and with what.
export async function crossChainOptions(sessionId: string, token: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  if (!(deps.enabled ?? crossChainEnabled())) return { available: false, reason: "CROSS_CHAIN_OFF", assets: [] };
  const scope = await awaitingDeposit(sessionId, token, now);
  if (!scope.attempt) return { available: false, reason: scope.reason, assets: [] };
  const list = await tokens(deps.http ?? providerRequest, now.getTime());
  const assets = list
    .filter((t) => scope.intoIntents || scope.toBank || scope.toAddress || t.assetId !== scope.destination.assetId)
    .map((t) => ({ assetId: t.assetId, chain: t.blockchain, chainName: chainNames[t.blockchain] ?? t.blockchain.toUpperCase(), symbol: t.symbol }))
    .sort((a, b) => a.chainName.localeCompare(b.chainName) || a.symbol.localeCompare(b.symbol));
  return {
    available: true,
    reason: null,
    assets,
    intents: scope.intoIntents || scope.toBank || scope.toAddress,
    receive: { symbol: scope.destination.symbol, amount: scope.action.amount, assetId: scope.destination.assetId },
  };
}

export async function crossChainQuote(
  sessionId: string,
  token: string,
  input: { originAsset: string; refundTo: string },
  deps: Deps = {},
) {
  const now = deps.now ?? new Date();
  const http = deps.http ?? providerRequest;
  if (!(deps.enabled ?? crossChainEnabled())) throw new PortalError("CROSS_CHAIN_OFF", 409);
  const scope = await awaitingDeposit(sessionId, token, now);
  if (!scope.attempt) throw new PortalError(scope.reason, 409);
  const { intent, attempt, action, intoIntents, toBank, toAddress } = scope;
  const list = await tokens(http, now.getTime());
  const destination = deliveredAsset(scope, list);
  if (!destination) throw new PortalError("CROSS_CHAIN_ASSET_NOT_SUPPORTED", 409);
  const origin = list.find((t) => t.assetId === input.originAsset);
  const listed = list.find((t) => t.assetId === destination.assetId);
  // The destination must still be the exact token PayRouta registered.
  if (
    !listed ||
    listed.decimals !== destination.decimals ||
    listed.symbol !== destination.symbol ||
    (listed.contractAddress ?? "").toLowerCase() !== destination.contract.toLowerCase()
  )
    throw new PortalError("CROSS_CHAIN_ASSET_NOT_SUPPORTED", 409);
  if (!origin || (!intoIntents && !toBank && !toAddress && origin.assetId === destination.assetId)) throw new PortalError("CROSS_CHAIN_ORIGIN_NOT_SUPPORTED", 409);
  if (!/^[A-Za-z0-9:._@-]{20,140}$/.test(input.refundTo) || (/^0x/i.test(input.refundTo) && !/^0x[0-9a-fA-F]{40}$/.test(input.refundTo)))
    throw new PortalError("CROSS_CHAIN_REFUND_ADDRESS_INVALID", 400);
  const gross = minor(action.amount, destination.decimals);
  // Into a merchant's intents account or bank PayRouta's fee is taken at
  // source; a receive address is confirmed by its exact amount, so it gets
  // the invoice.
  const fee = intoIntents || toBank || toAddress ? withheld(intent, gross, destination.decimals) : null;
  const amountOut = (gross - (fee?.fee ?? 0n)).toString();
  const deadline = new Date(intent.expiresAt.getTime() - deadlineMarginMs);
  const result = await quote(
    {
      originAsset: origin.assetId,
      destinationAsset: destination.assetId,
      amountOut,
      recipient: action.address,
      refundTo: input.refundTo,
      deadline,
      to: intoIntents ? "INTENTS" : "CHAIN",
      ...(fee ? { appFee: { recipient: fee.recipient, bps: fee.bps } } : {}),
    },
    http,
  );
  // Exact output only: anything else would under- or over-pay the invoice
  // and need merchant review.
  if (result.quote.amountOut !== amountOut || (result.quote.minAmountOut !== undefined && result.quote.minAmountOut !== amountOut))
    throw new PortalError("CROSS_CHAIN_QUOTE_MISMATCH", 409);
  if (result.quote.timeEstimate !== undefined && now.getTime() + result.quote.timeEstimate * 2000 > deadline.getTime())
    throw new PortalError("CROSS_CHAIN_TOO_LATE", 409);
  const record = await db.crossChainPayment.create({
    data: {
      intentId: intent.id,
      attemptId: attempt.id,
      environment: intent.environment,
      provider,
      originAsset: origin.assetId,
      originChain: origin.blockchain,
      originSymbol: origin.symbol,
      destinationAsset: destination.assetId,
      recipientType: intoIntents ? "INTENTS" : toBank ? "BANK" : toAddress ? "ADDRESS" : "DESTINATION_CHAIN",
      depositAddress: result.quote.depositAddress,
      depositMemo: result.quote.depositMemo ?? null,
      amountIn: result.quote.amountIn,
      amountInFormatted: result.quote.amountInFormatted,
      amountOut,
      ...(fee ? { appFeeMinor: fee.fee.toString(), appFeeBps: fee.bps } : {}),
      refundTo: input.refundTo,
      deadline,
      quote: json(result),
    },
  });
  return present(record, origin);
}

type Origin = { assetId: string; blockchain: string; decimals: number; contractAddress?: string | null };

// What the customer's wallet sends for a swap: the quoted amount to the
// one-time deposit address, on chains the checkout can pay from.
export function walletTransfer(r: { depositAddress: string; depositMemo: string | null; amountIn: string }, origin?: Origin) {
  const target = origin && swapWallet(origin.blockchain);
  if (!origin || !target) return undefined;
  const base = { amount: r.amountIn, decimals: origin.decimals, to: r.depositAddress, token: origin.contractAddress || null };
  if (target.family === "evm") {
    if (base.token && !/^0x[0-9a-fA-F]{40}$/.test(base.token)) return undefined;
    return { ...base, family: "evm" as const, chainId: target.chainId, chainName: chainNames[origin.blockchain] ?? origin.blockchain };
  }
  // NEAR tokens are contracts; native NEAR is paid as wrapped NEAR.
  if (target.family === "near") return base.token ? { ...base, family: "near" as const, memo: r.depositMemo } : undefined;
  return { ...base, family: "solana" as const };
}
export type WalletTransfer = NonNullable<ReturnType<typeof walletTransfer>>;

const httpsUrl = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v : undefined);

function present(
  r: {
    originChain: string;
    originSymbol: string;
    depositAddress: string;
    depositMemo: string | null;
    amountIn: string;
    amountInFormatted: string;
    refundTo: string;
    deadline: Date;
    status: string;
    fundedBy?: string;
    quote?: unknown;
    details?: unknown;
  },
  origin?: Origin,
) {
  const details = (r.details ?? {}) as { originChainTxHashes?: { explorerUrl?: string }[]; destinationChainTxHashes?: { explorerUrl?: string }[] };
  const estimate = (r.quote as { quote?: { timeEstimate?: number } } | undefined)?.quote?.timeEstimate;
  const transfer = r.status === "PENDING_DEPOSIT" && r.fundedBy !== "INTENTS" ? walletTransfer(r, origin) : undefined;
  return {
    chain: r.originChain,
    chainName: chainNames[r.originChain] ?? r.originChain.toUpperCase(),
    symbol: r.originSymbol,
    send: r.amountInFormatted,
    depositAddress: r.depositAddress,
    depositMemo: r.depositMemo,
    refundTo: r.refundTo,
    deadline: r.deadline.toISOString(),
    status: r.status,
    // Seconds NEAR Intents expects the swap to take, once the deposit lands.
    ...(typeof estimate === "number" ? { timeEstimate: estimate } : {}),
    // The customer's own transfer, or else the delivery to the merchant.
    ...(httpsUrl(details.originChainTxHashes?.[0]?.explorerUrl ?? details.destinationChainTxHashes?.[0]?.explorerUrl)
      ? { explorerUrl: httpsUrl(details.originChainTxHashes?.[0]?.explorerUrl ?? details.destinationChainTxHashes?.[0]?.explorerUrl) }
      : {}),
    ...(transfer ? { transfer } : {}),
  };
}

// Until the deposit lands, the customer can still pay it from a wallet.
async function pendingOrigin(r: { status: string; originAsset: string }, now: Date, deps: Deps) {
  if (r.status !== "PENDING_DEPOSIT") return undefined;
  const list = await tokens(deps.http ?? providerRequest, now.getTime()).catch(() => []);
  return list.find((t) => t.assetId === r.originAsset);
}

// The latest cross-chain quote for this checkout and its swap status. When
// the swap reports SUCCESS, a status read of the attempt is queued so the
// on-chain verification picks up the delivered transfer promptly.
export async function crossChainStatus(sessionId: string, token: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const { intent } = await authorizeSession(sessionId, token, now, true);
  const record = await db.crossChainPayment.findFirst({ where: { intentId: intent.id }, orderBy: { createdAt: "desc" } });
  if (!record) return { payment: null };
  if (["SUCCESS", "REFUNDED", "FAILED"].includes(record.status) || (record.checkedAt && now.getTime() - record.checkedAt.getTime() < 5000))
    return { payment: present(record, await pendingOrigin(record, now, deps)) };
  const s = await status(record.depositAddress, record.depositMemo, deps.http ?? providerRequest);
  // Swap details carry the intent hashes NEAR Intents settlement verifies.
  const updated = await db.crossChainPayment.update({
    where: { id: record.id },
    data: { status: s?.status ?? record.status, ...(s?.swapDetails ? { details: json(s.swapDetails) } : {}), checkedAt: now },
  });
  if (s?.status === "SUCCESS") await refreshAttempt(sessionId, token, now).catch(() => {});
  return { payment: present(updated, await pendingOrigin(updated, now, deps)) };
}

// Paying from a NEAR Intents balance (an AI agent, lib/agents/checkout.ts):
// the payer signs one transfer intent instead of sending a transaction.
// 1Click quotes the same exact-output swap, funded from the payer's intents
// account (depositType INTENTS) and refunded there, and generates the
// funding intent. PayRouta checks it moves exactly the quoted tokens from the
// payer to the quote's deposit account before handing it out; 1Click
// submits it once signed, so the payer needs no gas. Confirmation is the
// same as for any cross-chain payment.
export async function intentsFundedQuote(
  sessionId: string,
  token: string,
  input: { originAsset: string; payer: string },
  deps: Deps = {},
) {
  const now = deps.now ?? new Date();
  const http = deps.http ?? providerRequest;
  if (!(deps.enabled ?? crossChainEnabled())) throw new PortalError("CROSS_CHAIN_OFF", 409);
  const payer = intentsAccount(input.payer);
  if (!payer) throw new PortalError("INTENTS_ACCOUNT_INVALID", 400);
  const scope = await awaitingDeposit(sessionId, token, now);
  if (!scope.attempt) throw new PortalError(scope.reason, 409);
  const { intent, attempt, action, intoIntents, toBank, toAddress } = scope;
  const list = await tokens(http, now.getTime());
  const destination = deliveredAsset(scope, list);
  if (!destination) throw new PortalError("CROSS_CHAIN_ASSET_NOT_SUPPORTED", 409);
  const origin = list.find((t) => t.assetId === input.originAsset);
  if (!origin || !list.some((t) => t.assetId === destination.assetId)) throw new PortalError("CROSS_CHAIN_ORIGIN_NOT_SUPPORTED", 409);
  const gross = minor(action.amount, destination.decimals);
  const fee = intoIntents || toBank || toAddress ? withheld(intent, gross, destination.decimals) : null;
  const amountOut = (gross - (fee?.fee ?? 0n)).toString();
  const deadline = new Date(intent.expiresAt.getTime() - deadlineMarginMs);
  const result = await quote(
    {
      originAsset: origin.assetId,
      destinationAsset: destination.assetId,
      amountOut,
      recipient: action.address,
      refundTo: payer.accountId,
      deadline,
      from: "INTENTS",
      to: intoIntents ? "INTENTS" : "CHAIN",
      ...(fee ? { appFee: { recipient: fee.recipient, bps: fee.bps } } : {}),
    },
    http,
  );
  if (result.quote.amountOut !== amountOut || (result.quote.minAmountOut !== undefined && result.quote.minAmountOut !== amountOut))
    throw new PortalError("CROSS_CHAIN_QUOTE_MISMATCH", 409);
  const sign = await generateIntent({ depositAddress: result.quote.depositAddress, signerId: payer.accountId, standard: payer.standard }, http);
  checkFundingIntent(sign, { signer: payer.accountId, receiver: result.quote.depositAddress, token: origin.assetId, amount: result.quote.amountIn });
  const record = await db.crossChainPayment.create({
    data: {
      intentId: intent.id,
      attemptId: attempt.id,
      environment: intent.environment,
      provider,
      originAsset: origin.assetId,
      originChain: origin.blockchain,
      originSymbol: origin.symbol,
      destinationAsset: destination.assetId,
      recipientType: intoIntents ? "INTENTS" : toBank ? "BANK" : toAddress ? "ADDRESS" : "DESTINATION_CHAIN",
      fundedBy: "INTENTS",
      payer: payer.accountId,
      payload: json(sign),
      depositAddress: result.quote.depositAddress,
      amountIn: result.quote.amountIn,
      amountInFormatted: result.quote.amountInFormatted,
      amountOut,
      ...(fee ? { appFeeMinor: fee.fee.toString(), appFeeBps: fee.bps } : {}),
      refundTo: payer.accountId,
      deadline,
      quote: json(result),
      status: "AWAITING_SIGNATURE",
    },
  });
  return { payment: record.id, sign, ...present(record) };
}

const submitInput = z
  .object({
    payment: z.string().min(1).max(100),
    signature: z.string().min(10).max(200),
    publicKey: z.string().max(100).optional(),
  })
  .strict();

export async function submitFundedIntent(sessionId: string, token: string, raw: unknown, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const input = submitInput.parse(raw);
  const { intent } = await authorizeSession(sessionId, token, now);
  const record = await db.crossChainPayment.findUnique({ where: { id: input.payment } });
  if (!record || record.intentId !== intent.id || record.fundedBy !== "INTENTS" || !record.payer)
    throw new PortalError("PAYMENT_NOT_FOUND", 404);
  // Signed once: status polling may already have moved on from the
  // initial AWAITING_SIGNATURE, so the intent hash is what marks it used.
  if (record.intentHash || record.deadline <= now) throw new PortalError("INTENTS_QUOTE_EXPIRED", 409);
  const sign = record.payload as GeneratedIntent;
  let signed: SignedIntent;
  try {
    if (sign.standard === "erc191") {
      signed = { standard: "erc191", payload: sign.payload, signature: secp256k1Signature(input.signature) };
      if (erc191Signer(sign.payload, signed.signature) !== record.payer) throw new Error();
    } else if (sign.standard === "nep413") {
      const publicKey = input.publicKey ?? "";
      signed = { standard: "nep413", payload: sign.payload, public_key: publicKey, signature: ed25519Signature(input.signature) };
      if (!verifyNep413(sign.payload, publicKey, signed.signature)) throw new Error();
    } else throw new Error();
  } catch {
    throw new PortalError("INTENTS_SIGNATURE_INVALID", 403);
  }
  const { intentHash } = await submitIntent(signed, deps.http ?? providerRequest);
  const updated = await db.crossChainPayment.update({
    where: { id: record.id },
    data: { intentHash, status: "PENDING_DEPOSIT", checkedAt: now },
  });
  return { payment: updated.id, intentHash, ...present(updated) };
}

// The merchant's choice of the receive stablecoin that payments in other
// tokens are swapped into: one NEAR Intents can deliver, or null for the
// first the checkout offers.
const settlementInput = z.object({ network: z.string().max(60), identifier: z.string().max(200) }).strict().nullable();
export async function setSwapSettlement(orgId: string, raw: unknown, headers: Headers) {
  await merchantMember(orgId, "configure", headers);
  const value = settlementInput.parse(raw);
  if (value && !destinationFor(value.network, value.identifier)) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  await db.merchantConfig.update({ where: { orgId }, data: { swapSettlement: value ? json(value) : Prisma.DbNull } });
  return { swapSettlement: value };
}
