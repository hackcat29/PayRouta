// A PayRouta payment link or invoice paid over x402 (docs/x402.md): any x402
// v2 client with a NEAR account pays it in USDC on NEAR, with no gas.
//
//   GET /api/agent/v1/x402/links/{slug}
//   GET /api/agent/v1/x402/invoices/{slug}
//
// Without a payment, the response is 402 with a PAYMENT-REQUIRED header: an
// `exact` payment on near:mainnet of USDC to this checkout's NEAR Intents
// deposit address. That address is the same exact-output 1Click quote a
// customer paying from NEAR gets, so the merchant receives the invoice in
// whatever they settle in, and confirmation is unchanged. The client signs
// a NEP-366 delegate action for the transfer and sends it back in
// PAYMENT-SIGNATURE; PayRouta verifies it, registers the deposit address with
// the token if needed, and its relayer submits it. An agent key (Bearer
// pra_…) keeps the agent within its limits, as on the rest of the agent API.
//
// Live mode only: 1Click has no testnet. Test-mode x402 runs through the
// facilitator API on NEAR testnet (app/api/v1/x402).
import type { PaymentPayload, PaymentRequired, PaymentRequirements } from "@x402/core/types";
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader, encodePaymentResponseHeader } from "@x402/core/http";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { publicPaymentLink } from "../merchant/payment-links";
import { publicInvoice } from "../subscriptions/service";
import { authorizeSession } from "../payments/service";
import { submitDeposit } from "../intents/oneclick";
import { crossChainStatus } from "../intents/checkout";
import { openCheckout, pay } from "../agents/checkout";
import type { AgentKey } from "../agents/keys";
import { ensureStorage, facilitatorFor, nearExplorer, settle, usdcOnNear, verify } from "./near";

const network = "near:mainnet" as const;
const asset = usdcOnNear[network];
const originAsset = `nep141:${asset}`;
// A deposit address must stay usable for this long after the 402.
const timeoutSeconds = 120;

type Visitor = { ip: string; country?: string | null };
type Kind = "links" | "invoices";

async function resource(kind: Kind, slug: string, url: string) {
  if (kind === "links") {
    const link = await publicPaymentLink(slug);
    if (!link) throw new PortalError("PAYMENT_LINK_UNAVAILABLE", 404);
    if (link.environment !== "production") throw new PortalError("X402_LIVE_ONLY", 409);
    return { url, description: `${link.merchant}: ${link.title}`, mimeType: "application/json" };
  }
  const invoice = await publicInvoice(slug);
  if (!invoice) throw new PortalError("INVOICE_NOT_PAYABLE", 404);
  if (invoice.environment !== "production") throw new PortalError("X402_LIVE_ONLY", 409);
  return { url, description: `${invoice.merchant}: invoice ${invoice.number}`, mimeType: "application/json" };
}

function requirement(record: { depositAddress: string; amountIn: string }, checkout: string, token: string): PaymentRequirements {
  return {
    scheme: "exact",
    network,
    asset,
    amount: record.amountIn,
    payTo: record.depositAddress,
    maxTimeoutSeconds: timeoutSeconds,
    // The checkout this payment is for, so the paid retry finds it.
    extra: { checkout, checkoutToken: token },
  };
}

// Whether x402 can be offered at all: live, with a mainnet relayer.
export async function x402Available() {
  return !!(await facilitatorFor(network).catch(() => null));
}

// 402 Payment Required for a fresh checkout of the link or invoice.
async function required(kind: Kind, slug: string, url: string, visitor: Visitor, key: AgentKey | null) {
  const info = await resource(kind, slug, url);
  const f = await facilitatorFor(network);
  if (!f) throw new PortalError("X402_NOT_CONFIGURED", 503);
  const opened = await openCheckout(kind === "links" ? { link: slug } : { invoice: slug }, visitor);
  // The same quote a customer paying in USDC from NEAR gets. Refunds, should
  // 1Click not complete the swap, go to the relayer, which returns them.
  const instructions = (await pay(opened.checkout, opened.token, { token: `swap:${originAsset}`, from: "wallet", refundTo: f.relayer.accountId }, key)) as {
    kind: string;
    address?: string;
  };
  if (instructions.kind !== "transfer" || !instructions.address) throw new PortalError("X402_ROUTE_UNAVAILABLE", 409);
  const record = await db.crossChainPayment.findUniqueOrThrow({ where: { depositAddress: instructions.address } });
  const body: PaymentRequired = {
    x402Version: 2,
    error: "Payment required",
    resource: info,
    accepts: [requirement(record, opened.checkout, opened.token)],
  };
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "PAYMENT-REQUIRED": encodePaymentRequiredHeader(body) },
  });
}

// The paid retry: verify, settle through the relayer, and hand back the receipt.
async function paid(kind: Kind, slug: string, url: string, header: string, now: Date) {
  let payload: PaymentPayload;
  try {
    payload = decodePaymentSignatureHeader(header);
  } catch {
    throw new PortalError("X402_PAYMENT_INVALID", 400);
  }
  await resource(kind, slug, url);
  const extra = payload.accepted?.extra as { checkout?: unknown; checkoutToken?: unknown } | undefined;
  if (typeof extra?.checkout !== "string" || typeof extra.checkoutToken !== "string") throw new PortalError("X402_PAYMENT_INVALID", 400);
  const { intent } = await authorizeSession(extra.checkout, extra.checkoutToken, now);
  // What PayRouta asked for, re-read from the quote: never from the payload.
  const record = await db.crossChainPayment.findFirst({ where: { intentId: intent.id }, orderBy: { createdAt: "desc" } });
  if (!record || record.originAsset !== originAsset || record.depositAddress !== payload.accepted.payTo) throw new PortalError("X402_PAYMENT_INVALID", 400);
  if (record.status !== "PENDING_DEPOSIT" || record.deadline.getTime() < now.getTime() + timeoutSeconds * 1000) throw new PortalError("X402_QUOTE_EXPIRED", 409);
  const wanted = requirement(record, extra.checkout, extra.checkoutToken);
  if (payload.accepted.amount !== wanted.amount || payload.accepted.asset !== wanted.asset || payload.accepted.network !== wanted.network)
    throw new PortalError("X402_PAYMENT_INVALID", 400);

  await ensureStorage(network, asset, record.depositAddress);
  const verified = await verify(payload, wanted);
  if (!verified.isValid)
    return Response.json({ error: verified.invalidReason ?? "invalid_payment" }, { status: 402, headers: { "Cache-Control": "no-store" } });
  const result = await settle(payload, wanted);
  await db.x402Settlement.create({
    data: {
      orgId: intent.orgId,
      environment: intent.environment,
      source: "checkout",
      network,
      asset,
      amount: wanted.amount,
      payTo: wanted.payTo,
      payer: result.payer ?? null,
      resource: url.slice(0, 2048),
      intentId: intent.id,
      success: result.success,
      transaction: result.transaction || null,
      errorReason: result.errorReason ?? null,
    },
  });
  const headers = { "Cache-Control": "no-store", "PAYMENT-RESPONSE": encodePaymentResponseHeader(result) };
  if (!result.success) return Response.json({ error: result.errorReason ?? "settlement_failed" }, { status: 402, headers });
  await submitDeposit({ txHash: result.transaction, depositAddress: record.depositAddress, ...(result.payer ? { nearSenderAccount: result.payer } : {}) }).catch(() => false);
  const swap = await crossChainStatus(extra.checkout, extra.checkoutToken).catch(() => ({ payment: null }));
  return Response.json(
    {
      paid: true,
      checkout: extra.checkout,
      transaction: result.transaction,
      explorer: nearExplorer(network, result.transaction),
      // NEAR Intents now delivers to the merchant; the checkout confirms when it lands.
      swap: swap.payment,
      status: { method: "GET", url: `/api/agent/v1/checkouts/${extra.checkout}`, headers: { "PayRouta-Checkout-Token": extra.checkoutToken } },
    },
    { headers },
  );
}

export async function x402Pay(kind: Kind, slug: string, request: Request, visitor: Visitor, key: AgentKey | null, now = new Date()) {
  const url = new URL(request.url);
  const resourceUrl = `${url.origin}${url.pathname}`;
  const header = request.headers.get("payment-signature");
  return header ? paid(kind, slug, resourceUrl, header, now) : required(kind, slug, resourceUrl, visitor, key);
}
