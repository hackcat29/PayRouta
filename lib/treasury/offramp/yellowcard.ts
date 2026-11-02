// Yellow Card Payments API, for cashing out in local currency to a bank or
// mobile money account across Africa and Latin America (NGN, KES, GHS, ZAR,
// UGX, TZS, ZMW, MXN, ARS, BRL, COP and more). PayRouta's Yellow Card USD
// balance is topped up by the merchant's own payout of USDC (./cashout.ts);
// Yellow Card then pays the merchant in local currency.
//
// API: https://docs.yellowcard.engineering. Requests are signed: base64
// HMAC-SHA256 over timestamp + path + METHOD (+ base64 sha256 of the body
// for POST and PUT), sent as `Authorization: YcHmacV1 <key>:<signature>`
// with `X-YC-Timestamp`.
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import { secretManager } from "../../portal/adapters";
import { providerRequest } from "../../providers/adapters/http";
import type { Http } from "../../intents/oneclick";

const base = (environment: string) => (environment === "production" ? "https://api.yellowcard.io" : "https://sandbox.api.yellowcard.io");

export function ycSignature(secret: string, timestamp: string, path: string, method: string, body?: string) {
  const h = createHmac("sha256", secret).update(timestamp + path + method.toUpperCase());
  if (body !== undefined && (method === "POST" || method === "PUT")) h.update(createHash("sha256").update(body).digest("base64"));
  return h.digest("base64");
}

async function credentials(environment: string) {
  const live = environment === "production";
  const key = live ? process.env.YELLOWCARD_API_KEY : process.env.YELLOWCARD_SANDBOX_API_KEY;
  const ref = live ? process.env.YELLOWCARD_API_SECRET_REF : process.env.YELLOWCARD_SANDBOX_API_SECRET_REF;
  if (!key || !ref) throw new PortalError("CASHOUT_PARTNER_NOT_CONFIGURED", 503);
  return { key, secret: await secretManager.get(ref) };
}

export async function yellowCard<T>(
  environment: string,
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  body?: object,
  http: Http = providerRequest,
  now = new Date(),
) {
  const { key, secret } = await credentials(environment);
  const raw = body ? JSON.stringify(body) : undefined;
  const timestamp = now.toISOString();
  // The query string is not signed.
  const signed = path.split("?")[0];
  const response = await http(base(environment), {
    method,
    path,
    headers: {
      "X-YC-Timestamp": timestamp,
      Authorization: `YcHmacV1 ${key}:${ycSignature(secret, timestamp, signed, method, raw)}`,
      Accept: "application/json",
    },
    ...(raw ? { body: raw } : {}),
    timeoutMs: 15000,
    maxResponseBytes: 1048576,
  });
  if (response.status === 401 || response.status === 403) throw new PortalError("CASHOUT_PARTNER_NOT_CONFIGURED", 503);
  if (response.status === 404) throw new PortalError("CASHOUT_PARTNER_NOT_FOUND", 404);
  if (response.status >= 400 && response.status < 500) throw new PortalError("CASHOUT_PARTNER_REFUSED", 409);
  if (response.status >= 300) throw new PortalError("CASHOUT_PARTNER_UNAVAILABLE", 503);
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    throw new PortalError("CASHOUT_PARTNER_UNAVAILABLE", 503);
  }
  const ok = schema.safeParse(parsed);
  if (!ok.success) throw new PortalError("CASHOUT_PARTNER_UNAVAILABLE", 503);
  return ok.data;
}

export const networks = z.object({
  networks: z.array(
    z
      .object({
        id: z.string(),
        name: z.string(),
        country: z.string(),
        status: z.string(),
        channelType: z.enum(["bank", "momo"]).optional(),
        accountNumberType: z.string().optional(),
      })
      .passthrough(),
  ),
});

export const send = z
  .object({
    id: z.string(),
    sequenceId: z.string(),
    status: z.string(),
    amount: z.number(),
    convertedAmount: z.number().optional(),
    rate: z.number().optional(),
    currency: z.string(),
    errorCode: z.string().nullable().optional(),
  })
  .passthrough();

// Where the merchant is paid: a bank account or a mobile money wallet on a
// Yellow Card network (GET /business/networks).
export const destinationInput = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  channelType: z.enum(["bank", "momo"]),
  networkId: z.string().min(1).max(100),
  networkName: z.string().min(1).max(120),
  accountNumber: z.string().trim().regex(/^[A-Za-z0-9+\- ]{4,40}$/),
  accountName: z.string().trim().min(2).max(120),
});
export type Destination = z.infer<typeof destinationInput>;

// Yellow Card send states (apidocs: Lookup Send).
export const sendPaid = new Set(["complete"]);
export const sendFailed = new Set(["expired", "failed", "denied", "refunded", "cancelled", "rejected", "refund_failed"]);
