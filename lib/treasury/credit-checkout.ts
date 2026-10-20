// Credit plans at checkout. The customer picks "Pay with credit", sees each
// lender's plans for this exact amount (instalments, total cost, lender
// name and terms), and chooses one. The choice pins the payment route to
// that lender; the lender re-prices the plan when the payment is created and
// runs its own credit check with the customer.
import { createHash } from "node:crypto";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import type { CreditOffer } from "./platforms/contract";
import { platformAdapter, platformModule } from "./platforms/registry";
import { platformCandidates, platformPrefix } from "./routes";
import { creditMethod } from "./credit";

export type CheckoutCreditOffer = CreditOffer & {
  // What the checkout sends back to choose this plan. Opaque to customers.
  key: string;
  currency: string;
};

type Intent = {
  id: string;
  orgId: string;
  environment: string;
  contextId: string;
  amount: string;
  precision: number;
  asset: unknown;
  methods: unknown;
};

const keyFor = (profileId: string, offerId: string) =>
  `${createHash("sha256").update(profileId).digest("hex").slice(0, 10)}.${offerId}`;

// Every lender's plans for this payment, with the route profile each belongs
// to. Lenders that fail to answer are left out rather than failing checkout.
export async function lenderOffers(intent: Intent) {
  const asset = intent.asset as { kind?: string; identifier?: string };
  if (asset.kind !== "fiat" || !asset.identifier || !(intent.methods as string[]).includes(creditMethod)) return [];
  const context = await db.availabilityContext.findUnique({ where: { id: intent.contextId } });
  const payerCountry = (context?.context as { payerCountry?: string } | undefined)?.payerCountry;
  const out: (CheckoutCreditOffer & { profileId: string })[] = [];
  for (const candidate of await platformCandidates(intent.orgId, intent.environment, creditMethod)) {
    const link = await db.merchantPlatformLink.findUnique({
      where: { id: candidate.profileId.slice(platformPrefix.length) },
      include: { platformAccount: true },
    });
    if (!link) continue;
    let lender;
    try {
      lender = platformModule(link.platformAccount.provider).manifest.credit;
    } catch {
      continue;
    }
    if (!lender || (lender.countries && (!payerCountry || !lender.countries.includes(payerCountry)))) continue;
    try {
      const adapter = platformAdapter(link.platformAccount);
      const offers = (await adapter.creditOffers?.({
        amount: intent.amount,
        precision: intent.precision,
        currency: asset.identifier,
        payerCountry,
      })) ?? [];
      for (const offer of offers)
        out.push({ ...offer, lender: lender.lender, termsUrl: offer.termsUrl || lender.termsUrl, key: keyFor(candidate.profileId, offer.id), currency: asset.identifier, profileId: candidate.profileId });
    } catch (error) {
      console.warn(JSON.stringify({ event: "credit.offers_unavailable", provider: link.platformAccount.provider, error: error instanceof Error ? error.message : "unknown" }));
    }
  }
  return out;
}

// Plans as the customer's checkout receives them.
export async function checkoutOffers(intent: Intent): Promise<CheckoutCreditOffer[]> {
  return (await lenderOffers(intent)).map((o) => {
    const { profileId, ...offer } = o;
    void profileId;
    return offer;
  });
}

// Whether a route profile belongs to a lender (so a plan must be chosen).
export async function isLenderProfile(profileId: string) {
  if (!profileId.startsWith(platformPrefix)) return false;
  const link = await db.merchantPlatformLink.findUnique({
    where: { id: profileId.slice(platformPrefix.length) },
    include: { platformAccount: true },
  });
  if (!link) return false;
  try {
    return !!platformModule(link.platformAccount.provider).manifest.credit;
  } catch {
    return false;
  }
}

// The chosen plan, re-priced now. Refused if the lender no longer offers it.
export async function chosenOffer(intent: Intent, key: string) {
  const offer = (await lenderOffers(intent)).find((o) => o.key === key);
  if (!offer) throw new PortalError("CREDIT_PLAN_NO_LONGER_OFFERED", 409);
  return offer;
}
