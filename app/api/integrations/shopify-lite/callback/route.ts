// Shopify (manual payment method) OAuth callback: verifies the HMAC and
// state, stores the shop's token in the vault and links the shop to the
// PayRouta business that began the install.
import { NextRequest, NextResponse } from "next/server";
import { completeLiteInstall } from "@/lib/integrations/shopify-lite";
import { merchantMember } from "@/lib/merchant/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: NextRequest) {
  const params = new URL(r.url).searchParams;
  try {
    const pending = JSON.parse(r.cookies.get("shopify_lite_oauth")?.value ?? "{}");
    await merchantMember(pending.orgId ?? "", "configure", r.headers);
    await completeLiteInstall(params, pending);
    const response = NextResponse.redirect(new URL(`/merchant/developers/integrations?orgId=${encodeURIComponent(pending.orgId)}`, r.url));
    response.cookies.delete({ name: "shopify_lite_oauth", path: "/api/integrations/shopify-lite/callback" });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/merchant/developers/integrations?shopifyError=callback", r.url));
  }
}
