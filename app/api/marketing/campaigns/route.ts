import { NextRequest } from "next/server";
import { z } from "zod";
import { MarketingService } from "@/lib/email/marketing-service";
import { errorResponse, json, requireMarketingAdmin } from "@/lib/email/http";
import { db } from "@/lib/portal/db";

export async function GET(req: NextRequest) {
  try {
    await requireMarketingAdmin(req);
    const campaigns = await db.marketingCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return json({ campaigns });
  } catch (error) {
    return errorResponse(error, "Failed to load campaigns");
  }
}

const createSchema = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(1).max(200),
  subject: z.string().trim().min(1).max(200),
  previewText: z.string().trim().max(300).optional(),
  templateId: z.string().max(80).optional(),
  targetAudience: z.enum(["all", "merchants", "developers", "providers"]).optional(),
  targetTopics: z.array(z.string()).max(10).optional(),
  contentHtml: z.string().min(1).max(200_000),
  contentText: z.string().max(200_000).optional(),
});
const testSchema = z.object({
  action: z.literal("test"),
  campaignId: z.string().min(1),
  testEmail: z.email(),
});
const launchSchema = z.object({ action: z.literal("launch"), campaignId: z.string().min(1) });
const schema = z.discriminatedUnion("action", [createSchema, testSchema, launchSchema]);

export async function POST(req: NextRequest) {
  try {
    const session = await requireMarketingAdmin(req);
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return json({ error: "Supported actions: create (name, subject, contentHtml), test (campaignId, testEmail), launch (campaignId)" }, 400);
    const body = parsed.data;

    if (body.action === "create") {
      const { action: _action, ...input } = body;
      void _action;
      const campaign = await MarketingService.createCampaign({ ...input, createdBy: session.user.id });
      return json({ success: true, campaign });
    }
    if (body.action === "test") {
      const result = await MarketingService.sendTestCampaign(body.campaignId, body.testEmail);
      return json({ success: result.success, result });
    }
    const result = await MarketingService.launchCampaign(body.campaignId);
    return json({ success: result.failed === 0, result });
  } catch (error) {
    return errorResponse(error, "Campaign action failed");
  }
}
