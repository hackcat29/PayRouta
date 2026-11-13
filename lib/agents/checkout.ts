// Agentic payments (docs/agents.md): an AI agent pays a PayRouta payment
// link or checkout over HTTP, with no browser.
//
//   GET  links/{slug}        402 Payment Required: what the link costs and
//                            how an agent can pay it
//   GET  invoices/{slug}     the same for a subscription invoice
//   GET  x402/links/{slug}   the link over x402: USDC on NEAR, no gas
//                            (lib/x402/checkout.ts)
//   POST checkouts           open a checkout from a link (or a checkout URL
//                            the merchant gave the agent)
//   POST checkouts/{id}/pay  what to send, or the intent to sign
//   POST checkouts/{id}/submit  the signed intent
//   GET  checkouts/{id}      where the payment is
//
// An agent pays like any customer: with a wallet transfer to the address
// checkout gives it, or by signing one transfer intent from its NEAR Intents
// balance (no gas, mainnet). Confirmation, settlement and webhooks are
// unchanged. With an agent key, every payment is checked against the key's
// limits before anything is prepared (keys.ts).
import { z } from "zod";
import { PortalError } from "../portal/domain";
import { db } from "../portal/db";
import { publicPaymentLink, startPaymentLinkCheckout } from "../merchant/payment-links";
import { authorizeSession, choosePaymentOption, confirm, methods, progress, selectMethod, switchTo } from "../payments/service";
import { dispatch } from "../payments/processing";
import { destinationFor } from "../intents/oneclick";
import { crossChainQuote, crossChainStatus, intentsFundedQuote, payOptions, submitFundedIntent } from "../intents/checkout";
import type { QuotedCryptoTerms } from "../payments/crypto-checkout";
import { reserveSpend, type AgentKey } from "./keys";
import { publicInvoice, startInvoiceCheckout } from "../subscriptions/service";
import { x402Available } from "../x402/checkout";
import { baseUnits, orderPublicKey, signOrder, vaultAsset } from "./vault";

const api = "/api/agent/v1";

// What an agent learns from a payment link before paying it.
export async function linkTerms(slug: string, origin: string) {
  const link = await publicPaymentLink(slug);
  if (!link) throw new PortalError("PAYMENT_LINK_UNAVAILABLE", 404);
  const crypto = link.crypto && link.currency === "USD";
  return {
    error: "Payment required",
    merchant: link.merchant,
    title: link.title,
    amount: link.amount,
    currency: link.currency,
    testMode: link.environment === "sandbox",
    accepts: crypto
      ? [
          { method: "wallet", description: "Send a token on-chain to the address checkout gives you" },
          ...(link.environment === "production"
            ? [{ method: "intents", network: "near:mainnet", description: "Sign one transfer intent from a NEAR Intents balance; no gas" }]
            : []),
          ...(link.environment === "production" && (await x402Available())
            ? [{ method: "x402", network: "near:mainnet", url: `${origin}${api}/x402/links/${link.slug}`, description: "Pay in USDC on NEAR with any x402 client; no gas" }]
            : []),
        ]
      : [],
    checkout: { method: "POST", url: `${origin}${api}/checkouts`, body: { link: link.slug } },
  };
}

// What an agent learns from a subscription invoice before paying it.
export async function invoiceTerms(slug: string, origin: string) {
  const invoice = await publicInvoice(slug);
  if (!invoice) throw new PortalError("INVOICE_NOT_PAYABLE", 404);
  return {
    error: invoice.state === "Open" ? "Payment required" : `Invoice ${invoice.state.toLowerCase()}`,
    merchant: invoice.merchant,
    title: `Invoice ${invoice.number} · ${invoice.plan}`,
    amount: invoice.amount,
    currency: invoice.currency,
    state: invoice.state,
    dueAt: invoice.dueAt.toISOString(),
    lines: invoice.lines,
    testMode: invoice.environment === "sandbox",
    accepts:
      invoice.crypto && invoice.state === "Open"
        ? [
            { method: "wallet", description: "Send a token on-chain to the address checkout gives you" },
            ...(invoice.environment === "production"
              ? [{ method: "intents", network: "near:mainnet", description: "Sign one transfer intent from a NEAR Intents balance; no gas" }]
              : []),
            ...(invoice.environment === "production" && (await x402Available())
              ? [{ method: "x402", network: "near:mainnet", url: `${origin}${api}/x402/invoices/${invoice.slug}`, description: "Pay in USDC on NEAR with any x402 client; no gas" }]
              : []),
          ]
        : [],
    checkout: { method: "POST", url: `${origin}${api}/checkouts`, body: { invoice: invoice.slug } },
  };
}

const openInput = z.union([
  z.object({ link: z.string().trim().min(1).max(300) }).strict(),
  z.object({ invoice: z.string().trim().min(1).max(300) }).strict(),
  z.object({ checkoutUrl: z.url().max(2048) }).strict(),
]);

const sessionOf = (path: string) => {
  const m = path.match(/\/checkout\/([\w-]{1,100})#([\w-]{20,200})$/);
  if (!m) throw new PortalError("CHECKOUT_EXPIRED_OR_UNAUTHORIZED", 401);
  return { id: m[1], token: m[2] };
};

// Open a checkout for the agent: from a payment link, as the Pay button does,
// or from a checkout URL. Agents pay in crypto, so a checkout that also
// offers fiat methods is switched to its crypto side.
export async function openCheckout(raw: unknown, visitor: { ip: string; country?: string | null }) {
  const input = openInput.parse(raw);
  let session;
  if ("link" in input) {
    const slug = input.link.match(/\/pay\/([A-Za-z0-9]{6,20})(?:[/?#]|$)/)?.[1] ?? input.link;
    const link = await publicPaymentLink(slug);
    if (!link) throw new PortalError("PAYMENT_LINK_UNAVAILABLE", 404);
    if (!link.crypto || link.currency !== "USD") throw new PortalError("AGENT_PAYMENT_NOT_OFFERED", 409);
    session = sessionOf(await startPaymentLinkCheckout(slug, visitor));
  } else if ("invoice" in input) {
    const slug = input.invoice.match(/\/pay\/invoice\/([A-Za-z0-9]{10,20})(?:[/?#]|$)/)?.[1] ?? input.invoice;
    const invoice = await publicInvoice(slug);
    if (!invoice || invoice.state !== "Open") throw new PortalError("INVOICE_NOT_PAYABLE", 409);
    if (!invoice.crypto) throw new PortalError("AGENT_PAYMENT_NOT_OFFERED", 409);
    session = sessionOf(await startInvoiceCheckout(slug, visitor));
  } else session = sessionOf(new URL(input.checkoutUrl).pathname + new URL(input.checkoutUrl).hash);
  const { intent } = await authorizeSession(session.id, session.token, new Date());
  if ((intent.asset as { kind?: string }).kind !== "blockchain") session = sessionOf((await switchTo(session.id, session.token, "crypto")).checkoutPath);
  return { checkout: session.id, token: session.token, ...(await describe(session.id, session.token)) };
}

// The checkout as an agent sees it: amount, state, and what it can pay with.
export async function describe(id: string, token: string) {
  const p = await progress(id, token);
  const options = p.attemptId ? null : await payOptions(id, token);
  return {
    merchant: p.merchant,
    reference: p.reference,
    amount: p.amount,
    symbol: p.symbol,
    usdAmount: p.cryptoQuote?.usdAmount ?? null,
    testMode: p.sandbox,
    state: p.state,
    attemptState: p.attemptState ?? null,
    expiresAt: p.expiresAt,
    ...(options
      ? {
          payWith: options.chains.map((c) => ({
            network: c.name,
            tokens: c.tokens.map((t) => ({ token: t.key, symbol: t.symbol, route: t.route, ...(t.amount ? { amount: t.amount } : {}) })),
          })),
          intents: !!options.settle,
        }
      : {}),
  };
}

// USD cents an agent key spends on this checkout.
async function usdCents(intent: { amount: string; asset: unknown; cryptoQuoteId: string | null }) {
  if (intent.cryptoQuoteId) {
    const q = await db.cryptoQuote.findUnique({ where: { id: intent.cryptoQuoteId } });
    const usd = (q?.terms as unknown as QuotedCryptoTerms | undefined)?.usdAmount;
    if (usd) return BigInt(Math.round(Number(usd) * 100));
  }
  const a = intent.asset as { network?: string; identifier?: string };
  const d = a.network && a.identifier ? destinationFor(a.network, a.identifier) : undefined;
  if (d && ["USDC", "USDT"].includes(d.symbol)) return BigInt(Math.round(Number(intent.amount) * 100));
  throw new PortalError("AGENT_AMOUNT_UNPRICED", 409);
}

const payInput = z
  .object({
    // A token key from payWith.
    token: z.string().min(1).max(320),
    from: z.enum(["wallet", "intents"]),
    // wallet + swap: the agent's address on the network it pays from.
    refundTo: z.string().min(2).max(140).optional(),
    // intents: the NEAR Intents account that signs.
    payer: z.string().min(2).max(64).optional(),
  })
  .strict();

// Start paying: the transfer to make, or the intent to sign.
export async function pay(
  id: string,
  token: string,
  raw: unknown,
  key: AgentKey | null,
  now = new Date(),
  deps: { dispatch?: (attemptId: string, now: Date) => Promise<void> } = {},
) {
  const input = payInput.parse(raw);
  const { intent } = await authorizeSession(id, token, now);
  const started = await db.paymentAttempt.findFirst({ where: { intentId: intent.id }, orderBy: { number: "desc" } });
  if (!started) {
    const options = await payOptions(id, token);
    const t = options.chains.flatMap((c) => c.tokens).find((x) => x.key === input.token);
    if (!t) throw new PortalError("PAYMENT_OPTION_NOT_OFFERED", 409);
    if (input.from === "intents" && !options.settle) throw new PortalError("CROSS_CHAIN_LIVE_ONLY", 409);
    if (t.optionId && t.optionId !== intent.selectedOption) await choosePaymentOption(id, token, t.optionId, now);
    if (key) {
      const chosen = await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
      await reserveSpend(key, { intentId: chosen.id, environment: chosen.environment, merchant: chosen.orgId, amountMinor: await usdCents(chosen), payer: input.payer }, now);
    }
    await methods(id, token, now);
    const { routeId } = await selectMethod(id, token, t.method, now);
    const { attemptId } = await confirm(id, token, routeId, now);
    // Instructions now rather than from the worker: an agent shouldn't poll
    // for its own payment to be prepared.
    if (attemptId) await (deps.dispatch ?? dispatch)(attemptId, now);
  } else if (key) {
    // Retrying an open checkout reserves nothing new.
    const current = await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } });
    await reserveSpend(key, { intentId: current.id, environment: current.environment, merchant: current.orgId, amountMinor: await usdCents(current), payer: input.payer }, now);
  }
  const attempt = await db.paymentAttempt.findFirst({ where: { intentId: intent.id }, orderBy: { number: "desc" } });
  const action = attempt?.action as { kind?: string; address?: string; network?: string; identifier?: string; amount?: string; symbol?: string } | null;
  if (!attempt || attempt.state !== "Requires action" || !action) throw new PortalError("AGENT_INSTRUCTIONS_NOT_READY", 409);
  const swapAsset = input.token.startsWith("swap:") ? input.token.slice(5) : null;

  if (input.from === "intents") {
    if (!input.payer) throw new PortalError("INTENTS_ACCOUNT_INVALID", 400);
    // A direct token pays from the same token held in NEAR Intents.
    const origin =
      swapAsset ?? (action.network && action.identifier ? destinationFor(action.network, action.identifier)?.assetId : undefined);
    if (!origin) throw new PortalError("CROSS_CHAIN_ORIGIN_NOT_SUPPORTED", 409);
    const q = await intentsFundedQuote(id, token, { originAsset: origin, payer: input.payer }, { now });
    if (key) await db.agentSpend.updateMany({ where: { keyId: key.id, intentId: intent.id }, data: { paymentId: q.payment } });
    return {
      kind: "sign",
      payment: q.payment,
      sign: q.sign,
      send: `${q.send} ${q.symbol}`,
      deadline: q.deadline,
      submit: { method: "POST", url: `${api}/checkouts/${id}/submit`, body: { payment: q.payment, signature: "…", publicKey: "ed25519:… (NEAR accounts)" } },
    };
  }
  if (swapAsset) {
    if (!input.refundTo) throw new PortalError("CROSS_CHAIN_REFUND_ADDRESS_INVALID", 400);
    const q = await crossChainQuote(id, token, { originAsset: swapAsset, refundTo: input.refundTo }, { now });
    const vault = q.depositMemo ? undefined : await vaultOrder(intent, { originAsset: swapAsset }, q.depositAddress, q.send, new Date(q.deadline));
    return {
      kind: "transfer",
      network: q.chainName,
      symbol: q.symbol,
      amount: q.send,
      address: q.depositAddress,
      ...(q.depositMemo ? { memo: q.depositMemo } : {}),
      refundTo: q.refundTo,
      deadline: q.deadline,
      ...(vault ? { vault } : {}),
    };
  }
  if (action.kind !== "deposit") throw new PortalError("PAYMENT_OPTION_NOT_OFFERED", 409);
  const vault =
    action.address && action.amount ? await vaultOrder(intent, { network: action.network, token: action.identifier }, action.address, action.amount, intent.expiresAt) : undefined;
  return {
    kind: "transfer",
    network: action.network,
    token: action.identifier,
    symbol: action.symbol,
    amount: action.amount,
    address: action.address,
    deadline: intent.expiresAt.toISOString(),
    ...(vault ? { vault } : {}),
  };
}

// The same transfer as an order PayRouta signs for an agent vault
// (lib/agents/vault.ts): who is paid, where, in what and how much. The
// vault pays only orders signed with this key, so an agent can't change any
// of it. Absent when order signing isn't configured or the token isn't one a
// vault pays with.
async function vaultOrder(
  intent: { id: string; orgId: string },
  asset: { network?: string; token?: string; originAsset?: string },
  payTo: string,
  amount: string,
  expiresAt: Date,
) {
  const paid = vaultAsset(asset);
  if (!paid) return undefined;
  const org = await db.organization.findUnique({ where: { id: intent.orgId }, select: { name: true } });
  const signed = await signOrder({
    id: intent.id,
    merchant: intent.orgId,
    merchant_name: org?.name ?? "",
    network: paid.network,
    token: paid.token,
    pay_to: payTo,
    amount: baseUnits(amount, paid.decimals),
    expires_at_ms: String(expiresAt.getTime()),
  }).catch(() => null);
  if (!signed) return undefined;
  return { ...signed, signer: await orderPublicKey(), method: "pay" };
}

export async function submit(id: string, token: string, raw: unknown) {
  return submitFundedIntent(id, token, raw);
}

export async function status(id: string, token: string) {
  const [checkout, swap] = await Promise.all([describe(id, token), crossChainStatus(id, token).catch(() => ({ payment: null }))]);
  return { ...checkout, paid: checkout.state === "Confirmed", swap: swap.payment };
}
