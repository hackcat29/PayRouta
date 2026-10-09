import { db } from "../portal/db";
import { localMode } from "../portal/adapters";
import { json, atomic, audit } from "../portal/service";
import { PortalError } from "../portal/domain";
import { kybProfileSchema } from "../partners/kyb";
import { screenProfile, screeningProvider } from "../partners/screening";
export async function screenStablecoinMerchant(orgId: string, version: number) {
  const [org, profile] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId } }),
    db.merchantKybProfile.findFirst({ where: { orgId, version } }),
  ]);
  if (!profile) throw new PortalError("MERCHANT_PROFILE_REQUIRED", 409);
  const result = await screenProfile(
    kybProfileSchema.parse(profile.data),
    screeningProvider(localMode() && org.fictional),
  );
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
    screening.createdAt < new Date(now.getTime() - 86400000)
  )
    throw new PortalError("MERCHANT_SCREENING_REQUIRED", 409);
  return screening;
}
