// Payouts and refunds from a merchant's NEAR Intents balance
// (docs/near-intents.md): pay a supplier, staff or the merchant's own wallet
// on any chain, or refund an intents payment to the customer's address on
// the chain they paid from.
//
// 1Click quotes an exact-input swap funded from the merchant's intents
// account (depositType INTENTS) and generates the transfer intent that funds
// it. PayRouta checks that intent moves exactly the quoted tokens from the
// merchant's account to the quote's deposit account, nothing else, before
// the merchant signs it in their own wallet; 1Click then submits it, so the
// merchant pays no gas. PayRouta never holds the funds or the keys.
import { z } from "zod";
import { db } from "../portal/db";
import { atomic, audit, json } from "../portal/service";
import { stepUp, rateLimit } from "../portal/access";
import { PortalError, decimal } from "../portal/domain";
import { merchantMember } from "../merchant/access";
import { tokenMinor, validTokenAmount } from "../blockchain/assets";
import { providerRequest } from "../providers/adapters/http";
import { chainNames, destinations, generateIntent, quote, status, submitIntent, tokens, type GeneratedIntent, type Http } from "./oneclick";
import { intentsBalances, intentsContract } from "./near";
import { ed25519Signature, secp256k1Signature, type SignedIntent } from "./signing";
import { erc191Signer, verifyNep413 } from "./verify";
import { currentIntentsAccount, units } from "./account";

type Deps = { http?: Http; now?: Date };
const finished = ["SUCCESS", "REFUNDED", "FAILED", "EXPIRED"];
const quoteLifetimeMs = 20 * 60000;

const payoutInput = z
  .object({
    // Which settlement token in the balance pays.
    originAsset: z.string().min(1).max(300),
    amount: decimal,
    destinationAsset: z.string().min(1).max(300),
    recipient: z.string().min(2).max(140),
    note: z.string().max(200).optional(),
    // A refund of this payment (PaymentIntent id) to the customer.
    refundOf: z.string().min(1).max(100).optional(),
  })
  .strict();

// The generated intent must be exactly one transfer of the quoted tokens
// from the merchant's account to the quote's deposit account.
export function checkFundingIntent(intent: GeneratedIntent, expect: { signer: string; receiver: string; token: string; amount: string }) {
  let body: { signer_id?: unknown; verifying_contract?: unknown; intents?: unknown };
  try {
    body = JSON.parse(intent.standard === "erc191" ? intent.payload : intent.payload.message);
  } catch {
    throw new PortalError("INTENTS_INTENT_UNEXPECTED", 502);
  }
  const transfers = Array.isArray(body.intents) ? (body.intents as Record<string, unknown>[]) : [];
  const t = transfers[0],
    tokens = t?.tokens as Record<string, unknown> | undefined;
  if (
    body.signer_id !== expect.signer ||
    (intent.standard === "erc191" ? body.verifying_contract !== intentsContract : intent.payload.recipient !== intentsContract) ||
    transfers.length !== 1 ||
    t.intent !== "transfer" ||
    t.receiver_id !== expect.receiver ||
    !tokens ||
    Object.keys(tokens).length !== 1 ||
    tokens[expect.token] !== expect.amount ||
    Object.keys(t).some((k) => !["intent", "receiver_id", "tokens", "memo"].includes(k))
  )
    throw new PortalError("INTENTS_INTENT_UNEXPECTED", 502);
}

function present(p: {
  id: string;
  purpose: string;
  intentId: string | null;
  destinationChain: string;
  destinationSymbol: string;
  recipient: string;
  amountInFormatted: string;
  amountOutFormatted: string;
  originAsset: string;
  status: string;
  details: unknown;
  note: string | null;
  createdAt: Date;
}) {
  const origin = destinations.find((d) => d.assetId === p.originAsset);
  const tx = (p.details as { destinationChainTxHashes?: { hash: string; explorerUrl?: string }[] } | null)?.destinationChainTxHashes?.[0];
  return {
    id: p.id,
    purpose: p.purpose,
    intentId: p.intentId,
    send: `${p.amountInFormatted} ${origin?.symbol ?? ""}`.trim(),
    receive: `${p.amountOutFormatted} ${p.destinationSymbol}`,
    chainName: chainNames[p.destinationChain] ?? p.destinationChain,
    recipient: p.recipient,
    status: p.status,
    explorerUrl: tx?.explorerUrl ?? null,
    note: p.note,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function quotePayout(orgId: string, raw: unknown, headers: Headers, deps: Deps = {}) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await stepUp(headers);
  await rateLimit(`intents-payout:${orgId}`, 30);
  const now = deps.now ?? new Date(),
    http = deps.http ?? providerRequest;
  const input = payoutInput.parse(raw);
  const account = await currentIntentsAccount(orgId, config.environment);
  if (!account) throw new PortalError("INTENTS_ACCOUNT_NOT_CONNECTED", 409);
  const origin = destinations.find((d) => d.assetId === input.originAsset);
  if (!origin || !validTokenAmount(input.amount, origin.decimals)) throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
  const amountIn = tokenMinor(input.amount, origin.decimals);
  if (amountIn <= 0n) throw new PortalError("INVALID_AMOUNT", 400);
  const listed = await tokens(http, now.getTime());
  const destination = listed.find((t) => t.assetId === input.destinationAsset);
  if (!destination) throw new PortalError("CROSS_CHAIN_ASSET_NOT_SUPPORTED", 409);
  const recipient = input.recipient.trim();
  if (!/^[A-Za-z0-9:._@-]{2,140}$/.test(recipient) || (/^0x/i.test(recipient) && !/^0x[0-9a-fA-F]{40}$/.test(recipient)))
    throw new PortalError("INTENTS_RECIPIENT_INVALID", 400);

  // A refund goes back to the customer, in what they paid with, up to what
  // the payment delivered less earlier refunds.
  if (input.refundOf) {
    const payment = await db.paymentIntent.findUnique({ where: { id: input.refundOf } });
    const swap = payment
      ? await db.crossChainPayment.findFirst({ where: { intentId: payment.id, recipientType: "INTENTS", status: "SUCCESS" } })
      : null;
    if (!payment || payment.orgId !== orgId || payment.environment !== config.environment || payment.state !== "Confirmed" || !swap)
      throw new PortalError("PAYMENT_NOT_FOUND", 404);
    if (swap.destinationAsset !== origin.assetId || swap.originAsset !== destination.assetId || swap.refundTo !== recipient)
      throw new PortalError("REFUND_DESTINATION_MISMATCH", 409);
    const earlier = await db.intentsPayout.findMany({
      where: { orgId, purpose: "refund", intentId: payment.id, status: { notIn: ["FAILED", "REFUNDED", "EXPIRED"] } },
    });
    if (earlier.reduce((n, r) => n + BigInt(r.amountIn), 0n) + amountIn > BigInt(swap.amountOut))
      throw new PortalError("REFUND_EXCEEDS_PAYMENT", 409);
  }

  const held = await intentsBalances(account.accountId, [origin.assetId], http);
  if (BigInt(held[origin.assetId] ?? "0") < amountIn) throw new PortalError("INTENTS_BALANCE_INSUFFICIENT", 409);
  const deadline = new Date(now.getTime() + quoteLifetimeMs);
  const result = await quote(
    {
      originAsset: origin.assetId,
      destinationAsset: destination.assetId,
      amountOut: amountIn.toString(),
      recipient,
      refundTo: account.accountId,
      deadline,
      from: "INTENTS",
      to: "CHAIN",
      exactInput: true,
    },
    http,
  );
  if (result.quote.amountIn !== amountIn.toString()) throw new PortalError("CROSS_CHAIN_QUOTE_MISMATCH", 409);
  const intent = await generateIntent(
    { depositAddress: result.quote.depositAddress, signerId: account.accountId, standard: account.standard === "erc191" ? "erc191" : "nep413" },
    http,
  );
  checkFundingIntent(intent, { signer: account.accountId, receiver: result.quote.depositAddress, token: origin.assetId, amount: amountIn.toString() });

  const payout = await atomic(async (tx) => {
    const p = await tx.intentsPayout.create({
      data: {
        orgId,
        environment: config.environment,
        accountId: account.accountId,
        purpose: input.refundOf ? "refund" : "payout",
        intentId: input.refundOf ?? null,
        originAsset: origin.assetId,
        destinationAsset: destination.assetId,
        destinationChain: destination.blockchain,
        destinationSymbol: destination.symbol,
        recipient,
        amountIn: amountIn.toString(),
        amountInFormatted: units(amountIn, origin.decimals),
        amountOutFormatted: units(result.quote.amountOut, destination.decimals),
        depositAddress: result.quote.depositAddress,
        quote: json(result),
        payload: json(intent),
        note: input.note ?? null,
        createdBy: session.user.id,
      },
    });
    await audit(tx, orgId, session.user.id, input.refundOf ? "merchant.intents.refund_quoted" : "merchant.intents.payout_quoted", p.id, {
      accountId: account.accountId,
      send: `${p.amountInFormatted} ${origin.symbol}`,
      receive: `${p.amountOutFormatted} ${destination.symbol} on ${destination.blockchain}`,
      recipient,
      intentId: input.refundOf,
    });
    return p;
  });
  return { payout: present(payout), sign: intent, deadline: deadline.toISOString() };
}

const submitInput = z
  .object({
    id: z.string().min(1).max(100),
    signature: z.string().min(10).max(200),
    publicKey: z.string().max(100).optional(),
  })
  .strict();

export async function submitPayout(orgId: string, raw: unknown, headers: Headers, deps: Deps = {}) {
  const { session, config } = await merchantMember(orgId, "configure", headers);
  await rateLimit(`intents-payout:${orgId}`, 30);
  const now = deps.now ?? new Date();
  const input = submitInput.parse(raw);
  const payout = await db.intentsPayout.findUnique({ where: { id: input.id } });
  const account = await currentIntentsAccount(orgId, config.environment);
  if (!payout || payout.orgId !== orgId || payout.environment !== config.environment) throw new PortalError("PAYOUT_NOT_FOUND", 404);
  if (payout.status !== "AWAITING_SIGNATURE" || payout.createdAt.getTime() + quoteLifetimeMs <= now.getTime())
    throw new PortalError("INTENTS_QUOTE_EXPIRED", 409);
  if (!account || account.accountId !== payout.accountId) throw new PortalError("INTENTS_ACCOUNT_NOT_CONNECTED", 409);
  const intent = payout.payload as GeneratedIntent;
  // Check the signature here first: 1Click would reject it, but a clear
  // error beats a provider refusal.
  let signed: SignedIntent;
  try {
    if (intent.standard === "erc191") {
      signed = { standard: "erc191", payload: intent.payload, signature: secp256k1Signature(input.signature) };
      if (erc191Signer(intent.payload, signed.signature) !== account.accountId) throw new Error();
    } else {
      const publicKey = input.publicKey ?? account.publicKey ?? "";
      signed = { standard: "nep413", payload: intent.payload, public_key: publicKey, signature: ed25519Signature(input.signature) };
      if (!verifyNep413(intent.payload, publicKey, signed.signature)) throw new Error();
    }
  } catch {
    throw new PortalError("INTENTS_SIGNATURE_INVALID", 403);
  }
  const { intentHash } = await submitIntent(signed, deps.http ?? providerRequest);
  const updated = await atomic(async (tx) => {
    const p = await tx.intentsPayout.update({ where: { id: payout.id }, data: { intentHash, status: "PENDING_DEPOSIT", checkedAt: now } });
    await audit(tx, orgId, session.user.id, payout.purpose === "refund" ? "merchant.intents.refund_sent" : "merchant.intents.payout_sent", p.id, {
      intentHash,
      intentId: payout.intentId,
    });
    return p;
  });
  return { payout: present(updated) };
}

// Payouts, newest first, with in-flight ones refreshed from 1Click.
export async function payouts(orgId: string, environment: string, deps: Deps = {}) {
  const now = deps.now ?? new Date();
  const list = await db.intentsPayout.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" }, take: 25 });
  return Promise.all(
    list.map(async (p) => {
      if (p.status === "AWAITING_SIGNATURE" && p.createdAt.getTime() + quoteLifetimeMs <= now.getTime())
        return present(await db.intentsPayout.update({ where: { id: p.id }, data: { status: "EXPIRED" } }));
      if (finished.includes(p.status) || p.status === "AWAITING_SIGNATURE" || (p.checkedAt && now.getTime() - p.checkedAt.getTime() < 5000))
        return present(p);
      const s = await status(p.depositAddress, null, deps.http ?? providerRequest).catch(() => null);
      if (!s) return present(p);
      return present(
        await db.intentsPayout.update({
          where: { id: p.id },
          data: { status: s.status, ...(s.swapDetails ? { details: json(s.swapDetails) } : {}), checkedAt: now },
        }),
      );
    }),
  );
}

export async function payoutsFor(orgId: string, headers: Headers) {
  const { config } = await merchantMember(orgId, "read", headers);
  return { payouts: await payouts(orgId, config.environment) };
}
