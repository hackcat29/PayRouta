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
// Off unless CROSS_CHAIN_PAYMENTS=near-intents, and only for production
// intents: 1Click has no testnet, and sandbox never moves real money.
import { db } from "../portal/db";
import { json } from "../portal/service";
import { PortalError } from "../portal/domain";
import { authorizeSession, refreshAttempt } from "../payments/service";
import { minor } from "../payments/contracts";
import { chainNames, destinationFor, quote, status, tokens, type Http } from "./oneclick";
import { providerRequest } from "../providers/adapters/http";

export const crossChainEnabled = () => process.env.CROSS_CHAIN_PAYMENTS === "near-intents";
const provider = "near-intents";
// The swap must be able to land well before the checkout's deadline.
const minimumWindowMs = 5 * 60000;
const deadlineMarginMs = 90000;

type Deps = { http?: Http; now?: Date; enabled?: boolean };

async function awaitingDeposit(sessionId: string, token: string, now: Date) {
  const { intent } = await authorizeSession(sessionId, token, now);
  const attempt = await db.paymentAttempt.findFirst({ where: { intentId: intent.id }, orderBy: { number: "desc" } });
  const action = attempt?.action as { kind?: string; address?: string; network?: string; identifier?: string; amount?: string } | null;
  if (!attempt || attempt.state !== "Requires action" || action?.kind !== "deposit" || !action.address || !action.network || !action.identifier || !action.amount)
    return { intent, attempt: null, reason: "CROSS_CHAIN_NO_TRANSFER_AWAITED" } as const;
  const destination = destinationFor(action.network, action.identifier);
  if (!destination) return { intent, attempt: null, reason: "CROSS_CHAIN_ASSET_NOT_SUPPORTED" } as const;
  if (intent.environment !== "production") return { intent, attempt: null, reason: "CROSS_CHAIN_LIVE_ONLY" } as const;
  if (intent.expiresAt.getTime() - now.getTime() < minimumWindowMs)
    return { intent, attempt: null, reason: "CROSS_CHAIN_TOO_LATE" } as const;
  return { intent, attempt, action: { ...action, address: action.address, amount: action.amount }, destination, reason: null } as const;
}

// Whether the customer can pay from another chain, and with what.
export async function crossChainOptions(sessionId: string, token: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  if (!(deps.enabled ?? crossChainEnabled())) return { available: false, reason: "CROSS_CHAIN_OFF", assets: [] };
  const scope = await awaitingDeposit(sessionId, token, now);
  if (!scope.attempt) return { available: false, reason: scope.reason, assets: [] };
  const list = await tokens(deps.http ?? providerRequest, now.getTime());
  const assets = list
    .filter((t) => t.assetId !== scope.destination.assetId)
    .map((t) => ({ assetId: t.assetId, chain: t.blockchain, chainName: chainNames[t.blockchain] ?? t.blockchain.toUpperCase(), symbol: t.symbol }))
    .sort((a, b) => a.chainName.localeCompare(b.chainName) || a.symbol.localeCompare(b.symbol));
  return { available: true, reason: null, assets, receive: { symbol: scope.destination.symbol, amount: scope.action.amount } };
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
  const { intent, attempt, action, destination } = scope;
  const list = await tokens(http, now.getTime());
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
  if (!origin || origin.assetId === destination.assetId) throw new PortalError("CROSS_CHAIN_ORIGIN_NOT_SUPPORTED", 409);
  if (!/^[A-Za-z0-9:._@-]{20,140}$/.test(input.refundTo) || (/^0x/i.test(input.refundTo) && !/^0x[0-9a-fA-F]{40}$/.test(input.refundTo)))
    throw new PortalError("CROSS_CHAIN_REFUND_ADDRESS_INVALID", 400);
  const amountOut = minor(action.amount, destination.decimals).toString();
  const deadline = new Date(intent.expiresAt.getTime() - deadlineMarginMs);
  const result = await quote(
    { originAsset: origin.assetId, destinationAsset: destination.assetId, amountOut, recipient: action.address, refundTo: input.refundTo, deadline },
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
      depositAddress: result.quote.depositAddress,
      depositMemo: result.quote.depositMemo ?? null,
      amountIn: result.quote.amountIn,
      amountInFormatted: result.quote.amountInFormatted,
      amountOut,
      refundTo: input.refundTo,
      deadline,
      quote: json(result),
    },
  });
  return present(record);
}

function present(r: {
  originChain: string;
  originSymbol: string;
  depositAddress: string;
  depositMemo: string | null;
  amountInFormatted: string;
  refundTo: string;
  deadline: Date;
  status: string;
}) {
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
  };
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
    return { payment: present(record) };
  const s = await status(record.depositAddress, record.depositMemo, deps.http ?? providerRequest);
  const updated = await db.crossChainPayment.update({
    where: { id: record.id },
    data: { status: s?.status ?? record.status, checkedAt: now },
  });
  if (s?.status === "SUCCESS") await refreshAttempt(sessionId, token, now).catch(() => {});
  return { payment: present(updated) };
}
