// Shopify OAuth callback: verifies the HMAC and state, stores the shop's
// token in the vault, connects the shop to the PayRouta business that began
// the install, marks the app ready, and sends the merchant to Shopify's
// payment settings to activate PayRouta.
import { NextRequest, NextResponse } from "next/server";
import { completeInstall, connectShop } from "@/lib/integrations/shopify";
import { merchantMember } from "@/lib/merchant/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: NextRequest) {
  const params = new URL(r.url).searchParams;
  let pending: { state?: string; orgId?: string; environment?: "sandbox" | "production"; shop?: string } = {};
  try {
    pending = JSON.parse(r.cookies.get("shopify_oauth")?.value ?? "{}");
  } catch {
    pending = {};
  }
  try {
    const shop = await completeInstall(params, pending.state);
    if (!pending.orgId || !pending.environment || pending.shop !== shop) throw new Error("STATE");
    await merchantMember(pending.orgId, "configure", r.headers);
    const settings = await connectShop({
      shop,
      orgId: pending.orgId,
      environment: pending.environment,
      methods: ["card", "digital-wallet", "bank-transfer", "mobile-money", "ussd", "bnpl"],
      cryptoOptions: [],
    });
    const response = NextResponse.redirect(settings);
    response.cookies.delete({ name: "shopify_oauth", path: "/api/integrations/shopify/callback" });
    return response;
  } catch {
    return NextResponse.redirect(new URL("/merchant/developers/integrations?shopifyError=callback", r.url));
  }
}
