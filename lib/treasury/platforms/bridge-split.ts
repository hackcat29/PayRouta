// Bridge (by Stripe) licensed stablecoin-to-fiat orchestration and bank
// settlement module (split settlement). Merchants without a Web3 wallet apply
// once to PayRouta; PayRouta provisions the merchant's Bridge customer and
// verified fiat external bank account by API (/v0/customers and
// /v0/customers/:id/external_accounts). Each payment creates an orchestrated
// Bridge transfer (/v0/transfers) on behalf of the merchant with PayRouta's
// fee withheld as `developer_fee` and settles converted fiat directly to the
// merchant's external bank account via ACH, SEPA, Faster Payments, SPEI or Pix.
//
// Verified with injected transports; run against Bridge sandbox before
// qualifying the sandbox platform account.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps, StatusSnapshot } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "../../partners/money";
import type { PlatformAdapter, PlatformManifest, PlatformModule, RefundState } from "./contract";

const countryCurrency: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  IE: "EUR",
  DE: "EUR",
  FR: "EUR",
  NL: "EUR",
  ES: "EUR",
  IT: "EUR",
  MX: "MXN",
  BR: "BRL",
};

export const bridgeSplitManifest: PlatformManifest = {
  id: "bridge-split",
  name: "Bridge",
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: true,
  feeCollection: "withheld",
  merchantCountries: Object.keys(countryCurrency),
  methods: ["bank-transfer", "digital-wallet"],
  sharedFields: [
    "legalName",
    "tradingName",
    "businessType",
    "country",
    "registrationNumber",
    "taxId",
    "website",
    "productDescription",
    "supportEmail",
    "address",
    "representative",
    "owners",
  ],
  paymentHosts: ["checkout.bridge.xyz", "sandbox.checkout.bridge.xyz"],
  documentation: "https://apidocs.bridge.xyz/reference/post_transfers",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    apiKeyRef: z.string().max(100).optional(),
    webhookSecretRef: z.string().max(100).optional(),
    settlementDays: z.number().int().min(0).max(14).default(1),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const accountIdPattern = /^([A-Za-z0-9_-]{4,60}):([A-Za-z0-9_-]{4,60})$/;
const transferIdPattern = /^[A-Za-z0-9_-]{4,100}$/;

export const bridgeReference = (attemptKey: string) => attemptKey.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);

export function bridgeFiatRail(currency: string): string | undefined {
  if (currency === "USD") return "ach";
  if (currency === "EUR") return "sepa";
  if (currency === "GBP") return "faster_payments";
  if (currency === "MXN") return "spei";
  if (currency === "BRL") return "pix";
  return undefined;
}

function majorToMinor(value: unknown, currency: string) {
  const exp = currencyExponent(currency);
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || num < 0 || exp === null) return null;
  return BigInt(Math.round(num * 10 ** exp));
}

export function bridgeSnapshot(customer: Record<string, unknown>, providerAccountId: string): StatusSnapshot {
  const status = String(customer.status ?? "").toLowerCase();
  if (status === "active" || status === "approved") {
    return {
      state: "Approved",
      providerAccountId,
      requirementsDue: [],
      paymentsEnabled: true,
      payoutsEnabled: true,
    };
  }
  if (status === "incomplete" || status === "awaiting_questionnaire") {
    return {
      state: "Action required",
      providerAccountId,
      requirementsDue: ["business-document"],
      paymentsEnabled: false,
      payoutsEnabled: false,
    };
  }
  if (status === "rejected" || status === "offboarded" || status === "paused") {
    return {
      state: "Restricted",
      providerAccountId,
      requirementsDue: ["review"],
      paymentsEnabled: false,
      payoutsEnabled: false,
    };
  }
  return {
    state: "Under review",
    providerAccountId,
    requirementsDue: ["review"],
    paymentsEnabled: false,
    payoutsEnabled: false,
  };
}

function parseAccountPair(id: string) {
  const m = accountIdPattern.exec(id);
  if (!m) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
  return { customerId: m[1], externalAccountId: m[2] };
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const c = configSchema.parse(raw);
  const baseUrl = c.environment === "production" ? "https://api.bridge.xyz" : "https://api.sandbox.bridge.xyz";
  const expectedHost = c.environment === "production" ? "checkout.bridge.xyz" : "sandbox.checkout.bridge.xyz";
  const now = () => (deps.now ? deps.now() : new Date());

  async function call(method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) {
    const apiKey = c.apiKeyRef ? await deps.credentials.get(c.apiKeyRef) : "";
    if (!apiKey) throw new PortalError("BRIDGE_CREDENTIALS_NOT_CONFIGURED", 409);
    const expectedPrefix = c.environment === "production" ? "sk-live-" : "sk-test-";
    if (!apiKey.startsWith(expectedPrefix)) throw new PortalError("BRIDGE_KEY_ENVIRONMENT_MISMATCH", 409);
    const response = await deps.http(baseUrl, {
      method,
      path: `/v0${path}`,
      headers: {
        "Api-Key": apiKey,
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("BRIDGE", response.status);
    return parseJson(response.body);
  }

  function belongsTo(t: Record<string, unknown>, providerAccountId: string) {
    const { customerId, externalAccountId } = parseAccountPair(providerAccountId);
    const dest = (t.destination ?? {}) as { external_account_id?: unknown };
    if (
      (t.on_behalf_of !== undefined && t.on_behalf_of !== customerId) ||
      (dest.external_account_id !== undefined && dest.external_account_id !== externalAccountId)
    )
      throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
  }

  return {
    async createAccount(input) {
      if (input.environment !== c.environment) throw new PortalError("PLATFORM_ENVIRONMENT_MISMATCH", 409);
      const bank = input.details.payoutAccount;
      const country = input.profile.country ?? "";
      if (countryCurrency[country] !== bank.currency || bank.country !== country)
        throw new PortalError("PAYOUT_ACCOUNT_NOT_SUPPORTED", 422);
      const rep = input.profile.representative;
      const customer = await call(
        "POST",
        "/customers",
        {
          type: input.profile.businessType === "sole-proprietor" ? "individual" : "business",
          business_name: input.profile.legalName,
          trading_name: input.profile.tradingName,
          email: input.profile.supportEmail,
          business_description: input.profile.productDescription,
          website: input.profile.website,
          registered_address: input.profile.address
            ? {
                street_line_1: input.profile.address.line1,
                city: input.profile.address.city,
                state: input.profile.address.region,
                postal_code: input.profile.address.postalCode,
                country: input.profile.address.country,
              }
            : undefined,
          identifying_information: [
            ...(input.profile.registrationNumber
              ? [{ type: "business_registration", issuing_country: country, number: input.profile.registrationNumber }]
              : []),
            ...(input.profile.taxId ? [{ type: "tax_id", issuing_country: country, number: input.profile.taxId }] : []),
          ],
          associated_persons: rep
            ? [
                {
                  first_name: rep.givenName,
                  last_name: rep.familyName,
                  email: rep.email,
                  title: rep.title,
                  birth_date: input.details.representative.dateOfBirth,
                  has_control: true,
                },
              ]
            : [],
          signed_agreement_id: `payrouta-tos-${input.linkId}-${Math.floor(input.agreement.acceptedAt.getTime() / 1000)}`,
        },
        `payrouta-bridge-customer-${input.linkId}`,
      );
      if (typeof customer.id !== "string" || !/^[A-Za-z0-9_-]{4,60}$/.test(customer.id))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const ext = await call(
        "POST",
        `/customers/${encodeURIComponent(customer.id)}/external_accounts`,
        {
          currency: bank.currency.toLowerCase(),
          account_owner_name: bank.holderName,
          account_owner_type: bank.holderType,
          account_number: bank.accountNumber,
          routing_number: bank.routingNumber,
          account_type: bank.currency === "EUR" ? "iban" : "us",
        },
        `payrouta-bridge-ext-${input.linkId}`,
      );
      if (typeof ext.id !== "string" || !/^[A-Za-z0-9_-]{4,60}$/.test(ext.id))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const providerAccountId = `${customer.id}:${ext.id}`;
      return {
        providerAccountId,
        snapshot: bridgeSnapshot(customer, providerAccountId),
      };
    },
    async accountStatus(providerAccountId) {
      const { customerId } = parseAccountPair(providerAccountId);
      const customer = await call("GET", `/customers/${encodeURIComponent(customerId)}`);
      return bridgeSnapshot(customer, providerAccountId);
    },
    async createPayment(input) {
      const { customerId, externalAccountId } = parseAccountPair(input.providerAccountId);
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      const destRail = bridgeFiatRail(input.currency);
      if (
        minor === null ||
        !destRail ||
        !["bank-transfer", "digital-wallet"].includes(input.method) ||
        input.feeMinor >= minor
      )
        return { state: "Rejected", reference: "" };
      const reference = bridgeReference(input.attemptKey);
      const t = await call(
        "POST",
        "/transfers",
        {
          on_behalf_of: customerId,
          client_reference_id: reference,
          amount: input.amount,
          developer_fee: fromMinorUnits(input.feeMinor, input.currency),
          source:
            input.method === "digital-wallet"
              ? { payment_rail: "base", currency: "usdc" }
              : { payment_rail: destRail, currency: input.currency.toLowerCase() },
          destination: {
            payment_rail: destRail,
            currency: input.currency.toLowerCase(),
            external_account_id: externalAccountId,
          },
          return_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
        `payrouta-bridge-tx-${reference}`,
      );
      const id = typeof t.id === "string" && transferIdPattern.test(t.id) ? t.id : null;
      const url = typeof t.hosted_url === "string" ? t.hosted_url : typeof t.checkout_url === "string" ? t.checkout_url : null;
      if (!id || !url) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const checked = assertPaymentHost([expectedHost], url);
      return {
        state: "Requires action",
        reference: id,
        actionUrl: assertPaymentHost(bridgeSplitManifest.paymentHosts, checked),
      };
    },
    async paymentStatus(input) {
      if (!transferIdPattern.test(input.reference)) return null;
      const t = await call("GET", `/transfers/${encodeURIComponent(input.reference)}`);
      const dest = (t.destination ?? {}) as { currency?: unknown };
      const currency = typeof dest.currency === "string" ? dest.currency.toUpperCase() : typeof t.currency === "string" ? t.currency.toUpperCase() : "";
      const minor = majorToMinor(t.amount, currency);
      const amount = minor === null ? null : fromMinorUnits(minor, currency);
      if (!amount) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const status = String(t.state ?? t.status ?? "").toLowerCase();
      if (status === "payment_processed") belongsTo(t, input.providerAccountId);
      const state =
        status === "payment_processed"
          ? "Confirmed"
          : ["canceled", "error", "returned", "refunded", "failed"].includes(status)
            ? "Rejected"
            : ["funds_received", "in_review", "payment_submitted"].includes(status)
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },
    async verifyEvent({ rawBody, headers }) {
      const secret = c.webhookSecretRef ? await deps.credentials.get(c.webhookSecretRef) : "";
      const sigHeader = headers.get("x-webhook-signature") || "";
      const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.trim().split("=", 2)));
      const ts = Number(parts.t);
      const v0 = parts.v0 || "";
      if (!secret || !Number.isFinite(ts) || !/^[a-f0-9]{64}$/.test(v0)) return null;
      if (Math.abs(Math.floor(now().getTime() / 1000) - ts) > 300) return null;
      const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest();
      if (!timingSafeEqual(Buffer.from(v0, "hex"), expected)) return null;
      const body = parseJson(rawBody);
      const eventId = typeof body.event_id === "string" ? body.event_id : "";
      const type = typeof body.event_type === "string" ? body.event_type.slice(0, 100) : "";
      const objectId = typeof body.event_object_id === "string" ? body.event_object_id : "";
      if (!eventId || !type || !objectId) return null;
      const kind = type.startsWith("transfer.") ? "payment" : type.startsWith("customer.") ? "account" : "other";
      return {
        eventId,
        type,
        kind,
        ...(kind === "account" ? { accountRef: objectId } : { objectRef: objectId }),
      };
    },
    async createRefund(input) {
      parseAccountPair(input.providerAccountId);
      const r = await call(
        "POST",
        `/transfers/${encodeURIComponent(input.reference)}/refunds`,
        {
          amount: fromMinorUnits(input.amountMinor, input.currency),
          reason: `PayRouta refund ${input.refundId}`.slice(0, 100),
        },
        `payrouta-bridge-refund-${input.refundId}`,
      );
      if (typeof r.id !== "string" || !transferIdPattern.test(r.id))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { reference: r.id, ...bridgeRefundState(r) };
    },
    async refundStatus(input) {
      if (!transferIdPattern.test(input.reference)) return null;
      return bridgeRefundState(await call("GET", `/refunds/${encodeURIComponent(input.reference)}`));
    },
    async fundsAvailability(input) {
      if (!transferIdPattern.test(input.reference)) return null;
      const t = await call("GET", `/transfers/${encodeURIComponent(input.reference)}`);
      if (String(t.state ?? t.status ?? "").toLowerCase() !== "payment_processed") return null;
      belongsTo(t, input.providerAccountId);
      const dest = (t.destination ?? {}) as { currency?: unknown };
      const currency = typeof dest.currency === "string" ? dest.currency.toUpperCase() : "";
      const receipt = (t.receipt ?? {}) as { final_amount?: unknown; exchange_fee?: unknown; gas_fee?: unknown };
      const gross = majorToMinor(t.amount, currency);
      const finalMinor = receipt.final_amount !== undefined ? majorToMinor(receipt.final_amount, currency) : null;
      const exFee = majorToMinor(receipt.exchange_fee ?? 0, currency) ?? 0n;
      const gasFee = majorToMinor(receipt.gas_fee ?? 0, currency) ?? 0n;
      const updated = typeof t.updated_at === "string" ? new Date(t.updated_at) : typeof t.created_at === "string" ? new Date(t.created_at) : null;
      if (gross === null || !updated || Number.isNaN(updated.getTime()))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const netMinor = finalMinor !== null ? finalMinor : gross - input.feeMinor - exFee - gasFee;
      return {
        paymentRef: typeof t.id === "string" ? t.id : input.reference,
        netMinor,
        availableAt: new Date(updated.getTime() + c.settlementDays * 86400000),
      };
    },
  };
}

export function bridgeRefundState(r: Record<string, unknown>): { state: RefundState; failureCode?: string } {
  const s = String(r.state ?? r.status ?? "").toLowerCase();
  if (s === "completed" || s === "payment_processed" || s === "succeeded") return { state: "Succeeded" };
  if (s === "failed" || s === "error" || s === "canceled") return { state: "Failed", failureCode: "bridge-refund-failed" };
  return { state: "Pending" };
}

export const bridgeSplitPlatform: PlatformModule = {
  manifest: bridgeSplitManifest,
  configSchema,
  create,
};
