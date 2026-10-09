import { NextRequest, NextResponse } from "next/server";
import { MarketingService } from "@/lib/email/marketing-service";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!event || !event.type || !event.data) {
      return NextResponse.json(
        { error: "Invalid webhook format" },
        { status: 400 },
      );
    }

    // Process event in MarketingService
    const result = await MarketingService.handleResendWebhookEvent(event);

    return NextResponse.json({
      received: true,
      processed: result.processed,
      type: event.type,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Webhook handler failed";
    console.error("[Resend Webhook Error]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
