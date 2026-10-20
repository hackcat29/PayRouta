// Shopify app URL. Shopify opens it when a merchant installs PayRouta from
// Shopify or opens the app; PayRouta asks the merchant to sign in and choose
// the PayRouta business to connect (/merchant/developers/integrations).
import { NextRequest, NextResponse } from "next/server";
import { shopDomain, verifyQueryHmac } from "@/lib/integrations/shopify";
import { secretManager } from "@/lib/portal/adapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: NextRequest) {
  const params = new URL(r.url).searchParams;
  const ref = process.env.SHOPIFY_API_SECRET_REF;
  try {
    if (!ref || !verifyQueryHmac(params, await secretManager.get(ref))) return new NextResponse(null, { status: 401 });
    const shop = shopDomain(params.get("shop"));
    return NextResponse.redirect(new URL(`/merchant/developers/integrations?shopify=${encodeURIComponent(shop)}`, r.url));
  } catch {
    return new NextResponse(null, { status: 400 });
  }
}
