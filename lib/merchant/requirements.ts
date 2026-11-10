// What a merchant must provide, worked out from what it wants to do
// (capabilities), what kind of seller it is and how much it sells. Modelled on
// capability requirements (Bachs, Stripe Connect): an item is "due" when it
// holds a capability back now, "later" when it will be needed as the merchant
// grows, and "upgrade" when its volume has outgrown its tier. Upgrade items
// never stop payments; they say what to send next.
//
//   crypto    take crypto and keep it as crypto (the merchant's own NEAR
//             Intents account). A name, a country and the terms; a silent
//             sanctions check runs on the name. No documents.
//   fiat      cards, bank transfers and mobile money through PayRouta's
//             platform accounts. Individuals give their own ID; registered
//             businesses add registration; high volume adds owners and proof
//             of address. Operations review before going live.
//   cash-out  crypto paid to a bank or mobile money: a fiat payout, so the
//             person's identity is needed.
//
// Documents go through the private evidence store and count once operations
// accept them.
import { db } from "../portal/db";
import type { Tx } from "../payments/service";
import { kybProfileSchema, type KybProfile } from "../partners/kyb";
import { merchantTermsVersion } from "../treasury/verification";
import { approximateUsd } from "../payments/usd-estimate";

export const capabilities = ["crypto", "fiat", "cash-out"] as const;
export type Capability = (typeof capabilities)[number];

export type Tier = "individual" | "business" | "scaled";
// Monthly fiat volume, in US dollars, each tier covers.
export const tierCapsUsd: Record<Tier, number | null> = {
  individual: 10_000,
  business: 50_000,
  scaled: null,
};
const bandFloorUsd: Record<KybProfile["monthlyVolume"], number> = {
  "under-10k": 0,
  "10k-50k": 10_000,
  "50k-250k": 50_000,
  "250k-1m": 250_000,
  "over-1m": 1_000_000,
};

// Requirement rows (seeded by migration) that onboarding documents are
// uploaded against.
export const onboardingDocuments = {
  "government-id": "req_onboarding_government_id",
  "registration-certificate": "req_onboarding_registration_certificate",
  "proof-of-address": "req_onboarding_proof_of_address",
} as const;
export type OnboardingDocument = keyof typeof onboardingDocuments;
export const onboardingDocumentIds: string[] = Object.values(onboardingDocuments);

export const requirementIds = [
  "name",
  "country",
  "terms",
  "what-you-sell",
  "support-email",
  "registration-number",
  "business-address",
  "representative",
  "personal-details",
  "id-number",
  "government-id",
  "registration-certificate",
  "payout-account",
  "owners",
  "proof-of-address",
] as const;
export type RequirementId = (typeof requirementIds)[number];

export type RequirementStatus = "done" | "in-review" | "due" | "upgrade" | "later";
export type RequirementEntry = {
  id: RequirementId;
  status: RequirementStatus;
  // Capabilities this item holds back while it is due.
  blocks: Capability[];
};

export type DocumentState = "missing" | "in-review" | "accepted" | "returned";
type PersonSummary = {
  dateOfBirth?: boolean;
  phone?: boolean;
  idType?: string | null;
  idNumberLast4?: string | null;
  addressCountry?: string;
};
export type DetailsSummary = {
  representative?: PersonSummary;
  owners?: PersonSummary[];
  payoutAccount?: { accountLast4?: string | null } | null;
};
export type ScreeningState = "pending" | "clear" | "review" | "match";

export type RequirementsInput = {
  profile: Partial<KybProfile> | null;
  details: DetailsSummary | null;
  documents: Partial<Record<OnboardingDocument, DocumentState>>;
  termsAccepted: boolean;
  screening: ScreeningState;
  // Fiat volume over the last 30 days, in US dollars.
  monthlyUsd: number;
};

export type Requirements = {
  tier: Tier;
  capUsd: number | null;
  monthlyUsd: number;
  overCap: boolean;
  entries: RequirementEntry[];
  ready: Record<Capability, boolean>;
  screening: ScreeningState;
};

const individualTypes = new Set(["individual"]);

export function tierFor(profile: Partial<KybProfile> | null): Tier {
  if (!profile?.businessType || individualTypes.has(profile.businessType)) return "individual";
  const floor = bandFloorUsd[profile.monthlyVolume ?? "under-10k"] ?? 0;
  return floor >= 50_000 ? "scaled" : "business";
}

const nextTier: Record<Tier, Tier | null> = { individual: "business", business: "scaled", scaled: null };

export function requirementsFor(input: RequirementsInput): Requirements {
  const p = input.profile;
  const tier = tierFor(p);
  const individual = tier === "individual";
  const capUsd = tierCapsUsd[tier];
  const declaredUsd = bandFloorUsd[p?.monthlyVolume ?? "under-10k"] ?? 0;
  // Individuals can't register their way up inside PayRouta; a higher
  // expected volume asks them to, without holding them back.
  const overCap = capUsd !== null && (input.monthlyUsd > capUsd || (individual && declaredUsd >= capUsd));
  const rep = input.details?.representative;
  const doc = (d: OnboardingDocument) => input.documents[d] ?? "missing";
  const docDone = (d: OnboardingDocument) => doc(d) === "accepted";
  const docInReview = (d: OnboardingDocument) => doc(d) === "in-review";

  const provided: Record<RequirementId, boolean> = {
    name: !!p?.legalName,
    country: !!p?.country,
    terms: input.termsAccepted,
    "what-you-sell": !!p?.productDescription,
    "support-email": !!p?.supportEmail,
    "registration-number": !!p?.registrationNumber,
    "business-address": !!p?.address?.line1,
    representative: !!p?.representative?.givenName && !!p.representative.familyName,
    "personal-details": !!rep?.dateOfBirth && !!rep.addressCountry && rep.phone !== false,
    "id-number": !!rep?.idNumberLast4,
    "government-id": docDone("government-id"),
    "registration-certificate": docDone("registration-certificate"),
    "payout-account": !!input.details?.payoutAccount,
    owners: (p?.owners?.length ?? 0) > 0 && (input.details?.owners?.length ?? 0) === (p?.owners?.length ?? 0),
    "proof-of-address": docDone("proof-of-address"),
  };
  const inReview: Partial<Record<RequirementId, boolean>> = {
    "government-id": docInReview("government-id"),
    "registration-certificate": docInReview("registration-certificate"),
    "proof-of-address": docInReview("proof-of-address"),
  };

  // Which tier first needs each item, and for which capabilities.
  const items: { id: RequirementId; tier: Tier; for: Capability[] }[] = [
    { id: "name", tier: "individual", for: ["crypto", "fiat", "cash-out"] },
    { id: "country", tier: "individual", for: ["crypto", "fiat", "cash-out"] },
    { id: "terms", tier: "individual", for: ["crypto", "fiat", "cash-out"] },
    { id: "what-you-sell", tier: "individual", for: ["fiat"] },
    { id: "support-email", tier: "individual", for: ["fiat"] },
    { id: "personal-details", tier: "individual", for: ["fiat", "cash-out"] },
    { id: "id-number", tier: "individual", for: ["fiat", "cash-out"] },
    { id: "government-id", tier: "individual", for: ["fiat", "cash-out"] },
    { id: "payout-account", tier: "individual", for: ["fiat"] },
    { id: "registration-number", tier: "business", for: ["fiat"] },
    { id: "registration-certificate", tier: "business", for: ["fiat"] },
    { id: "business-address", tier: "business", for: ["fiat"] },
    { id: "representative", tier: "business", for: ["fiat"] },
    { id: "owners", tier: "scaled", for: ["fiat"] },
    { id: "proof-of-address", tier: "scaled", for: ["fiat"] },
  ];
  const rank: Record<Tier, number> = { individual: 0, business: 1, scaled: 2 };
  const upgradeTo = overCap ? nextTier[tier] : null;
  const entries: RequirementEntry[] = items.map((i) => {
    if (provided[i.id]) return { id: i.id, status: "done", blocks: [] };
    if (inReview[i.id]) return { id: i.id, status: "in-review", blocks: [] };
    if (rank[i.tier] <= rank[tier]) return { id: i.id, status: "due", blocks: i.for };
    if (upgradeTo && rank[i.tier] <= rank[upgradeTo]) return { id: i.id, status: "upgrade", blocks: [] };
    return { id: i.id, status: "later", blocks: [] };
  });

  const blocked = (c: Capability) => entries.some((e) => e.status === "due" && e.blocks.includes(c));
  return {
    tier,
    capUsd,
    monthlyUsd: input.monthlyUsd,
    overCap,
    entries,
    ready: {
      // The sanctions check must have run and found nothing. A possible
      // match waits for operations.
      crypto: !blocked("crypto") && input.screening === "clear",
      fiat: !blocked("fiat") && input.screening !== "match",
      "cash-out": !blocked("cash-out") && input.screening !== "match",
    },
    screening: input.screening,
  };
}

// ---------------------------------------------------------------------------
// Loading the inputs

type Client = typeof db | Tx;

function documentState(rows: { reviewStatus: string; scanStatus: string }[]): DocumentState {
  if (rows.some((r) => r.reviewStatus === "Accepted")) return "accepted";
  if (rows.some((r) => r.reviewStatus === "Uploaded" && r.scanStatus !== "Infected")) return "in-review";
  return rows.length ? "returned" : "missing";
}

// Fiat taken through PayRouta's platform accounts in the last 30 days.
async function monthlyFiatUsd(client: Client, orgId: string, environment: string, now: Date) {
  const rows = await client.platformPayment.groupBy({
    by: ["asset"],
    where: {
      orgId,
      environment,
      state: { notIn: ["Pending", "Failed", "Rejected"] },
      createdAt: { gt: new Date(now.getTime() - 30 * 86400000) },
    },
    _sum: { grossMinor: true },
  });
  return rows.reduce((sum, r) => {
    const currency = r.asset.split(":")[1] ?? "";
    return sum + (approximateUsd(currency, BigInt(r._sum.grossMinor?.toFixed(0) ?? "0")) ?? 0);
  }, 0);
}

export async function loadRequirements(
  client: Client,
  orgId: string,
  environment: string,
  now = new Date(),
): Promise<Requirements> {
  const [profileRow, detailsRow, agreement, evidence, org] = await Promise.all([
    client.merchantKybProfile.findFirst({ where: { orgId }, orderBy: { version: "desc" } }),
    client.merchantVerificationDetails.findFirst({ where: { orgId }, orderBy: { version: "desc" } }),
    client.merchantAgreement.findFirst({ where: { orgId, version: merchantTermsVersion } }),
    client.evidence.findMany({
      where: {
        orgId,
        requirementId: { in: onboardingDocumentIds },
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      select: { requirementId: true, reviewStatus: true, scanStatus: true },
    }),
    client.organization.findUniqueOrThrow({ where: { id: orgId } }),
  ]);
  const parsed = profileRow ? kybProfileSchema.safeParse(profileRow.data) : null;
  const profile = parsed?.success ? parsed.data : null;
  const screening = profileRow
    ? await client.merchantScreening.findFirst({
        where: {
          orgId,
          profileVersion: profileRow.version,
          ...(org.fictional ? {} : { provider: { not: "sandbox-fixture" } }),
        },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const documents = Object.fromEntries(
    (Object.entries(onboardingDocuments) as [OnboardingDocument, string][]).map(([name, id]) => [
      name,
      documentState(evidence.filter((e) => e.requirementId === id)),
    ]),
  ) as Record<OnboardingDocument, DocumentState>;
  return requirementsFor({
    profile,
    details: (detailsRow?.summary as DetailsSummary | undefined) ?? null,
    documents,
    termsAccepted: !!agreement,
    screening: (screening?.verdict as ScreeningState | undefined) ?? "pending",
    monthlyUsd: await monthlyFiatUsd(client, orgId, environment, now),
  });
}

// ---------------------------------------------------------------------------
// The verified tick customers see at checkout

// PayRouta has verified who the merchant is: a clear sanctions screening and
// a government ID accepted by operations, plus the registration certificate
// for a registered business. Crypto kept as crypto needs neither, so a
// merchant can sell without the tick; the tick only ever says what PayRouta
// checked, and its absence isn't shown as a warning.
export function identityVerified(r: Pick<Requirements, "tier" | "entries" | "screening">) {
  const done = (id: RequirementId) => r.entries.find((e) => e.id === id)?.status === "done";
  return r.screening === "clear" && done("government-id") && (r.tier === "individual" || done("registration-certificate"));
}
