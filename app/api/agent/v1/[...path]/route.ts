// The agent API (lib/agents/checkout.ts, docs/agents.md): AI agents pay
// payment links, subscription invoices and checkouts over HTTP. A checkout is authorized by its
// token in the PayRouta-Checkout-Token header; an agent key, when sent as
// a bearer token, holds the agent to its spending limits.
import { NextRequest } from "next/server";
import { respond, rawBody, failure } from "@/lib/payments/http";
import { rateLimit } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import { agentKeyFrom, agentSpending } from "@/lib/agents/keys";
import { describe, invoiceTerms, linkTerms, openCheckout, pay, status, submit } from "@/lib/agents/checkout";
import { x402Pay } from "@/lib/x402/checkout";
import { orderPublicKey } from "@/lib/agents/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ipOf = (r: NextRequest) => r.headers.get("x-real-ip") || r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
const tokenOf = (r: NextRequest) => {
  const token = r.headers.get("payrouta-checkout-token") || "";
  if (!token) throw new PortalError("CHECKOUT_EXPIRED_OR_UNAUTHORIZED", 401);
  return token;
};

export async function GET(r: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const [resource, id, ...rest] = (await params).path;
  // x402 (lib/x402/checkout.ts): a link or invoice paid in USDC on NEAR by
  // any x402 client.
  if (resource === "x402" && (id === "links" || id === "invoices") && rest.length === 1) {
    try {
      await rateLimit(`agent-x402:${ipOf(r)}`, 30);
      const country = r.headers.get("cf-ipcountry") || r.headers.get("x-vercel-ip-country");
      return await x402Pay(id, rest[0], r, { ip: ipOf(r), country }, await agentKeyFrom(r));
    } catch (e) {
      const { body, status: code } = failure(e);
      return Response.json(body, { status: code, headers: { "Cache-Control": "no-store" } });
    }
  }
  // 402 Payment Required: what a payment link costs and how to pay it.
  if ((resource === "links" || resource === "invoices") && id && !rest.length) {
    try {
      await rateLimit(`agent:${ipOf(r)}`, 120);
      const origin = new URL(r.url).origin;
      const terms = resource === "links" ? await linkTerms(id, origin) : await invoiceTerms(id, origin);
      return Response.json(terms, { status: "state" in terms && terms.state !== "Open" ? 200 : 402, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      const { body, status: code } = failure(e);
      return Response.json(body, { status: code });
    }
  }
  return respond(async () => {
    // The key PayRouta signs agent-vault orders with: a vault's owner sets
    // it as the vault's order_signer (docs/agent-vault.md).
    if (resource === "order-key" && !id) {
      const key = await orderPublicKey();
      if (!key) throw new PortalError("AGENT_ORDERS_NOT_CONFIGURED", 503);
      return { orderSigner: key, domain: "PayRouta agent order v1" };
    }
    // The calling agent key's budget, spending this period and payments.
    if (resource === "spending" && !id) {
      const key = await agentKeyFrom(r);
      if (!key) throw new PortalError("UNAUTHORIZED", 401);
      return { name: key.name, environment: key.environment, ...(await agentSpending(key)) };
    }
    if (resource !== "checkouts" || !id || rest.length) throw new PortalError("NOT_FOUND", 404);
    await rateLimit(`agent-checkout:${id}`, 120);
    return status(id, tokenOf(r));
  });
}

export async function POST(r: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const [resource, id, action, ...rest] = (await params).path;
  let created = false;
  const response = await respond(async () => {
    if (resource !== "checkouts" || rest.length) throw new PortalError("NOT_FOUND", 404);
    const key = await agentKeyFrom(r);
    const body = JSON.parse((await rawBody(r)) || "{}");
    if (!id) {
      await rateLimit(`agent:${ipOf(r)}`, 30);
      created = true;
      const country = r.headers.get("cf-ipcountry") || r.headers.get("x-vercel-ip-country");
      return openCheckout(body, { ip: ipOf(r), country });
    }
    await rateLimit(`agent-checkout:${id}`, 60);
    if (action === "pay") return pay(id, tokenOf(r), body, key);
    if (action === "submit") return submit(id, tokenOf(r), body);
    if (!action) return describe(id, tokenOf(r));
    throw new PortalError("NOT_FOUND", 404);
  });
  return created && response.status === 200 ? new Response(response.body, { status: 201, headers: response.headers }) : response;
}
