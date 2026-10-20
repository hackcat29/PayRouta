// Shared guards for the /api/marketing routes.
import { NextResponse } from "next/server";
import { csrf, internal, rateLimit } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";

const noStore = { "Cache-Control": "no-store" };

export function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof PortalError) return json({ error: error.message }, error.status);
  console.error("[marketing]", error instanceof Error ? error.message : error);
  return json({ error: fallback }, 500);
}

// Campaigns, subscriber lists and stats are for operations admins only, with a
// verified authenticator. State-changing requests must come from our origin.
export async function requireMarketingAdmin(request: Request) {
  if (request.method !== "GET") csrf(request);
  return internal(true, request.headers);
}

// Public endpoints are limited per client address.
export async function limitByClient(request: Request, bucket: string, max: number) {
  const ip = request.headers.get("x-real-ip")?.trim() || "unknown";
  await rateLimit(`${bucket}:${ip}`, max);
}

// Browsers send Origin on cross-site POSTs. Compare its host with the Host
// header the request arrived on (req.url is normalised by Next and can differ).
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
