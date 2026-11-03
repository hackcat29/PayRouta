import { ZodError } from "zod";
import { rateLimit } from "@/lib/portal/access";
import { submitAccessRequest } from "@/lib/portal/access-requests";
import { PortalError } from "@/lib/portal/domain";
import { verifyTurnstile } from "@/lib/turnstile";

export const runtime = "nodejs";
const MAX_BYTES = 16000;

// Public: payment providers asking for access to the provider workspace.
export async function POST(request: Request) {
  const json = (body: object, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return json({ error: "Use a JSON request." }, 415);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.BETTER_AUTH_URL || request.url).origin)
    return json({ error: "Request origin is not allowed." }, 403);
  if (!(await verifyTurnstile(request)))
    return json({ error: "We couldn't confirm you're not a bot. Reload the page and try again." }, 403);
  const body = await request.text().catch(() => "");
  if (body.length > MAX_BYTES) return json({ error: "Request is too large." }, 413);
  try {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    await rateLimit(`provider-access:${ip}`, 5);
    return json(await submitAccessRequest(JSON.parse(body)));
  } catch (e) {
    if (e instanceof SyntaxError) return json({ error: "Unable to read the request." }, 400);
    if (e instanceof ZodError)
      return json({ error: "Please check the highlighted fields.", errors: e.flatten().fieldErrors }, 400);
    if (e instanceof PortalError) return json({ error: e.message }, e.status);
    console.error("[provider-access] submit failed", e instanceof Error ? e.message : e);
    return json({ error: "We couldn't save your request. Please try again in a few minutes." }, 503);
  }
}
