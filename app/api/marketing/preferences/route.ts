import { NextRequest, NextResponse } from "next/server";
import {
  MarketingService,
  MARKETING_TOPICS,
} from "@/lib/email/marketing-service";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.json(
      { error: "Missing subscription token" },
      { status: 400 },
    );
  }

  const subscriber = await MarketingService.getSubscriberByToken(token);
  if (!subscriber) {
    return NextResponse.json(
      { error: "Subscriber not found or token has expired" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    email: subscriber.email,
    name: subscriber.name,
    status: subscriber.status,
    topics: subscriber.topics,
    availableTopics: MARKETING_TOPICS,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { token, topics, unsubscribeAll } = body;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Missing token" }, { status: 400 });
    }

    const updated = await MarketingService.updateSubscriberPreferences(token, {
      topics: Array.isArray(topics) ? topics : undefined,
      unsubscribeAll: Boolean(unsubscribeAll),
    });

    return NextResponse.json({
      success: true,
      message: unsubscribeAll
        ? "You have been successfully unsubscribed from all marketing emails."
        : "Your email preferences have been updated.",
      subscriber: {
        email: updated.email,
        status: updated.status,
        topics: updated.topics,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to update preferences";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
