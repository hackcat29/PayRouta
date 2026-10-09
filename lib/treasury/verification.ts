// Identity and payout details a merchant gives PayRouta for its processing
// partner (docs/AGGREGATOR.md §3a). The KYB profile (lib/partners/kyb.ts)
// stays free of sensitive data; dates of birth, ID numbers and bank account
// numbers live only here, encrypted in the secret store. Rows keep a
// reference, a fingerprint and a masked summary; the plain details are read
// back only to send them to the partner.
import { createHash } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../portal/domain";
import { audit, json } from "../portal/service";
import { secretManager } from "../portal/adapters";
import type { Tx } from "../payments/service";
import type { KybProfile } from "../partners/kyb";

// Version of PayRouta's merchant terms. The text, approved by counsel, must
// incorporate the processing partner's connected-account agreement (for
// Stripe, the Stripe Connected Account Agreement).
export const merchantTermsVersion = "2026-10-09";

const text = (max: number) => z.string().trim().min(1).max(max);
const country = z.string().regex(/^[A-Z]{2}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    const age = (Date.now() - d.getTime()) / (365.25 * 86400000);
    // 130 admits Stripe's test date of birth (1901-01-01) and every real person.
    return !Number.isNaN(d.getTime()) && age >= 13 && age <= 130;
  }, "Invalid date of birth");
const phone = z.string().regex(/^\+[1-9]\d{6,14}$/, "International format, e.g. +14155550100");
const address = z
  .object({
    line1: text(200),
    line2: text(200).optional(),
    city: text(100),
    region: text(100).optional(),
    postalCode: text(20).optional(),
    country,
  })
  .strict();
const personDetails = z
  .object({
    dateOfBirth: date,
    phone: phone.optional(),
    email: z.email().max(200).optional(),
    address,
    // National ID or tax number where the country requires one (full SSN in
    // the US). Never shown back; only its last four characters.
    idNumber: z.string().trim().regex(/^[A-Za-z0-9-]{4,30}$/).optional(),
    // Which document idNumber comes from, where a partner asks (dLocal).
    idType: z.enum(["passport", "national-id", "drivers-licence", "tax-id"]).optional(),
    nationality: country.optional(),
    // Politically exposed person: asked by several partners' KYC.
    politicallyExposed: z.boolean().optional(),
  })
  .strict();

export const verificationDetailsSchema = z
  .object({
    businessPhone: phone,
    // ISO 18245 merchant category code, where a partner needs one (Tink).
    merchantCategoryCode: z.string().regex(/^\d{4}$/).optional(),
    incorporationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    annualSalesUsd: z.string().regex(/^\d{1,15}(\.\d{1,2})?$/).optional(),
    representative: personDetails,
    // Same order as the KYB profile's owners.
    owners: z.array(personDetails).max(4),
    payoutAccount: z
      .object({
        country,
        currency: z.string().regex(/^[A-Z]{3}$/),
        holderName: text(200),
        holderType: z.enum(["company", "individual"]),
        // IBAN where the country uses one, otherwise the local account number.
        accountNumber: z.string().trim().regex(/^[A-Za-z0-9]{4,34}$/),
        // Routing, sort code, BSB or bank code where the country needs one.
        routingNumber: z.string().trim().regex(/^[A-Za-z0-9-]{3,20}$/).optional(),
      })
      .strict(),
  })
  .strict();
export type VerificationDetails = z.infer<typeof verificationDetailsSchema>;

const last4 = (v?: string) => (v ? v.replace(/[^A-Za-z0-9]/g, "").slice(-4) : null);

export function maskedSummary(d: VerificationDetails) {
  const person = (p: VerificationDetails["representative"]) => ({
    dateOfBirth: true,
    idNumberLast4: last4(p.idNumber),
    addressCountry: p.address.country,
  });
  return {
    representative: person(d.representative),
    owners: d.owners.map(person),
    payoutAccount: {
      country: d.payoutAccount.country,
      currency: d.payoutAccount.currency,
      holderName: d.payoutAccount.holderName,
      accountLast4: last4(d.payoutAccount.accountNumber),
    },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}

export async function saveVerificationDetails(
  tx: Tx,
  orgId: string,
  raw: unknown,
  profile: KybProfile,
  actorId: string,
) {
  const details = verificationDetailsSchema.parse(raw);
  if (details.owners.length !== profile.owners.length)
    throw new PortalError("OWNER_DETAILS_MUST_MATCH_PROFILE", 400);
  const fingerprint = createHash("sha256").update(JSON.stringify(canonical(details))).digest("hex");
  const last = await tx.merchantVerificationDetails.findFirst({
    where: { orgId },
    orderBy: { version: "desc" },
  });
  if (last?.fingerprint === fingerprint) return last;
  const secretRef = await secretManager.put(JSON.stringify(details));
  const saved = await tx.merchantVerificationDetails.create({
    data: {
      orgId,
      version: (last?.version ?? 0) + 1,
      secretRef,
      summary: json(maskedSummary(details)),
      fingerprint,
      createdBy: actorId,
    },
  });
  // The audit trail records that details changed, never the details.
  await audit(tx, orgId, actorId, "merchant.verification.saved", saved.id, { version: saved.version });
  return saved;
}

export async function readVerificationDetails(secretRef: string) {
  const parsed = verificationDetailsSchema.safeParse(JSON.parse((await secretManager.get(secretRef)) || "null"));
  if (!parsed.success) throw new PortalError("VERIFICATION_DETAILS_UNAVAILABLE", 409);
  return parsed.data;
}

// nginx sets X-Real-IP to the connecting address (deploy/payrouta-proxy.conf).
export function acceptanceContext(headers: Headers) {
  const ip = headers.get("x-real-ip")?.trim() || (process.env.PORTAL_MODE === "local" ? "127.0.0.1" : "");
  const userAgent = headers.get("user-agent")?.slice(0, 500) || "";
  if (!/^[0-9a-fA-F:.]{2,64}$/.test(ip) || !userAgent)
    throw new PortalError("ACCEPTANCE_CONTEXT_UNAVAILABLE", 400);
  return { ip, userAgent };
}

export async function acceptMerchantTerms(
  tx: Tx,
  orgId: string,
  actorId: string,
  context: { ip: string; userAgent: string },
) {
  const agreement = await tx.merchantAgreement.create({
    data: { orgId, version: merchantTermsVersion, acceptedBy: actorId, ...context },
  });
  await audit(tx, orgId, actorId, "merchant.terms.accepted", agreement.id, { version: merchantTermsVersion });
  return agreement;
}
