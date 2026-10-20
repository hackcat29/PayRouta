// The Pay button on a payment link page: opens this customer's own checkout.
import { NextRequest, NextResponse } from "next/server";
import { csrf } from "@/lib/portal/access";
import { startPaymentLinkCheckout } from "@/lib/merchant/payment-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(r: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    csrf(r);
    const ip = r.headers.get("x-real-ip") || r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const country = r.headers.get("cf-ipcountry") || r.headers.get("x-vercel-ip-country");
    const url = await startPaymentLinkCheckout(slug, { ip, country });
    return NextResponse.redirect(url, 303);
  } catch {
    return NextResponse.redirect(new URL(`/pay/${encodeURIComponent(slug)}?error=1`, r.url), 303);
  }
}
