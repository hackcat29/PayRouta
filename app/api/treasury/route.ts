import { z } from "zod";
import { csrf } from "@/lib/portal/access";
import { respond, rawBody } from "@/lib/payments/http";
import {
  configureLegalEntity,
  configurePlatformAccount,
  merchantAccountOverview,
  acceptTerms,
  openMerchantPlatformLink,
  saveMerchantVerification,
  requestMerchantPayout,
  requestMerchantRefund,
  respondToDispute,
  rerunReconciliation,
  previewMerchantLive,
  qualifyPlatformAccount,
  reviewMerchantAccount,
  submitForUnderwriting,
} from "@/lib/treasury/service";
import { goLiveWithCrypto } from "@/lib/merchant/go-live";

const orgId = z.string().min(1).max(100);
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), orgId }).strict(),
  z.object({ action: z.literal("accept-terms"), orgId }).strict(),
  z.object({ action: z.literal("go-live-crypto"), orgId }).strict(),
]);

export async function POST(request: Request) {
  return respond(async () => {
    csrf(request);
    const raw = JSON.parse(await rawBody(request));
    // Operations actions authorize themselves (internal admin + step-up).
    if (raw?.action === "legal-entity") return configureLegalEntity(raw, request.headers);
    if (raw?.action === "platform-account")
      return configurePlatformAccount(raw, request.headers);
    if (raw?.action === "platform-account-qualify")
      return qualifyPlatformAccount(raw, request.headers);
    if (raw?.action === "merchant-account-transition")
      return reviewMerchantAccount(raw, request.headers);
    if (raw?.action === "merchant-account-preview")
      return previewMerchantLive(raw, request.headers);
    if (raw?.action === "platform-link") return openMerchantPlatformLink(raw, request.headers);
    if (raw?.action === "payout") return requestMerchantPayout(raw, request.headers);
    if (raw?.action === "refund") return requestMerchantRefund(raw, request.headers);
    if (raw?.action === "dispute-evidence") return respondToDispute(raw, request.headers);
    if (raw?.action === "reconciliation-rerun") return rerunReconciliation(raw, request.headers);
    if (raw?.action === "verification-details")
      return saveMerchantVerification(raw, request.headers);
    const b = command.parse(raw);
    if (b.action === "accept-terms") return acceptTerms(b.orgId, request.headers);
    if (b.action === "go-live-crypto") return goLiveWithCrypto(b.orgId, request.headers);
    return submitForUnderwriting(b.orgId, request.headers);
  });
}

export async function GET(request: Request) {
  return respond(async () => {
    const id = orgId.parse(new URL(request.url).searchParams.get("orgId"));
    return merchantAccountOverview(id, request.headers);
  });
}
