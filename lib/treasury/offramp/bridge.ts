// Bridge (bridge.xyz), for cashing out to a bank in USD (ACH or wire) or
// EUR (SEPA). The merchant is verified once through a Bridge KYB link; their
// bank account is registered with Bridge; and a liquidation address on Base
// converts any USDC sent to it and pays that bank. PayRouta never holds the
// funds: the merchant's own payout sends the USDC (./cashout.ts).
//
// API: https://apidocs.bridge.xyz. `Api-Key` and `Idempotency-Key` headers;
// sandbox https://api.sandbox.bridge.xyz/v0 with sk-test keys.
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import { secretManager } from "../../portal/adapters";
import { providerRequest } from "../../providers/adapters/http";
import type { Http } from "../../intents/oneclick";

const base = (environment: string) => (environment === "production" ? "https://api.bridge.xyz" : "https://api.sandbox.bridge.xyz");

// Whether Bridge can take cash outs here: its key is set for this mode.
export const bridgeConfigured = (environment: string) =>
  !!(environment === "production" ? process.env.BRIDGE_API_KEY_REF : process.env.BRIDGE_SANDBOX_API_KEY_REF);

async function key(environment: string) {
  const ref = environment === "production" ? process.env.BRIDGE_API_KEY_REF : process.env.BRIDGE_SANDBOX_API_KEY_REF;
  if (!ref) throw new PortalError("CASHOUT_PARTNER_NOT_CONFIGURED", 503);
  return secretManager.get(ref);
}

export async function bridge<T>(
  environment: string,
  method: "GET" | "POST",
  path: string,
  schema: z.ZodType<T>,
  body?: object,
  idempotencyKey?: string,
  http: Http = providerRequest,
) {
  const response = await http(base(environment), {
    method,
    path: `/v0${path}`,
    headers: {
      "Api-Key": await key(environment),
      Accept: "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    timeoutMs: 15000,
    maxResponseBytes: 1048576,
  });
  if (response.status === 401 || response.status === 403) throw new PortalError("CASHOUT_PARTNER_NOT_CONFIGURED", 503);
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

export const kycLink = z
  .object({
    id: z.string(),
    kyc_link: z.string().url(),
    tos_link: z.string().url(),
    kyc_status: z.string(),
    tos_status: z.string(),
    customer_id: z.string().nullable().optional(),
  })
  .passthrough();

export const externalAccount = z.object({ id: z.string(), last_4: z.string().optional(), currency: z.string() }).passthrough();
export const liquidationAddress = z.object({ id: z.string(), address: z.string(), chain: z.string(), currency: z.string() }).passthrough();
export const drains = z.array(
  z
    .object({
      id: z.string(),
      amount: z.string(),
      currency: z.string(),
      state: z.string(),
      deposit_tx_hash: z.string().nullable().optional(),
      created_at: z.string(),
    })
    .passthrough(),
);

// A bank account: US (routing and account number) or SEPA (IBAN and BIC).
export const bankInput = z.discriminatedUnion("currency", [
  z.object({
    currency: z.literal("usd"),
    rail: z.enum(["ach", "wire"]),
    bankName: z.string().trim().min(2).max(100),
    accountName: z.string().trim().min(2).max(100),
    routingNumber: z.string().regex(/^\d{9}$/),
    accountNumber: z.string().regex(/^\d{4,17}$/),
    checkingOrSavings: z.enum(["checking", "savings"]),
  }),
  z.object({
    currency: z.literal("eur"),
    rail: z.literal("sepa"),
    bankName: z.string().trim().min(2).max(100),
    accountName: z.string().trim().min(2).max(100),
    iban: z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/),
    bic: z.string().regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/),
    ibanCountry: z.string().regex(/^[A-Z]{3}$/),
  }),
]);
export type BankInput = z.infer<typeof bankInput>;

// Bridge's external account body for a business-owned account.
export function externalAccountBody(b: BankInput, owner: { legalName: string; address: { line1: string; city: string; postalCode: string; country3: string; state?: string } }) {
  const address = {
    street_line_1: owner.address.line1,
    city: owner.address.city,
    postal_code: owner.address.postalCode,
    country: owner.address.country3,
    ...(owner.address.state ? { state: owner.address.state } : {}),
  };
  const common = { bank_name: b.bankName, account_name: b.accountName, account_owner_name: owner.legalName, account_owner_type: "business", business_name: owner.legalName, address };
  return b.currency === "usd"
    ? { ...common, currency: "usd", account_type: "us", account: { routing_number: b.routingNumber, account_number: b.accountNumber, checking_or_savings: b.checkingOrSavings } }
    : { ...common, currency: "eur", account_type: "iban", iban: { account_number: b.iban, bic: b.bic, country: b.ibanCountry } };
}

// Drain states (apidocs.bridge.xyz drains): paid, or stopped and needing a
// look (funds returned, refunded or held).
export const drainPaid = new Set(["payment_processed"]);
export const drainStopped = new Set([
  "undeliverable",
  "returned",
  "missing_return_policy",
  "refunded",
  "refund_in_flight",
  "refund_failed",
  "error",
  "canceled",
]);
