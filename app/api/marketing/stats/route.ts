import { MarketingService } from "@/lib/email/marketing-service";
import { errorResponse, json, requireMarketingAdmin } from "@/lib/email/http";

export async function GET(req: Request) {
  try {
    await requireMarketingAdmin(req);
    return json(await MarketingService.getMarketingAnalytics());
  } catch (error) {
    return errorResponse(error, "Failed to load stats");
  }
}
