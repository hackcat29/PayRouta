import { NextRequest, NextResponse } from "next/server";
import { MarketingService } from "@/lib/email/marketing-service";
import { db } from "@/lib/portal/db";

export async function GET() {
  try {
    const campaigns = await db.marketingCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ campaigns });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load campaigns";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { action } = body;

    if (action === "create") {
      const {
        name,
        subject,
        previewText,
        templateId,
        targetAudience,
        targetTopics,
        contentHtml,
        contentText,
      } = body;

      if (!name || !subject || !contentHtml) {
        return NextResponse.json(
          { error: "Name, subject, and content are required" },
          { status: 400 },
        );
      }

      const campaign = await MarketingService.createCampaign({
        name,
        subject,
        previewText,
        templateId,
        targetAudience,
        targetTopics,
        contentHtml,
        contentText,
      });

      return NextResponse.json({ success: true, campaign });
    }

    if (action === "test") {
      const { campaignId, testEmail } = body;
      if (!campaignId || !testEmail) {
        return NextResponse.json(
          { error: "campaignId and testEmail are required" },
          { status: 400 },
        );
      }

      const res = await MarketingService.sendTestCampaign(campaignId, testEmail);
      return NextResponse.json({ success: res.success, result: res });
    }

    if (action === "launch") {
      const { campaignId } = body;
      if (!campaignId) {
        return NextResponse.json(
          { error: "campaignId is required" },
          { status: 400 },
        );
      }

      const res = await MarketingService.launchCampaign(campaignId);
      return NextResponse.json({ success: true, result: res });
    }

    return NextResponse.json(
      { error: "Invalid action. Supported actions: create, test, launch" },
      { status: 400 },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Campaign action failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
