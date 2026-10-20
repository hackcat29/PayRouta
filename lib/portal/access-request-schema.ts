// The public "request provider access" form. Shared by the browser form and
// the API so both report the same field errors.
import { z } from "zod";

export const accessProviderTypes = [
  "Payment processor / PSP",
  "Bank / BaaS provider",
  "Card acquirer",
  "Bank-transfer provider",
  "Mobile-money provider",
  "Digital-wallet provider",
  "Payout provider",
  "Crypto payment provider",
  "Stablecoin / on-ramp / off-ramp provider",
  "BNPL provider",
  "Lender / consumer-credit provider",
  "Cash / voucher provider",
  "FX / conversion provider",
  "Other payment service",
] as const;

export const accessMethods = [
  "Cards",
  "Bank transfers",
  "USSD",
  "Mobile money",
  "Digital wallets",
  "Direct debit",
  "Buy now, pay later",
  "Instalment and consumer credit",
  "Cash vouchers",
  "Stablecoins and crypto",
  "Payouts",
] as const;

const text = (min: number, max: number, message: string) =>
  z.string().trim().min(min, message).max(max);

export const accessRequestSchema = z.object({
  submissionId: z.uuid(),
  name: text(2, 100, "Enter your name."),
  email: z
    .email("Enter a valid work email.")
    .max(254)
    .transform((s) => s.toLowerCase()),
  company: text(2, 160, "Enter your company's legal or trading name."),
  website: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\/[^\s.]+\.[^\s]+$/i.test(v), "Use your full website address, starting https://"),
  country: text(2, 100, "Enter the country you're licensed or registered in."),
  providerType: z.enum(accessProviderTypes, "Choose what kind of payment service you run."),
  methods: z.array(z.enum(accessMethods)).min(1, "Choose at least one payment method.").max(accessMethods.length),
  markets: text(2, 500, "List the countries where you can process payments."),
  message: z.string().trim().max(2000).optional().default(""),
  // Honeypot: real people never see or fill this.
  companyFax: z.string().max(0).optional().default(""),
});
export type AccessRequest = z.infer<typeof accessRequestSchema>;
