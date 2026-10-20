// Starts the Shopify install for a signed-in merchant owner or admin. The
// OAuth state cookie binds the install to this PayRouta business.
import { NextRequest, NextResponse } from "next/server";
import { installUrl, newState, shopDomain } from "@/lib/integrations/shopify";
import { merchantMember } from "@/lib/merchant/access";
import { rateLimit } from "@/lib/portal/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: NextRequest) {
  const params = new URL(r.url).searchParams;
  try {
    const shop = shopDomain(params.get("shop"));
    const orgId = params.get("orgId") ?? "";
    const { session, config } = await merchantMember(orgId, "configure", r.headers);
    await rateLimit(`shopify-install:${session.user.id}`, 10);
    const state = newState();
    const response = NextResponse.redirect(installUrl(shop, state));
    response.cookies.set("shopify_oauth", JSON.stringify({ state, orgId, environment: config.environment, shop }), {
      httpOnly: true,
      // Shopify returns with a top-level GET from its admin.
      sameSite: "lax",
      secure: new URL(r.url).protocol === "https:",
      path: "/api/integrations/shopify/callback",
      maxAge: 600,
    });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/merchant/developers/integrations?shopifyError=install", r.url));
  }
}
