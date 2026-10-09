// Routing through PayRouta platform accounts. A Live merchant's approved
// sub-account is a checkout candidate for the methods its platform module can
// execute, under synthetic profile IDs "platform:<linkId>". Production also
// requires the platform account to be qualified.
import { db } from "../portal/db";
import type { Tx } from "../payments/service";
import { permits, type MerchantAccountState } from "./merchant-account";
import { platformModule } from "./platforms/registry";

export const platformPrefix = "platform:";
export const isPlatformProfile = (id: string) => id.startsWith(platformPrefix);

export async function platformCandidates(
  orgId: string,
  environment: string,
  method?: string,
  client: Tx | typeof db = db,
) {
  const account = await client.merchantAccount.findUnique({
    where: { orgId_environment: { orgId, environment } },
  });
  if (!account || !permits(account.state as MerchantAccountState, "pay-in")) return [];
  const links = await client.merchantPlatformLink.findMany({
    where: {
      orgId,
      environment,
      state: "Approved",
      paymentsEnabled: true,
      integrationId: { not: null },
    },
    include: { platformAccount: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const out = [];
  for (const l of links) {
    const p = l.platformAccount;
    if (
      !p.enabled ||
      p.legalEntityId !== account.legalEntityId ||
      (environment === "production" && !p.qualifiedAt)
    )
      continue;
    let manifest;
    try {
      manifest = platformModule(p.provider).manifest;
    } catch {
      continue;
    }
    for (const m of manifest.methods)
      if (!method || m === method)
        out.push({
          profileId: `${platformPrefix}${l.id}`,
          applicationId: l.id,
          partnerId: p.provider,
          // Merchants and their customers only ever see PayRouta.
          name: "PayRouta",
          integrationId: l.integrationId!,
          method: m,
        });
  }
  return out;
}

export async function platformAttemptTarget(tx: Tx, profileId: string, orgId: string) {
  const link = await tx.merchantPlatformLink.findUnique({
    where: { id: profileId.slice(platformPrefix.length) },
  });
  if (!link || link.orgId !== orgId || link.state !== "Approved" || !link.integrationId)
    return null;
  return { profileId, providerOrgId: link.orgId, integrationId: link.integrationId };
}
