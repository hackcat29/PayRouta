// Where PayRouta checkout sends a Shopify buyer back to.
import { NextRequest, NextResponse } from "next/server";
import { returnDestination } from "@/lib/integrations/shopify";
import { rateLimit } from "@/lib/portal/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(r: NextRequest) {
  const session = new URL(r.url).searchParams.get("session") ?? "";
  try {
    await rateLimit(`shopify-return:${session}`, 30);
    const to = new URL(await returnDestination(session));
    if (to.protocol !== "https:" && to.origin !== new URL(r.url).origin) throw new Error("UNSAFE_REDIRECT");
    return NextResponse.redirect(to);
  } catch {
    return new NextResponse("This payment link is no longer available. Return to the store to try again.", { status: 404 });
  }
}
