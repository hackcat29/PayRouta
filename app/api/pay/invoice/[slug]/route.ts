// The Pay button on a subscription invoice page: opens its checkout.
import { NextRequest, NextResponse } from "next/server";
import { csrf } from "@/lib/portal/access";
import { startInvoiceCheckout } from "@/lib/subscriptions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(r: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  try {
    csrf(r);
    const ip = r.headers.get("x-real-ip") || r.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const country = r.headers.get("cf-ipcountry") || r.headers.get("x-vercel-ip-country");
    return NextResponse.redirect(await startInvoiceCheckout(slug, { ip, country }), 303);
  } catch {
    return NextResponse.redirect(new URL(`/pay/invoice/${encodeURIComponent(slug)}?error=1`, r.url), 303);
  }
}
