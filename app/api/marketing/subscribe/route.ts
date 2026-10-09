import { NextRequest, NextResponse } from "next/server";
import { MarketingService } from "@/lib/email/marketing-service";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Simple anti-spam honeypot
    if (body.website_url_hp) {
      return NextResponse.json({ success: true, message: "Subscribed" });
    }

    const { email, name, role, topics, source } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "A valid email address is required" },
        { status: 400 },
      );
    }

    const subscriber = await MarketingService.subscribe({
      email,
      name: typeof name === "string" ? name : undefined,
      role: ["merchant", "developer", "provider"].includes(role)
        ? role
        : "subscriber",
      source: typeof source === "string" ? source : "landing_page",
      topics: Array.isArray(topics) ? topics : undefined,
      sendWelcome: true,
    });

    return NextResponse.json({
      success: true,
      message: "You're all set! Check your inbox for your welcome guide.",
      subscriber: {
        id: subscriber.id,
        email: subscriber.email,
        status: subscriber.status,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to subscribe";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
