import { z } from "zod";
export const intents = ["merchant", "provider", "pricing", "general"] as const;
export type Intent = (typeof intents)[number];
export function safeIntent(value: unknown): Intent {
  return intents.includes(value as Intent) ? (value as Intent) : "general";
}
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().default("");
export const enquirySchema = z
  .object({
    submissionId: z.uuid(),
    intent: z.enum(intents),
    name: z.string().trim().min(2, "Enter your name.").max(100),
    email: z.email("Enter a valid work email.").max(254),
    company: z.string().trim().min(2, "Enter your company.").max(160),
    country: z.string().trim().min(2, "Enter your country or region.").max(100),
    message: z
      .string()
      .trim()
      .min(10, "Add at least 10 characters about your requirements.")
      .max(4000),
    website: optionalText(500).refine(
      (v) => !v || /^https?:\/\/[^\s]+$/i.test(v),
      "Use a full http:// or https:// website URL.",
    ),
    volume: optionalText(100),
    methods: z
      .array(
        z.enum([
          "Bank payments & direct debit",
          "Bank payments",
          "Cards & domestic schemes (Visa, Mastercard, Verve, CB, JCB)",
          "Cards & domestic schemes",
          "Cards",
          "Instant bank transfers (iDEAL, FedNow, Pix, UPI, NIP)",
          "Instant bank transfers (iDEAL, FedNow, Pix, UPI)",
          "Instant bank transfers (Pix, UPI, iDEAL)",
          "Instant A2A (Pix, UPI, iDEAL)",
          "Instant A2A (Pix, UPI)",
          "Digital wallets (Apple Pay, Google Pay, PayPal, OPay, PalmPay)",
          "Digital wallets (Apple Pay, Google Pay, PayPal, Cash App)",
          "Digital wallets (Apple Pay, Alipay)",
          "Digital wallets & super-apps",
          "Digital wallets",
          "Direct debit & wire transfers (ACH, SEPA, Bacs, Wire)",
          "Direct debit & wire transfers (ACH, SEPA)",
          "Direct debit & wire transfers",
          "Cash vouchers (OXXO, Konbini, Paysafecard, Boleto)",
          "Cash vouchers (OXXO, Konbini, Paysafecard)",
          "Cash vouchers (OXXO, Boleto)",
          "Cash vouchers & retail OTC",
          "Cash vouchers & OTC",
          "Buy now, pay later & installments (Klarna, Affirm, Tabby)",
          "Buy now, pay later & installments",
          "BNPL & Installments",
          "Mobile money & phone bills (M-Pesa, MTN MoMo, Airtel)",
          "Mobile money & phone bills",
          "Mobile money & carrier billing",
          "Mobile money",
          "Stablecoins (Circle USDC)",
          "Stablecoins (USDC, USDT, EURC)",
          "Stablecoins (USDC, USDT)",
          "Stablecoins & multi-chain rails",
          "Stablecoins & Multi-chain",
          "Stablecoins",
          "Crypto",
          "Crypto apps & exchanges (Binance Pay, Coinbase)",
          "Centralized crypto venues (e.g. Binance Pay, Coinbase)",
          "Centralized crypto (Binance Pay)",
          "Real-World Assets (e.g. Ondo, Paxos Gold, T-Bills)",
          "Real-World Assets (RWAs)",
          "Tokenized Real-World Assets (e.g. Ondo, T-Bills)",
          "RWA & Yield assets (Ondo)",
          "Local payment methods",
          "Local rails",
        ]),
      )
      .max(25)
      .optional()
      .default([]),
    providerType: optionalText(120),
    capabilities: optionalText(1000),
    companyFax: z.string().max(0, "Submission blocked.").optional().default(""),
  })
  .strict();
export type Enquiry = z.infer<typeof enquirySchema>;
