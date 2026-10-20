// Merchant KYB profile ("register once").
//
// The profile holds only what partners need to PRE-FILL their onboarding.
// PayRouta deliberately never collects government ID numbers, dates of birth,
// bank account numbers or card data: each provider collects those on its own
// hosted, regulated onboarding flow. That keeps sensitive identity data out of
// PayRouta and makes every disclosure to a partner explainable field by field.
import { createHash } from "node:crypto";
import { z } from "zod";
import referenceData from "../portal/reference-data.json";

const countryIds = new Set(referenceData.countries.map((c) => c.id));
const country = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .refine((v) => countryIds.has(v), "Unknown country");
const text = (max: number) => z.string().trim().min(1).max(max);

export const businessTypes = [
  "company",
  "sole-proprietor",
  "partnership",
  "non-profit",
] as const;

export const volumeBands = [
  "under-10k",
  "10k-50k",
  "50k-250k",
  "250k-1m",
  "over-1m",
] as const;

const person = z
  .object({
    givenName: text(100),
    familyName: text(100),
    email: z.email().max(200),
  })
  .strict();

export const kybProfileSchema = z
  .object({
    legalName: text(200),
    tradingName: text(200).optional(),
    businessType: z.enum(businessTypes),
    country,
    registrationNumber: text(60).optional(),
    taxId: text(60).optional(),
    website: z.url().max(500).refine((v) => v.startsWith("https://"), "HTTPS required"),
    productDescription: text(1000).refine((v) => v.length >= 20, "At least 20 characters"),
    industry: text(100),
    supportEmail: z.email().max(200),
    address: z
      .object({
        line1: text(200),
        line2: text(200).optional(),
        city: text(100),
        region: text(100).optional(),
        postalCode: text(20).optional(),
        country,
      })
      .strict(),
    representative: person.extend({ title: text(100) }).strict(),
    // Beneficial owners with 25% or more. Names and country only; providers
    // collect identity documents themselves.
    owners: z
      .array(
        z
          .object({
            givenName: text(100),
            familyName: text(100),
            country,
            ownershipPercent: z.number().int().min(25).max(100),
          })
          .strict(),
      )
      .max(4),
    monthlyVolume: z.enum(volumeBands),
    settlementCurrency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict()
  .superRefine((p, ctx) => {
    const total = p.owners.reduce((s, o) => s + o.ownershipPercent, 0);
    if (total > 100)
      ctx.addIssue({
        code: "custom",
        path: ["owners"],
        message: "Ownership exceeds 100%",
      });
    if (p.businessType === "company" && !p.registrationNumber)
      ctx.addIssue({
        code: "custom",
        path: ["registrationNumber"],
        message: "Companies need a registration number",
      });
  });
export type KybProfile = z.infer<typeof kybProfileSchema>;

export const kybFields = [
  "legalName",
  "tradingName",
  "businessType",
  "country",
  "registrationNumber",
  "taxId",
  "website",
  "productDescription",
  "industry",
  "supportEmail",
  "address",
  "representative",
  "owners",
  "monthlyVolume",
  "settlementCurrency",
] as const;
export type KybField = (typeof kybFields)[number];

// Plain-language names used in the consent disclosure.
export const kybFieldLabels: Record<KybField, string> = {
  legalName: "Legal business name",
  tradingName: "Trading name",
  businessType: "Business type",
  country: "Country of registration",
  registrationNumber: "Company registration number",
  taxId: "Tax ID",
  website: "Website or social page",
  productDescription: "What you sell",
  industry: "Industry",
  supportEmail: "Customer support email",
  address: "Registered address",
  representative: "Representative name, title and email",
  owners: "Beneficial owners' names, countries and ownership share",
  monthlyVolume: "Expected monthly volume band",
  settlementCurrency: "Settlement currency",
};

// Data minimisation: a partner only ever receives the fields in its manifest.
export function projectProfile(
  profile: KybProfile,
  fields: readonly KybField[],
): Partial<KybProfile> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (profile[f] !== undefined) out[f] = profile[f];
  return out as Partial<KybProfile>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  return value;
}

// Stable fingerprint of exactly what was (or will be) disclosed.
export function fingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

// Pre-fill a draft from the existing merchant application so merchants do not
// type the same facts twice.
export function draftFromApplication(application: unknown) {
  const a = (application ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : undefined);
  return {
    legalName: pick("legalName"),
    tradingName: pick("tradingName"),
    country: pick("country"),
    website: pick("website"),
    productDescription: pick("activity"),
    supportEmail: pick("businessContact"),
  };
}
