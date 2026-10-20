// payment_session_url (offsite). Reached only through the mTLS proxy.
import { NextRequest } from "next/server";
import { startPaymentSession } from "@/lib/integrations/shopify";
import { rawBody, respond } from "@/lib/payments/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(r: NextRequest) {
  return respond(async () => startPaymentSession(r.headers, JSON.parse(await rawBody(r, 65536))));
}
