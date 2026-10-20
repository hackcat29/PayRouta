// Request and response of POST /checkouts (./universal.ts), kept apart so
// the merchant API contracts can import them without the service.
import { z } from "zod";
import { fiatPaymentMethodIds } from "../providers/normalized";

export const universalCheckoutInput = z
  .object({
    reference: z.string().trim().min(1).max(100),
    payerCountry: z.string().regex(/^[A-Z]{2}$/),
    amount: z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,8})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
    // Fiat methods to offer; empty for a crypto-only checkout.
    methods: z
      .array(z.enum(fiatPaymentMethodIds))
      .max(fiatPaymentMethodIds.length)
      .refine((m) => new Set(m).size === m.length, "Duplicate payment method")
      .default([]),
    // Coins and networks to offer (USD orders only).
    crypto: z
      .object({
        options: z.array(z.object({ network: z.string(), identifier: z.string() }).strict()).min(1).max(20),
      })
      .strict()
      .optional(),
    returnUrl: z.url().max(2048),
    feeBearer: z.enum(["merchant", "customer"]).optional(),
    metadata: z
      .record(z.string().max(40), z.string().max(200))
      .refine((v) => Object.keys(v).length <= 20)
      .optional(),
  })
  .strict()
  .refine((v) => v.methods.length || v.crypto, "Offer at least one fiat method or crypto");

export const universalCheckoutResponse = z
  .object({
    id: z.string(),
    reference: z.string(),
    checkoutPath: z.string(),
    expiresAt: z.iso.datetime(),
    intents: z.array(z.object({ kind: z.enum(["fiat", "crypto"]), intentId: z.string() }).strict()).min(1).max(2),
  })
  .strict();
