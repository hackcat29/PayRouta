// Where PayRouta checkout sends a Shopify (manual payment method) buyer back to.
import { NextRequest, NextResponse } from "next/server";
import { liteReturn } from "@/lib/integrations/shopify-lite";
import { rateLimit } from "@/lib/portal/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: NextRequest) {
  const order = new URL(r.url).searchParams.get("order") ?? "";
  try {
    await rateLimit(`shopify-lite-return:${order}`, 30);
    const to = new URL(await liteReturn(order));
    if (to.protocol !== "https:") throw new Error("UNSAFE_REDIRECT");
    return NextResponse.redirect(to);
  } catch {
    return new NextResponse("This link is no longer available. Return to the store to see your order.", { status: 404 });
  }
}
