import { z } from "zod";
import { csrf } from "@/lib/portal/access";
import { respond, rawBody } from "@/lib/payments/http";
import { merchantMember } from "@/lib/merchant/access";
import {
  configurePartnerConnection,
  partnerOnboardingLink,
  partnerOverview,
  qualifyPartner,
  refreshPartner,
  requestPartnerAccounts,
  reviewScreening,
  revokePartnerConsent,
  saveKybProfile,
} from "@/lib/partners/service";

const orgId = z.string().min(1).max(100);
const partnerId = z.string().min(1).max(41);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("profile"), orgId, input: z.unknown() }).strict(),
  z.object({ action: z.literal("request"), orgId, input: z.unknown() }).strict(),
  z.object({ action: z.literal("link"), orgId, partnerId }).strict(),
  z.object({ action: z.literal("refresh"), orgId, partnerId }).strict(),
  z.object({ action: z.literal("revoke"), orgId, partnerId }).strict(),
]);

export async function POST(request: Request) {
  return respond(async () => {
    csrf(request);
    const raw = JSON.parse(await rawBody(request));
    // Operations actions authorize themselves (internal admin + step-up).
    if (raw?.action === "partner-connection")
      return configurePartnerConnection(raw, request.headers);
    if (raw?.action === "partner-qualify") return qualifyPartner(raw, request.headers);
    if (raw?.action === "partner-screening-review")
      return reviewScreening(raw, request.headers);
    const b = command.parse(raw);
    if (b.action === "profile") return saveKybProfile(b.orgId, b.input, request.headers);
    if (b.action === "request")
      return requestPartnerAccounts(b.orgId, b.input, request.headers);
    if (b.action === "link") return partnerOnboardingLink(b.orgId, b.partnerId, request.headers);
    if (b.action === "refresh") return refreshPartner(b.orgId, b.partnerId, request.headers);
    return revokePartnerConsent(b.orgId, b.partnerId, request.headers);
  });
}

export async function GET(request: Request) {
  return respond(async () => {
    const id = orgId.parse(new URL(request.url).searchParams.get("orgId"));
    const { config } = await merchantMember(id, "read", request.headers);
    return partnerOverview(id, config.environment);
  });
}
