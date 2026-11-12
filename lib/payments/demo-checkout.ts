// The demo checkout (/checkout/demo): the real checkout pages, run against a
// fictional order with no merchant, no database rows and nothing payable.
//
// The checkout's own API (/api/checkout/demo) answers every action the pages
// use. What the customer sees is real where it can be without money moving:
//   - the tokens and chains come from NEAR Intents' live list, priced and
//     ordered exactly as a live checkout lists them (payTokens);
//   - a token's quote is a real 1Click quote for this order, made dry, so it
//     shows what the customer would send and the merchant would receive but
//     creates no deposit address;
//   - a token pasted by its contract address is looked up on Jupiter / LI.FI;
//   - card, wallet, bank and credit run the sandbox flow, with the fictional
//     sandbox lender's plans.
// Paying is simulated: "Simulate the payment" walks the steps a live payment
// goes through. Anything that would sign or send a transaction is refused.
//
// The demo's state (which side, what was chosen, when it was "paid") is kept
// in a cookie for this browser only. It holds nothing secret.
import { z } from "zod";
import { PortalError } from "../portal/domain";
import { destinations, dryQuote, chainNames, tokens, type Http } from "../intents/oneclick";
import { feeAccount, payTokens } from "../intents/checkout";
import { findToken } from "../intents/dex";
import { sandboxOffers } from "../treasury/platforms/sandbox-credit";
import { providerRequest } from "../providers/adapters/http";

export const demoId = "demo";
export const demoCookie = "checkout_demo_state";

// The fictional order: $25.00, paid by card and the like in US dollars, or
// in crypto as 25.00 USDC on Base into the merchant's NEAR Intents account.
const order = {
  merchant: "Harbor Coffee Co.",
  reference: "#1042",
  amount: "25.00",
  currency: "USD",
  payerCountry: "US",
  returnUrl: "/",
  windowMs: 30 * 60000,
} as const;
const settle = destinations.find((d) => d.network === "eip155:8453" && d.symbol === "USDC")!;
// The fictional merchant's NEAR Intents account (an EVM address is its own
// account). Only ever a dry quote's recipient: nothing is sent to it.
const merchantAccount = "0x00000000000000000000000000000000000c0ffe";
// PayRouta's crypto fee, taken at source as on a live checkout.
const feeBps = 150;
const fiatMethods = ["card", "digital-wallet", "bank-transfer", "bnpl"] as const;
// The simulated payment: transfer seen, then the swap, then delivered.
const seenMs = 3000;
const deliveredMs = 9000;

const swapState = z
  .object({
    originAsset: z.string().max(300),
    chain: z.string().max(40),
    symbol: z.string().max(40),
    send: z.string().max(80),
    deadline: z.number(),
    timeEstimate: z.number().optional(),
    paidAt: z.number().optional(),
  })
  .strict();
const stateSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(["crypto", "fiat"]),
    startedAt: z.number(),
    // Crypto: the customer chose how to pay; then the quote, then the payment.
    chosen: z.boolean().optional(),
    swap: swapState.optional(),
    // Fiat: the method and plan, then the test payment.
    method: z.enum(fiatMethods).optional(),
    plan: z.string().max(40).optional(),
    paidAt: z.number().optional(),
  })
  .strict();
export type DemoState = z.infer<typeof stateSchema>;

export function readDemoState(raw: string | undefined, now = Date.now()): DemoState {
  const fresh: DemoState = { v: 1, kind: "crypto", startedAt: now };
  if (!raw) return fresh;
  try {
    const s = stateSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    // An expired demo starts over rather than showing an expired checkout.
    return now - s.startedAt < order.windowMs ? s : fresh;
  } catch {
    return fresh;
  }
}
export const writeDemoState = (s: DemoState) => Buffer.from(JSON.stringify(s)).toString("base64url");

const confirmedAt = (s: DemoState) => (s.kind === "fiat" ? s.paidAt : s.swap?.paidAt !== undefined ? s.swap.paidAt + deliveredMs : undefined);

// What the checkout pages read (GET /api/checkout/demo).
export function demoProgress(s: DemoState, now = Date.now()) {
  const done = confirmedAt(s);
  const confirmed = done !== undefined && done <= now;
  const common = {
    merchant: order.merchant,
    verified: false,
    logo: null,
    website: null,
    supportEmail: null,
    reference: order.reference,
    sandbox: false,
    demo: true,
    expiresAt: new Date(s.startedAt + order.windowMs).toISOString(),
    returnUrl: order.returnUrl,
    state: confirmed ? "Confirmed" : "Created",
  };
  if (s.kind === "fiat")
    return {
      ...common,
      amount: order.amount,
      asset: { kind: "fiat", identifier: order.currency },
      payerCountry: order.payerCountry,
      selectedMethod: s.method ?? null,
      ...(s.method ? { attemptId: "demo-attempt", attemptState: confirmed ? "Succeeded" : "Requires action", action: { kind: "sandbox" } } : { action: null }),
      alternatives: [{ kind: "crypto" as const, available: true }],
    };
  return {
    ...common,
    amount: order.amount,
    symbol: settle.symbol,
    network: settle.network,
    settlement: confirmed ? ["demo"] : [],
    transaction: null,
    alternatives: [{ kind: "fiat" as const, available: true }],
    ...(s.chosen
      ? {
          attemptId: "demo-attempt",
          attemptState: confirmed ? "Succeeded" : "Requires action",
          action: {
            kind: "intents",
            text: "",
            address: merchantAccount,
            network: settle.network,
            identifier: settle.identifier,
            amount: order.amount,
            symbol: settle.symbol,
          },
        }
      : {}),
  };
}

// The swap's progress, as cross-chain-status reports it.
function swapStatus(swap: NonNullable<DemoState["swap"]>, now: number) {
  if (swap.paidAt === undefined) return "PENDING_DEPOSIT";
  const t = now - swap.paidAt;
  return t < seenMs ? "KNOWN_DEPOSIT_TX" : t < deliveredMs ? "PROCESSING" : "SUCCESS";
}
function presentSwap(swap: NonNullable<DemoState["swap"]>, now: number) {
  return {
    demo: true,
    chain: swap.chain,
    chainName: chainNames[swap.chain] ?? swap.chain.toUpperCase(),
    symbol: swap.symbol,
    send: swap.send,
    // A dry quote has no deposit address: there is nothing to send to.
    depositAddress: "",
    depositMemo: null,
    refundTo: "",
    deadline: new Date(swap.deadline).toISOString(),
    status: swapStatus(swap, now),
    ...(swap.timeEstimate !== undefined ? { timeEstimate: swap.timeEstimate } : {}),
    receive: { amount: receives(), symbol: settle.symbol },
    fee: { amount: feeAmount(), symbol: settle.symbol },
  };
}
const gross = () => BigInt(order.amount.replace(".", "")) * 10n ** BigInt(settle.decimals - 2);
const feeMinor = () => (gross() * BigInt(feeBps)) / 10000n;
const units = (minor: bigint) => {
  const s = minor.toString().padStart(settle.decimals + 1, "0");
  return `${s.slice(0, -settle.decimals)}.${s.slice(-settle.decimals)}`.replace(/0+$/, "").replace(/\.$/, ".00");
};
const receives = () => units(gross() - feeMinor());
const feeAmount = () => units(feeMinor());

type Deps = { http?: Http; now?: number };

// Every action the checkout pages send. Returns the response body and the
// demo's next state.
export async function demoAction(
  s: DemoState,
  b: { action: string } & Record<string, unknown>,
  deps: Deps = {},
): Promise<{ body: unknown; state: DemoState }> {
  const now = deps.now ?? Date.now();
  const http = deps.http ?? providerRequest;
  const keep = (body: unknown) => ({ body, state: s });
  const confirmed = (confirmedAt(s) ?? Infinity) <= now;
  switch (b.action) {
    case "switch": {
      const to = b.to === "fiat" ? "fiat" : "crypto";
      if (s.method || s.swap?.paidAt !== undefined) throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
      return { body: { checkoutPath: `/checkout/${demoId}` }, state: { v: 1, kind: to, startedAt: s.startedAt } };
    }
    case "pay-options": {
      const listed = await tokens(http, now).catch(() => []);
      const target = { id: null, network: settle.network, identifier: settle.identifier, symbol: settle.symbol, amount: order.amount, method: "stablecoin", intents: true };
      return keep({ locked: !!s.chosen, ...payTokens([target], true, listed) });
    }
    case "token-lookup":
      return keep(await findToken(String(b.address ?? ""), { http }));
    case "choose-network":
      return keep({ ok: true });
    case "methods":
      if (s.kind === "crypto") return keep({ methods: [{ method: "stablecoin", status: "AVAILABLE" }] });
      return keep({ methods: fiatMethods.map((method) => ({ method, status: "AVAILABLE" })), payerCountry: order.payerCountry });
    case "credit-offers":
      return keep({
        offers: sandboxOffers(gross() / 10n ** BigInt(settle.decimals - 2), order.payerCountry, {
          minMinor: 1000n,
          maxMinor: 500000000n,
          monthlyFromMinor: 5000000n,
          countries: null,
        }).map(({ id, ...o }) => ({ ...o, key: id, currency: order.currency })),
      });
    case "select": {
      if (confirmed) throw new PortalError("PAYMENT_ALREADY_IN_PROGRESS", 409);
      if (s.kind === "crypto") return keep({ routeId: "demo-route" });
      const method = fiatMethods.find((m) => m === b.method);
      if (!method) throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
      const plan = typeof b.creditOffer === "string" ? b.creditOffer : undefined;
      if (method === "bnpl" && !plan) throw new PortalError("CREDIT_PLAN_REQUIRED", 409);
      return { body: { routeId: "demo-route" }, state: { ...s, method, ...(plan ? { plan } : {}) } };
    }
    case "confirm":
      if (s.kind === "crypto") return { body: { attemptId: "demo-attempt", state: "Requires action" }, state: { ...s, chosen: true } };
      if (!s.method) throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
      return keep({ attemptId: "demo-attempt", state: "Requires action" });
    case "complete":
      if (s.kind !== "fiat" || !s.method) throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
      return { body: { ok: true }, state: { ...s, paidAt: s.paidAt ?? now } };
    case "cross-chain-options": {
      const listed = await tokens(http, now).catch(() => []);
      return keep({
        available: listed.length > 0,
        reason: null,
        intents: true,
        receive: { symbol: settle.symbol, amount: order.amount, assetId: settle.assetId },
        assets: listed
          .map((t) => ({ assetId: t.assetId, chain: t.blockchain, chainName: chainNames[t.blockchain] ?? t.blockchain.toUpperCase(), symbol: t.symbol }))
          .sort((a, c) => a.chainName.localeCompare(c.chainName) || a.symbol.localeCompare(c.symbol)),
      });
    }
    case "cross-chain-quote": {
      if (!s.chosen) throw new PortalError("CROSS_CHAIN_NO_TRANSFER_AWAITED", 409);
      if (s.swap?.paidAt !== undefined) return keep(presentSwap(s.swap, now));
      const list = await tokens(http, now);
      const origin = list.find((t) => t.assetId === b.originAsset);
      if (!origin) throw new PortalError("CROSS_CHAIN_ORIGIN_NOT_SUPPORTED", 409);
      const recipient = feeAccount();
      const deadline = s.startedAt + order.windowMs - 90000;
      // The quote a live checkout would ask for, made dry. A failed swap
      // would refund into an intents account, so no refund address is needed.
      const q = await dryQuote(
        {
          originAsset: origin.assetId,
          destinationAsset: settle.assetId,
          amountOut: (gross() - (recipient ? feeMinor() : 0n)).toString(),
          recipient: merchantAccount,
          refundTo: merchantAccount,
          refund: "INTENTS",
          deadline: new Date(deadline),
          to: "INTENTS",
          ...(recipient ? { appFee: { recipient, bps: feeBps } } : {}),
        },
        http,
      );
      const swap = {
        originAsset: origin.assetId,
        chain: origin.blockchain,
        symbol: origin.symbol,
        send: q.quote.amountInFormatted,
        deadline,
        ...(q.quote.timeEstimate !== undefined ? { timeEstimate: q.quote.timeEstimate } : {}),
      };
      return { body: presentSwap(swap, now), state: { ...s, swap } };
    }
    case "cross-chain-status":
      return keep({ payment: s.swap ? presentSwap(s.swap, now) : null });
    case "demo-pay":
      // "Simulate the payment": the customer's transfer, as if it was sent.
      if (s.kind === "crypto") {
        if (!s.swap) throw new PortalError("CROSS_CHAIN_NO_TRANSFER_AWAITED", 409);
        const swap = { ...s.swap, paidAt: s.swap.paidAt ?? now };
        return { body: presentSwap(swap, now), state: { ...s, swap } };
      }
      if (!s.method) throw new PortalError("SELECTED_METHOD_NOT_AVAILABLE", 409);
      return { body: { ok: true }, state: { ...s, paidAt: s.paidAt ?? now } };
    case "refresh":
      return keep({ queued: false });
    case "wallet-link":
      return keep({ checkoutPath: `/checkout/${demoId}` });
    case "demo-reset":
      return { body: { checkoutPath: `/checkout/${demoId}` }, state: { v: 1, kind: s.kind, startedAt: now } };
    default:
      // Signing, sending and wallet transactions: nothing is payable here.
      throw new PortalError("DEMO_NOT_PAYABLE", 409);
  }
}
