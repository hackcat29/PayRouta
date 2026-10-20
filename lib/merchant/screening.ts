import { db } from "../portal/db";
import { localMode } from "../portal/adapters";
import { json, atomic, audit } from "../portal/service";
import { PortalError } from "../portal/domain";
import { kybProfileSchema } from "../partners/kyb";
import { screenProfile, screeningProvider } from "../partners/screening";
import { manualReviewProviderId, vendorUnavailable } from "../compliance/providers";
// A manual screening decision by operations stays valid this long; automated
// results are refreshed daily.
export const manualScreeningValidDays = 30;
const automatedValidMs = 86400000;
const validFor = (provider: string) =>
  provider === "manual-review" ? manualScreeningValidDays * 86400000 : automatedValidMs;

export async function screenStablecoinMerchant(orgId: string, version: number) {
  const [org, profile] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId } }),
    db.merchantKybProfile.findFirst({ where: { orgId, version } }),
  ]);
  if (!profile) throw new PortalError("MERCHANT_PROFILE_REQUIRED", 409);
  const provider = screeningProvider(localMode() && org.fictional);
  if (provider.id === manualReviewProviderId) {
    // Without an automated vendor, the daily rescreen only asks for a manual
    // review when there's no current decision and none is already waiting.
    const latest = await db.merchantScreening.findFirst({
      where: { orgId, profileVersion: version, provider: { not: "sandbox-fixture" } },
      orderBy: { createdAt: "desc" },
    });
    if (
      latest &&
      (latest.provider === manualReviewProviderId ||
        latest.createdAt.getTime() > Date.now() - validFor(latest.provider))
    )
      return latest;
  }
  const result = await screenProfile(kybProfileSchema.parse(profile.data), provider);
  // If the vendor couldn't answer for anyone, keep a decision that is still
  // valid (a manual decision, or an automated result from the last day)
  // rather than replacing it with a fallback "review" during an outage.
  if (result.results.every((r) => r.reference === vendorUnavailable(provider.id))) {
    const latest = await db.merchantScreening.findFirst({
      where: { orgId, profileVersion: version, provider: { not: "sandbox-fixture" } },
      orderBy: { createdAt: "desc" },
    });
    const stillValid =
      latest &&
      latest.verdict !== "review" &&
      latest.createdAt.getTime() > Date.now() - validFor(latest.provider);
    if (stillValid) return latest;
  }
  return atomic(async (tx) => {
    const screening = await tx.merchantScreening.create({
      data: {
        orgId,
        profileVersion: version,
        provider: result.provider,
        verdict: result.verdict,
        results: json(result.results),
        createdBy: "worker",
      },
    });
    await audit(tx, orgId, "worker", "merchant.screened", screening.id, {
      version,
      verdict: result.verdict,
      provider: result.provider,
    });
    return screening;
  });
}
export async function currentMerchantScreening(
  client: typeof db | import("../payments/service").Tx,
  orgId: string,
  country: string,
  now = new Date(),
) {
  const [org, profile] = await Promise.all([
    client.organization.findUniqueOrThrow({ where: { id: orgId } }),
    client.merchantKybProfile.findFirst({
      where: { orgId },
      orderBy: { version: "desc" },
    }),
  ]);
  if (
    org.fictional ||
    !profile ||
    kybProfileSchema.parse(profile.data).country !== country
  )
    throw new PortalError("MERCHANT_SCREENING_REQUIRED", 409);
  const screening = await client.merchantScreening.findFirst({
    where: {
      orgId,
      profileVersion: profile.version,
      provider: { not: "sandbox-fixture" },
    },
    orderBy: { createdAt: "desc" },
  });
  if (
    !screening ||
    screening.verdict !== "clear" ||
    screening.createdAt.getTime() < now.getTime() - validFor(screening.provider)
  )
    throw new PortalError("MERCHANT_SCREENING_REQUIRED", 409);
  return screening;
}
