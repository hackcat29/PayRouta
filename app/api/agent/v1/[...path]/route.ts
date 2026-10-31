// The agent API (lib/agents/checkout.ts, docs/agents.md): AI agents pay
// payment links and checkouts over HTTP. A checkout is authorized by its
// token in the PayRouta-Checkout-Token header; an agent key, when sent as
// a bearer token, holds the agent to its spending limits.
import { NextRequest } from "next/server";
import { respond, rawBody, failure } from "@/lib/payments/http";
import { rateLimit } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import { agentKeyFrom } from "@/lib/agents/keys";
import { describe, linkTerms, openCheckout, pay, status, submit } from "@/lib/agents/checkout";

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
  // 402 Payment Required: what a payment link costs and how to pay it.
  if (resource === "links" && id && !rest.length) {
    try {
      await rateLimit(`agent:${ipOf(r)}`, 120);
      return Response.json(await linkTerms(id, new URL(r.url).origin), { status: 402, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      const { body, status: code } = failure(e);
      return Response.json(body, { status: code });
    }
  }
  return respond(async () => {
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
