import { NextResponse } from "next/server";
import { MarketingService } from "@/lib/email/marketing-service";
import { verifyResendWebhook } from "@/lib/email/resend-client";

// Resend delivery events, signed with RESEND_WEBHOOK_SECRET (the "whsec_…"
// value shown when you add the webhook in Resend). Unsigned or stale requests
// are rejected, so nobody can mark addresses bounced or unsubscribed.
export async function POST(req: Request) {
  if (!process.env.RESEND_WEBHOOK_SECRET || !process.env.RESEND_API_KEY)
    return NextResponse.json({ error: "Resend webhook is not configured" }, { status: 503 });
  const payload = await req.text();
  if (payload.length > 256_000)
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const event = verifyResendWebhook(payload, req.headers);
  if (!event?.type || !event.data)
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  try {
    const result = await MarketingService.handleResendWebhookEvent(event);
    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    console.error("[Resend webhook]", error instanceof Error ? error.message : error);
    // A 5xx makes Resend retry the delivery later.
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
