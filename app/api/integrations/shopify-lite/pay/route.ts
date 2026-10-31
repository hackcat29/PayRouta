// The Pay now button on Shopify's Thank you and order status pages. The
// extension calls from Shopify's sandbox with the buyer's session token, so
// any origin may call; nothing here relies on cookies.
import { NextRequest } from "next/server";
import { payOrder } from "@/lib/integrations/shopify-lite";
import { failure, rawBody } from "@/lib/payments/http";
import { rateLimit } from "@/lib/portal/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "600",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: cors });
}

export async function POST(r: NextRequest) {
  const headers = { ...cors, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
  try {
    const ip = r.headers.get("x-real-ip") || r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await rateLimit(`shopify-lite-pay:${ip}`, 30);
    const raw = await rawBody(r, 4096);
    const result = await payOrder(r.headers.get("authorization"), JSON.parse(raw || "null"));
    return Response.json(result, { headers });
  } catch (e) {
    const { body, status } = failure(e);
    return Response.json(body, { status, headers });
  }
}
