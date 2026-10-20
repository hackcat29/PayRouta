import { timingSafeEqual } from "node:crypto";
import { MarketingService } from "@/lib/email/marketing-service";
import { errorResponse, json, requireMarketingAdmin } from "@/lib/email/http";

// The worker (npm run portal:worker) already sends due onboarding emails. This
// endpoint is for an external scheduler holding CRON_SECRET, or an ops admin.
function bearerOk(request: Request) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || secret.length < 32 || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

async function run(request: Request) {
  try {
    if (!bearerOk(request)) await requireMarketingAdmin(request);
    const result = await MarketingService.processScheduledDrips();
    return json({ success: true, ...result });
  } catch (error) {
    return errorResponse(error, "Drip processing failed");
  }
}

export const GET = run;
export const POST = run;
