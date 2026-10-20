import { z } from "zod";
export const cryptoCheckoutInput = z
  .object({
    reference: z.string().trim().min(1).max(100),
    payerCountry: z.string().regex(/^[A-Z]{2}$/),
    usdAmount: z.string().regex(/^(0|[1-9]\d{0,11})\.\d{2}$/),
    feeBearer: z.enum(["merchant", "customer"]).optional(),
    options: z
      .array(z.object({ network: z.string(), identifier: z.string() }).strict())
      .min(1)
      .max(20),
  })
  .strict();
