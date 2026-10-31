// Shopify (manual payment method) webhooks: orders/create, app/uninstalled
// and the mandatory compliance topics.
import { NextRequest } from "next/server";
import { handleLiteWebhook } from "@/lib/integrations/shopify-lite";
import { rawBody } from "@/lib/payments/http";
import { PortalError } from "@/lib/portal/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(r: NextRequest) {
  try {
    await handleLiteWebhook(
      r.headers.get("x-shopify-topic"),
      r.headers.get("x-shopify-shop-domain"),
      await rawBody(r, 262144),
      r.headers.get("x-shopify-hmac-sha256"),
    );
    return new Response(null, { status: 200 });
  } catch (e) {
    return new Response(null, { status: e instanceof PortalError && e.status === 401 ? 401 : 500 });
  }
}
