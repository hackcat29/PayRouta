// PayRouta's MCP server (docs/mcp.md): a merchant's AI assistant creates
// checkouts and payment links, looks up payments and issues refunds through
// the Model Context Protocol, with a merchant API key. Each tool needs the
// same scope as the API it stands for; refunds need refunds:write, which a
// key has only when the merchant grants it.
//
// Streamable HTTP, answered as plain JSON: initialize, ping, tools/list and
// tools/call. No server-sent events and no sessions; every call carries the
// key.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../portal/domain";
import { atomic } from "../portal/service";
import { errorText } from "../error-copy";
import { createUniversalCheckout } from "../payments/universal";
import { merchantConfiguration } from "../merchant/configuration";
import { insertPaymentLink, listPaymentLinks, paymentLinkInput } from "../merchant/payment-links";
import { intents } from "../merchant/service";
import { requestRefund } from "../treasury/refunds";
import { fiatPaymentMethodIds } from "../providers/normalized";

export const protocolVersions = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Tenant = { orgId: string; environment: string; keyId: string };
export type McpContext = { authorize(scope?: string): Promise<Tenant>; origin: string };

type Tool = {
  name: string;
  title: string;
  description: string;
  scope: string;
  input: z.ZodType;
  readOnly?: boolean;
  destructive?: boolean;
  run(args: never, t: Tenant, ctx: McpContext): Promise<unknown>;
};

const checkoutArgs = z
  .object({
    reference: z.string().trim().min(1).max(100).describe("Your order reference"),
    amount: z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,8})?$/).describe('Decimal amount, e.g. "49.99"'),
    currency: z.string().regex(/^[A-Z]{3}$/),
    payerCountry: z.string().regex(/^[A-Z]{2}$/).describe("ISO country of the customer"),
    methods: z.array(z.enum(fiatPaymentMethodIds)).max(fiatPaymentMethodIds.length).default([]),
    crypto: z.boolean().default(false).describe("Offer stablecoins and crypto (USD only)"),
    returnUrl: z.url().max(2048),
    idempotencyKey: z.string().regex(/^[\w-]{8,80}$/).optional(),
  })
  .strict();

const tools: Tool[] = [
  {
    name: "create_checkout",
    title: "Create a checkout",
    description: "Create a checkout for one order and return the link the customer pays at.",
    scope: "payments:write",
    input: checkoutArgs,
    async run(args: z.infer<typeof checkoutArgs>, t, ctx) {
      const crypto = args.crypto
        ? (await merchantConfiguration(t.orgId, t.environment)).stablecoinAssets
            .filter((a) => a.configured && a.executionEnabled)
            .map((a) => ({ network: a.network, identifier: a.identifier }))
            .slice(0, 20)
        : [];
      if (args.crypto && !crypto.length) throw new PortalError("PAYMENT_LINK_CRYPTO_NOT_CONFIGURED", 409);
      const checkout = await createUniversalCheckout(t.orgId, t.environment, args.idempotencyKey ?? `mcp-${randomUUID()}`, {
        reference: args.reference,
        payerCountry: args.payerCountry,
        amount: args.amount,
        currency: args.currency,
        methods: args.methods,
        ...(crypto.length ? { crypto: { options: crypto } } : {}),
        returnUrl: args.returnUrl,
      });
      return { id: checkout.id, url: `${ctx.origin}${checkout.checkoutPath}`, expiresAt: checkout.expiresAt };
    },
  },
  {
    name: "create_payment_link",
    title: "Create a payment link",
    description: "Create a reusable payment link to share on WhatsApp, Instagram, SMS or an invoice.",
    scope: "payments:write",
    input: paymentLinkInput,
    async run(args, t, ctx) {
      const link = await insertPaymentLink(t.orgId, t.environment, args, t.keyId);
      return { ...link, url: `${ctx.origin}${link.path}` };
    },
  },
  {
    name: "list_payment_links",
    title: "List payment links",
    description: "Your payment links, newest first, with how many checkouts each has opened.",
    scope: "payments:read",
    readOnly: true,
    input: z.object({}).strict(),
    async run(_args, t, ctx) {
      return { links: (await listPaymentLinks(t.orgId, t.environment)).map((l) => ({ ...l, url: `${ctx.origin}${l.path}` })) };
    },
  },
  {
    name: "list_payments",
    title: "List payments",
    description: "Payments, newest first. Filter by state or your order reference.",
    scope: "payments:read",
    readOnly: true,
    input: z
      .object({
        state: z.string().max(40).optional(),
        reference: z.string().max(100).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        cursor: z.string().max(400).optional(),
      })
      .strict(),
    async run(args: { state?: string; reference?: string; limit: number; cursor?: string }, t) {
      const params = new URLSearchParams({ limit: String(args.limit) });
      for (const k of ["state", "reference", "cursor"] as const) if (args[k]) params.set(k, args[k]!);
      return intents({ orgId: t.orgId, environment: t.environment }, params);
    },
  },
  {
    name: "get_payment",
    title: "Get a payment",
    description: "One payment by id, with its state and amounts.",
    scope: "payments:read",
    readOnly: true,
    input: z.object({ id: z.string().min(1).max(100) }).strict(),
    async run(args: { id: string }, t) {
      return intents({ orgId: t.orgId, environment: t.environment }, new URLSearchParams(), args.id);
    },
  },
  {
    name: "refund_payment",
    title: "Refund a payment",
    description: "Refund a card, wallet or bank payment, in full or in part. Moves money back to the customer.",
    scope: "refunds:write",
    destructive: true,
    input: z
      .object({
        id: z.string().min(1).max(100).describe("Payment id"),
        amountMinor: z.string().regex(/^[1-9]\d{0,29}$/).optional().describe("Minor units; omit to refund what remains"),
        reason: z.string().trim().min(3).max(500).optional(),
      })
      .strict(),
    async run(args: { id: string; amountMinor?: string; reason?: string }, t) {
      const refund = await atomic((tx) =>
        requestRefund(tx, {
          orgId: t.orgId,
          environment: t.environment,
          intentId: args.id,
          amountMinor: args.amountMinor ? BigInt(args.amountMinor) : undefined,
          reason: args.reason,
          initiatedBy: t.keyId,
          now: new Date(),
        }),
      );
      return { id: refund.id, amountMinor: refund.amountMinor.toFixed(0), state: refund.state };
    },
  },
];

const message = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const error = (id: string | number | null, code: number, text: string) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
const toolError = (text: string) => ({ content: [{ type: "text", text }], isError: true });

// One JSON-RPC message in, its response out; null for notifications.
export async function handleMcp(raw: unknown, ctx: McpContext) {
  const parsed = message.safeParse(raw);
  if (!parsed.success) return error(null, -32600, "Invalid request");
  const { id, method, params } = parsed.data;
  if (id === undefined) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id, result });
  try {
    if (method === "ping") return ok({});
    if (method === "initialize") {
      await ctx.authorize();
      const asked = typeof params?.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        protocolVersion: protocolVersions.includes(asked) ? asked : protocolVersions[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "payrouta", title: "PayRouta", version: "1.0.0" },
      });
    }
    if (method === "tools/list") {
      await ctx.authorize();
      return ok({
        tools: tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: z.toJSONSchema(t.input, { io: "input" }),
          annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
        })),
      });
    }
    if (method === "tools/call") {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return error(id, -32602, `Unknown tool: ${String(params?.name)}`);
      const args = tool.input.safeParse(params?.arguments ?? {});
      if (!args.success) return ok(toolError(`Invalid arguments: ${args.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`));
      try {
        const tenant = await ctx.authorize(tool.scope);
        const result = JSON.parse(JSON.stringify(await tool.run(args.data as never, tenant, ctx)));
        return ok({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result });
      } catch (e) {
        if (e instanceof PortalError && e.status === 401) throw e;
        if (e instanceof PortalError && e.message === "FORBIDDEN") return ok(toolError(`This API key doesn't have the ${tool.scope} permission.`));
        const code = e instanceof PortalError ? e.message : e instanceof z.ZodError ? "INVALID_REQUEST" : "SERVICE_UNAVAILABLE";
        if (!(e instanceof PortalError) && !(e instanceof z.ZodError)) console.error("mcp tool failed", tool.name, e);
        return ok(toolError(`${code}: ${errorText({ error: code }, e instanceof PortalError ? e.status : 500)}`));
      }
    }
    return error(id, -32601, `Method not found: ${method}`);
  } catch (e) {
    if (e instanceof PortalError && e.status === 401) return error(id, -32001, "Unauthorized: send a PayRouta API key as a bearer token");
    if (e instanceof PortalError && e.status === 403) return error(id, -32003, `Forbidden: ${e.message}`);
    console.error("mcp request failed", method, e);
    return error(id, -32603, "Internal error");
  }
}
