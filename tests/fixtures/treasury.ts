// Fictional aggregator fixtures for browser tests: a PayRouta sandbox company
// and platform account, merchants at each activation stage, and a Live
// merchant with a confirmed payment whose funds are available.
import { randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { atomic, json } from "../../lib/portal/service";
import { fingerprint, type KybProfile } from "../../lib/partners/kyb";
import { submitMerchantAccount, transitionMerchantAccount } from "../../lib/treasury/merchant-account";
import { acceptedDocuments, identity } from "./onboarding";
import { acceptMerchantTerms, saveVerificationDetails } from "../../lib/treasury/verification";
import { openPlatformLink, provisionLink } from "../../lib/treasury/links";
import { recordAvailability } from "../../lib/treasury/funds";
import { applyDispute } from "../../lib/treasury/disputes";
import { confirm, createIntent, createSession, customerAction, methods, selectMethod } from "../../lib/payments/service";
import { dispatch, poll } from "../../lib/payments/processing";

export const gbp = { kind: "fiat", identifier: "GBP", network: "" };

const profile = (name: string): KybProfile => ({
  legalName: `${name} Ltd`,
  tradingName: name,
  businessType: "company",
  country: "GB",
  registrationNumber: "12345678",
  website: "https://merchant.example",
  productDescription: "Handmade clothing and accessories sold online",
  industry: "Fashion & Apparel",
  supportEmail: "support@merchant.example",
  address: { line1: "1 Dock Street", city: "London", postalCode: "E1 1AA", country: "GB" },
  representative: { givenName: "Ada", familyName: "Okafor", email: "ada@merchant.example", title: "Director" },
  owners: [],
  monthlyVolume: "10k-50k",
  settlementCurrency: "GBP",
});

export async function sandboxPlatform() {
  const entity =
    (await db.legalEntity.findFirst({ where: { name: "PayRouta Global (sandbox)" } })) ??
    (await db.legalEntity.create({ data: { name: "PayRouta Global (sandbox)", jurisdiction: "US-DE", updatedBy: "fixture" } }));
  const platform =
    (await db.platformAccount.findUnique({
      where: { legalEntityId_provider_environment: { legalEntityId: entity.id, provider: "sandbox-platform", environment: "sandbox" } },
    })) ??
    (await db.platformAccount.create({
      data: { legalEntityId: entity.id, provider: "sandbox-platform", environment: "sandbox", custody: "partner-held", merchantCountries: json(["GB"]), config: json({}), enabled: true, updatedBy: "fixture" },
    }));
  return { entityId: entity.id, platformId: platform.id };
}

// stage: "fresh" (nothing yet), "submitted", or "live" (with funds).
export async function treasuryMerchant(ownerEmail: string, stage: "fresh" | "submitted" | "live") {
  const owner = await db.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  const name = `${stage === "live" ? "Lagos Threads" : stage === "submitted" ? "Kente Crafts" : "Abuja Bakes"} ${randomUUID().slice(0, 6)}`;
  const org = await db.organization.create({ data: { name, fictional: true } });
  await db.merchantConfig.create({ data: { orgId: org.id, returnOrigin: "http://127.0.0.1:3000", environment: "sandbox" } });
  await db.membership.create({ data: { orgId: org.id, userId: owner.id, role: "Owner", merchantRole: "Owner" } });
  if (stage === "fresh") return { orgId: org.id, name };
  const p = profile(name);
  await db.merchantKybProfile.create({ data: { orgId: org.id, version: 1, data: json(p), fingerprint: fingerprint(p), createdBy: owner.id } });
  await db.merchantScreening.create({ data: { orgId: org.id, profileVersion: 1, provider: "sandbox-fixture", verdict: "clear", results: json([]), createdBy: "fixture" } });
  await atomic(async (tx) => {
    await saveVerificationDetails(
      tx,
      org.id,
      {
        businessPhone: "+442071234567",
        representative: { dateOfBirth: "1985-04-12", ...identity, address: { line1: "2 Dock Street", city: "London", country: "GB" } },
        owners: [],
        payoutAccount: { country: "GB", currency: "GBP", holderName: p.legalName, holderType: "company", accountNumber: "GB82WEST12345698765432" },
      },
      p,
      owner.id,
    );
    await acceptMerchantTerms(tx, org.id, owner.id, { ip: "127.0.0.1", userAgent: "fixture" });
    await acceptedDocuments(tx, org.id);
    await submitMerchantAccount(tx, org.id, "sandbox", owner.id);
  });
  if (stage === "submitted") return { orgId: org.id, name };
  const { entityId, platformId } = await sandboxPlatform();
  const review = (version: number, to: string, decision?: object) =>
    atomic((tx) =>
      transitionMerchantAccount(tx, { orgId: org.id, environment: "sandbox", expectedVersion: version, to: to as never, reason: `Fixture ${to}`, decision: decision as never }, "fixture"),
    );
  await review(1, "Underwriting");
  const link = await atomic((tx) => openPlatformLink(tx, { orgId: org.id, environment: "sandbox", platformAccountId: platformId }, "fixture"));
  await provisionLink(link.id);
  await review(2, "Live", {
    legalEntityId: entityId,
    riskTier: "standard",
    terms: {
      reserve: { basisPoints: 1000, holdDays: 90 },
      payout: { schedule: "manual", delayDays: 0 },
      taxMode: "merchant-seller",
      limits: { currency: "GBP", maximumMinor: "500000", dailyMaximumMinor: "5000000" },
    },
  });
  // One confirmed card payment with its funds available.
  const intent = await createIntent(org.id, `fixture-${randomUUID()}`, {
    reference: `LT-${Math.floor(Math.random() * 90000 + 10000)}`,
    amount: "64.50",
    asset: gbp,
    precision: 2,
    methods: ["card"],
    settlement: gbp,
    returnUrl: "http://127.0.0.1:3000/done",
  });
  const s = await createSession(org.id, intent.id);
  await methods(s.sessionId, s.token);
  const route = await selectMethod(s.sessionId, s.token, "card");
  const { attemptId } = await confirm(s.sessionId, s.token, route.routeId);
  await dispatch(attemptId!);
  await customerAction(s.sessionId, s.token);
  await poll(attemptId!);
  await recordAvailability(attemptId!);
  const pp = await db.platformPayment.findUniqueOrThrow({ where: { attemptId: attemptId! } });
  await recordAvailability(attemptId!, new Date(pp.availableAt!.getTime() + 1000));
  await applyDispute(platformId, {
    reference: `dp_${randomUUID().slice(0, 10)}`,
    state: "Open",
    amountMinor: 1000n,
    currency: "GBP",
    feeMinor: 0n,
    paymentReference: pp.reference,
    reason: "product_not_received",
    evidenceDueBy: new Date(Date.now() + 9 * 86400000),
  });
  return { orgId: org.id, name, intentId: intent.id };
}

// A fresh checkout for a Live merchant, as the merchant's server would create it.
export async function fiatCheckout(orgId: string) {
  const intent = await createIntent(orgId, `fixture-${randomUUID()}`, {
    reference: `LT-${Math.floor(Math.random() * 90000 + 10000)}`,
    amount: "86.40",
    asset: gbp,
    precision: 2,
    methods: ["card", "bank-transfer"],
    settlement: gbp,
    returnUrl: "http://127.0.0.1:3000/done",
  });
  return createSession(orgId, intent.id);
}
