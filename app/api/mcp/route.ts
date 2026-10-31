// The MCP endpoint (lib/mcp/server.ts, docs/mcp.md). Authorized by a
// merchant API key as a bearer token; the environment comes from the key
// unless the PayRouta-Environment header names it.
import { authenticate } from "@/lib/merchant/access";
import { handleMcp } from "@/lib/mcp/server";
import { PortalError } from "@/lib/portal/domain";

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
  const response = await handleMcp(body, { authorize, origin: new URL(request.url).origin });
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
