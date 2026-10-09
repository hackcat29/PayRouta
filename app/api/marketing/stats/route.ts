import { NextResponse } from "next/server";
import { MarketingService } from "@/lib/email/marketing-service";

export async function GET() {
  try {
    const stats = await MarketingService.getMarketingAnalytics();
    return NextResponse.json(stats);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load stats";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
