import { NextResponse } from "next/server";
import { MarketingService } from "@/lib/email/marketing-service";

export async function POST() {
  try {
    const result = await MarketingService.processScheduledDrips();
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Drip processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await MarketingService.processScheduledDrips();
    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Drip processing failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
