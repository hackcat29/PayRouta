// The MCP endpoint (lib/mcp/server.ts, docs/mcp.md). Authorized by a
// merchant API key as a bearer token (the environment comes from the key
// unless the PayRouta-Environment header names it), or by an agent key,
// which gets the buyer tools (lib/mcp/buyer.ts).
import { authenticate } from "@/lib/merchant/access";
import { handleMcp } from "@/lib/mcp/server";
import { PortalError } from "@/lib/portal/domain";
import { agentKeyFrom } from "@/lib/agents/keys";
import { rateLimit } from "@/lib/portal/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = JSON.parse(await request.text());
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  if (Array.isArray(body))
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported" } }, { status: 400 });
  const headers = new Headers(request.headers);
  const prefix = headers.get("authorization")?.match(/^Bearer pr_(sandbox|production)_/)?.[1];
  if (!headers.get("payrouta-environment") && prefix) headers.set("payrouta-environment", prefix);
  const keyed = new Request(request.url, { method: "POST", headers });
  const authorize = async (scope?: string) => {
    if (!prefix) throw new PortalError("UNAUTHORIZED", 401);
    return authenticate(keyed, scope);
  };
  const isAgent = /^Bearer pra_/.test(headers.get("authorization") ?? "");
  const ip = headers.get("x-real-ip") || headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const agent = isAgent
    ? async () => {
        const key = await agentKeyFrom(request);
        if (!key) throw new PortalError("UNAUTHORIZED", 401);
        await rateLimit(`agent-mcp:${key.id}`, 120);
        return key;
      }
    : undefined;
  const response = await handleMcp(body, {
    authorize,
    origin: new URL(request.url).origin,
    agent,
    visitor: { ip, country: headers.get("cf-ipcountry") || headers.get("x-vercel-ip-country") },
  });
  if (!response) return new Response(null, { status: 202 });
  const unauthorized = "error" in response && response.error.code === -32001;
  return Response.json(response, {
    status: unauthorized ? 401 : 200,
    headers: { "Cache-Control": "no-store", ...(unauthorized ? { "WWW-Authenticate": 'Bearer realm="payrouta"' } : {}) },
  });
}

// No server-sent events and no sessions to end.
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
