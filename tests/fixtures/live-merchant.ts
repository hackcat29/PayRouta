// A Live merchant on PayRouta's sandbox platform accounts, set up exactly as
// operations would (KYB, screening, verification, terms, underwriting,
// sub-accounts, Live), for launch-scope tests.
import { randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { atomic, json } from "../../lib/portal/service";
import { baseProfile } from "../../lib/partners/conformance";
import { fingerprint } from "../../lib/partners/kyb";
import { submitMerchantAccount, transitionMerchantAccount } from "../../lib/treasury/merchant-account";
import { acceptedDocuments, identity } from "./onboarding";
import { acceptMerchantTerms, saveVerificationDetails } from "../../lib/treasury/verification";
import { openPlatformLink, provisionLink } from "../../lib/treasury/links";

export async function sandboxEntity(label: string, providers: string[]) {
  const entity = await db.legalEntity.create({ data: { name: `PayRouta ${label} ${randomUUID()}`, jurisdiction: "US-DE", updatedBy: "test" } });
  const accounts: Record<string, string> = {};
  for (const provider of providers)
    accounts[provider] = (
      await db.platformAccount.create({
        data: {
          legalEntityId: entity.id,
          provider,
          environment: "sandbox",
          custody: provider === "sandbox-credit" ? "split-settlement" : "partner-held",
          merchantCountries: json(["GB"]),
          config: json({}),
          enabled: true,
          updatedBy: "test",
        },
      })
    ).id;
  return { entityId: entity.id, accounts };
}

export async function liveMerchant(entityId: string, platformAccountIds: string[], limitCurrency = "GBP") {

  const org = await db.organization.create({ data: { name: `Credit test ${randomUUID()}`, fictional: true } });
  await db.merchantConfig.create({ data: { orgId: org.id, returnOrigin: "http://127.0.0.1:3000", environment: "sandbox" } });
  await db.merchantKybProfile.create({
    data: { orgId: org.id, version: 1, data: json(baseProfile), fingerprint: fingerprint(baseProfile), createdBy: "test" },
  });
  await db.merchantScreening.create({
    data: { orgId: org.id, profileVersion: 1, provider: "sandbox-fixture", verdict: "clear", results: json([]), createdBy: "test" },
  });
  const address = { line1: "1 Dock Street", city: "London", postalCode: "E1 1AA", country: "GB" };
  await atomic(async (tx) => {
    await saveVerificationDetails(
      tx,
      org.id,
      {
        businessPhone: "+442071234567",
        representative: { dateOfBirth: "1985-04-12", ...identity, address },
        owners: baseProfile.owners.map(() => ({ dateOfBirth: "1979-01-30", address })),
        payoutAccount: { country: "GB", currency: "GBP", holderName: baseProfile.legalName, holderType: "company", accountNumber: "GB82WEST12345698765432" },
      },
      baseProfile,
      "test",
    );
    await acceptMerchantTerms(tx, org.id, "test", { ip: "127.0.0.1", userAgent: "test" });
    await acceptedDocuments(tx, org.id);
    await submitMerchantAccount(tx, org.id, "sandbox", "test");
  });
  const review = (version: number, to: string, decision?: object) =>
    atomic((tx) =>
      transitionMerchantAccount(tx, { orgId: org.id, environment: "sandbox", expectedVersion: version, to: to as never, reason: `Credit test ${to}`, decision: decision as never }, "ops"),
    );
  await review(1, "Underwriting");
  for (const platformAccountId of platformAccountIds) {
    const link = await atomic((tx) => openPlatformLink(tx, { orgId: org.id, environment: "sandbox", platformAccountId }, "ops"));
    await provisionLink(link.id);
  }
  await review(2, "Live", {
    legalEntityId: entityId,
    riskTier: "standard",
    terms: {
      reserve: { basisPoints: 0, holdDays: 0 },
      payout: { schedule: "daily", delayDays: 0 },
      taxMode: "merchant-seller",
      limits: { currency: limitCurrency, maximumMinor: "500000", dailyMaximumMinor: "5000000" },
    },
  });
  return org.id;
}
