import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
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
    amount: decimal,
    asset: assetSchema,
    precision: z.number().int().min(0).max(18),
    methods: z
      .array(z.enum(["bank-transfer", "card", "mobile-money", "stablecoin"]))
      .min(1)
      .max(3),
    settlement: assetSchema,
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
export const providerFact = z
  .object({
    reference: z.string().min(1).max(200),
    state: z.enum(["Requires action", "Pending", "Confirmed", "Rejected"]),
    amount: decimal,
    asset: assetSchema,
  })
  .strict();
