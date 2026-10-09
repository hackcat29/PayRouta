import { validateStablecoinPayment } from "../blockchain/stablecoin-payment";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { supportedPaymentMethodIds } from "../providers/normalized";
import {
  assetSchema,
  decimal,
  precisionValid,
  PortalError,
} from "../portal/domain";
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const minor = (value: string, scale: number) => {
  if (!precisionValid(value, scale) || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value))
    throw new PortalError("INVALID_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(scale, "0"));
};
export const assetKey = (a: {
  kind: string;
  identifier: string;
  network: string;
}) => `${a.kind}:${a.identifier}:${a.network}`;
export const intentInput = z
  .object({
    reference: z.string().min(1).max(100),
    payerCountry: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    amount: decimal,
    asset: assetSchema,
    precision: z.number().int().min(0).max(18),
    methods: z
      .array(z.enum(supportedPaymentMethodIds))
      .min(1)
      .max(supportedPaymentMethodIds.length)
      .refine(
        (methods) => new Set(methods).size === methods.length,
        "Duplicate payment method",
      ),
    settlement: assetSchema,
    paymentOptions: z
      .array(
        z
          .object({
            asset: assetSchema,
            amount: decimal,
            precision: z.number().int().min(0).max(18),
            settlement: assetSchema,
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .optional(),
    returnUrl: z.url().max(2048),
    metadata: z
      .record(z.string().max(40), z.string().max(200))
      .refine((v) => Object.keys(v).length <= 20)
      .default({}),
    scenario: z
      .enum([
        "success",
        "timeout",
        "action",
        "rejected",
        "fallback",
        "settlement-pending",
        "fee-mismatch",
        "late",
      ])
      .default("success"),
  })
  .strict();
export type Economics = {
  profileId: string;
  fee: string | null;
  seconds: number | null;
  reliability: number | null;
  capacity: number | null;
};
export function rank(candidates: Economics[], policy: string) {
  const score = (c: Economics) => {
    if (policy === "lower-cost") return c.fee === null ? null : BigInt(c.fee);
    if (policy === "faster")
      return c.seconds === null ? null : BigInt(c.seconds);
    // Fixed integer factors; unknown history has an explicit conservative penalty, never fabricated reliability.
    if (c.fee === null || c.seconds === null || c.capacity === null)
      return null;
    return (
      (BigInt(c.fee) > 10000n ? 10000n : BigInt(c.fee)) * 40n +
      BigInt(Math.min(10000, Math.floor((c.seconds * 10000) / 86400))) * 30n +
      BigInt(c.reliability === null ? 10000 : 10000 - c.reliability) * 20n +
      BigInt(10000 - c.capacity) * 10n
    );
  };
  return candidates
    .map((c) => ({ ...c, score: score(c) }))
    .filter((c) => c.score !== null)
    .sort((a, b) =>
      a.score! < b.score!
        ? -1
        : a.score! > b.score!
          ? 1
          : a.profileId.localeCompare(b.profileId),
    )
    .map((c) => ({ ...c, score: c.score!.toString() }));
}
export function signature(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${body}`)
    .digest("hex");
}
export function verify(
  secret: string,
  timestamp: string,
  eventId: string,
  body: string,
  supplied: string,
  now: Date,
) {
  if (
    !/^\d+$/.test(timestamp) ||
    Math.abs(now.getTime() - Number(timestamp) * 1000) > 300000 ||
    !/^[a-f0-9]{64}$/.test(supplied)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(signature(secret, timestamp, eventId, body), "hex"),
    Buffer.from(supplied, "hex"),
  );
}
export const activeStates = [
  "Created",
  "Dispatching",
  "Requires action",
  "Pending",
  "Unknown",
  "Confirmed",
];
// Customer action from a partner execution: a redirect to the partner's
// declared payment host, or a sandbox authorization.
export const factAction = z
  .object({
    kind: z.enum(["redirect", "sandbox", "qr", "deposit", "paypal-venmo"]),
    url: z.url().max(2048).optional(),
    image: z
      .string()
      .max(60000)
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
      .optional(),
    code: z.string().max(4096).optional(),
    address: z.string().max(100).optional(),
    network: z.string().max(100).optional(),
    identifier: z.string().max(200).optional(),
    amount: decimal.optional(),
    symbol: z.string().min(1).max(80).optional(),
    orderId: z
      .string()
      .regex(/^[A-Z0-9]{10,40}$/)
      .optional(),
    clientId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{10,200}$/)
      .optional(),
    merchantId: z
      .string()
      .regex(/^[A-Z0-9]{8,20}$/)
      .optional(),
    environment: z.enum(["sandbox", "production"]).optional(),
    provider: z.string().max(80),
    text: z.string().max(300),
  })
  .strict()
  .superRefine((action, ctx) => {
    if (
      action.kind === "paypal-venmo" &&
      (!action.orderId ||
        !action.clientId ||
        !action.merchantId ||
        !action.environment)
    )
      ctx.addIssue({ code: "custom", message: "Venmo action is incomplete" });
    if (
      action.kind === "deposit" &&
      (!action.address ||
        !action.network ||
        !action.identifier ||
        !action.amount ||
        !action.symbol)
    )
      ctx.addIssue({ code: "custom", message: "Deposit action is incomplete" });
    if (
      action.kind === "deposit" &&
      action.address &&
      action.network &&
      action.identifier &&
      action.amount
    ) {
      try {
        const { token } = validateStablecoinPayment({
          address: action.address,
          network: action.network,
          identifier: action.identifier,
          amount: action.amount,
        });
        if (action.symbol !== token.symbol)
          ctx.addIssue({
            code: "custom",
            message: "Deposit symbol does not match the registered asset",
          });
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Invalid token, chain, address or amount",
        });
      }
    }
    if (
      (action.kind === "redirect" && !action.url) ||
      (action.kind === "qr" && (!action.image || !action.code))
    )
      ctx.addIssue({ code: "custom", message: "Payment action is incomplete" });
  });
export const providerFact = z
  .object({
    reference: z.string().min(1).max(200),
    state: z.enum(["Requires action", "Pending", "Confirmed", "Rejected"]),
    amount: decimal,
    asset: assetSchema,
    action: factAction.optional(),
  })
  .strict();
