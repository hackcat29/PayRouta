// MCP tools for a buyer's AI agent (docs/agents.md): with an agent key, an
// agent pays PayRouta payment links and subscription invoices from its own
// wallet, within the key's limits. PayRouta never holds the agent's keys, so
// paying is two steps the agent can always complete: PayRouta says exactly
// what to send (or the intent to sign), the agent's wallet sends or signs it.
import { z } from "zod";
import { describe, invoiceTerms, linkTerms, openCheckout, pay, status, submit } from "../agents/checkout";
import { agentSpending, type AgentKey } from "../agents/keys";

export type BuyerContext = { origin: string; visitor: { ip: string; country?: string | null } };

export type BuyerTool = {
  name: string;
  title: string;
  description: string;
  input: z.ZodType;
  readOnly?: boolean;
  destructive?: boolean;
  run(args: never, key: AgentKey, ctx: BuyerContext): Promise<unknown>;
};

const checkoutRef = {
  checkout: z.string().min(1).max(100).describe("The checkout id from open_checkout"),
  checkoutToken: z.string().min(20).max(200).describe("The checkout token from open_checkout"),
};

// A payment link or invoice, by URL or slug.
const target = z
  .string()
  .trim()
  .min(6)
  .max(2048)
  .describe("A PayRouta payment link or invoice URL (…/pay/{slug} or …/pay/invoice/{slug}), or a checkout URL");

const kindOf = (url: string) =>
  /\/checkout\/[\w-]+#/.test(url)
    ? ({ checkoutUrl: url } as const)
    : /\/pay\/invoice\//.test(url)
      ? ({ invoice: url } as const)
      : ({ link: url } as const);
const slugOf = (url: string) => url.match(/\/pay\/(?:invoice\/)?([A-Za-z0-9]{6,20})(?:[/?#]|$)/)?.[1] ?? url;

export const buyerTools: BuyerTool[] = [
  {
    name: "get_payment_terms",
    title: "Read what a link or invoice costs",
    description:
      "The merchant, amount, currency and how an agent can pay a PayRouta payment link or subscription invoice. Read-only; opens nothing.",
    readOnly: true,
    input: z.object({ url: target }).strict(),
    async run(args: { url: string }, _key, ctx) {
      const slug = slugOf(args.url);
      return /\/pay\/invoice\//.test(args.url) ? invoiceTerms(slug, ctx.origin) : linkTerms(slug, ctx.origin);
    },
  },
  {
    name: "open_checkout",
    title: "Open a checkout",
    description:
      "Open a checkout for a payment link, invoice or checkout URL. Returns the checkout id and token, the amount, and payWith: each network with the tokens this agent can pay with.",
    input: z.object({ url: target }).strict(),
    async run(args: { url: string }, _key, ctx) {
      const opened = await openCheckout(kindOf(args.url), ctx.visitor);
      return { ...opened, checkoutToken: opened.token, token: undefined };
    },
  },
  {
    name: "pay_checkout",
    title: "Pay a checkout",
    description:
      "Start paying within this key's limits. from=wallet returns the exact on-chain transfer to send (address, token, amount); from=intents returns a NEAR Intents payload to sign, then call submit_signed_intent. Reserves the amount against the key's budget.",
    destructive: true,
    input: z
      .object({
        ...checkoutRef,
        asset: z.string().min(1).max(320).describe("A token key from payWith"),
        from: z.enum(["wallet", "intents"]),
        refundTo: z.string().min(2).max(140).optional().describe("wallet + swap: your address on the network you pay from"),
        payer: z.string().min(2).max(64).optional().describe("intents: the NEAR Intents account that signs"),
      })
      .strict(),
    async run(
      args: { checkout: string; checkoutToken: string; asset: string; from: "wallet" | "intents"; refundTo?: string; payer?: string },
      key,
    ) {
      return pay(args.checkout, args.checkoutToken, {
        token: args.asset,
        from: args.from,
        ...(args.refundTo ? { refundTo: args.refundTo } : {}),
        ...(args.payer ? { payer: args.payer } : {}),
      }, key);
    },
  },
  {
    name: "submit_signed_intent",
    title: "Submit a signed intent",
    description: "Submit the NEAR Intents transfer you signed after pay_checkout with from=intents.",
    destructive: true,
    input: z
      .object({
        ...checkoutRef,
        payment: z.string().min(1).max(100),
        signature: z.string().min(1).max(400),
        publicKey: z.string().min(1).max(200),
      })
      .strict(),
    async run(args: { checkout: string; checkoutToken: string; payment: string; signature: string; publicKey: string }) {
      return submit(args.checkout, args.checkoutToken, { payment: args.payment, signature: args.signature, publicKey: args.publicKey });
    },
  },
  {
    name: "get_checkout_status",
    title: "Check a checkout",
    description: "Where a checkout's payment is. paid is true once the merchant's payment is confirmed.",
    readOnly: true,
    input: z.object(checkoutRef).strict(),
    async run(args: { checkout: string; checkoutToken: string }) {
      return status(args.checkout, args.checkoutToken).catch(() => describe(args.checkout, args.checkoutToken));
    },
  },
  {
    name: "get_spending",
    title: "This key's spending",
    description: "The key's budget and what it has spent this period, with the payments it started, newest first.",
    readOnly: true,
    input: z.object({ limit: z.number().int().min(1).max(100).default(25) }).strict(),
    async run(args: { limit: number }, key) {
      return { name: key.name, environment: key.environment, ...(await agentSpending(key, new Date(), args.limit)) };
    },
  },
];
