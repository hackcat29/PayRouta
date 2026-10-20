// Shopify webhooks: app/uninstalled and the mandatory compliance topics
// (customers/data_request, customers/redact, shop/redact).
import { NextRequest } from "next/server";
import { handleWebhook } from "@/lib/integrations/shopify";
import { rawBody } from "@/lib/payments/http";
import { PortalError } from "@/lib/portal/domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(r: NextRequest) {
  try {
    await handleWebhook(
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
