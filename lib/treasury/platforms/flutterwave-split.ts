// Flutterwave subaccounts on PayRouta's Flutterwave account (split
// settlement). Merchants never see Flutterwave: PayRouta verifies the payout
// account by name enquiry and creates the subaccount by API. Each payment is
// a Flutterwave Standard payment on PayRouta's account with the merchant's
// subaccount; PayRouta's fee is a flat `transaction_charge` and Flutterwave's
// fee is debited from the settlement. Flutterwave pays the merchant's bank
// directly, so this rail cannot hold a rolling reserve (see paystack-split.ts).
//
// Flutterwave's verify response does not report the subaccount's share; the
// share is computed as amount − PayRouta's fee − Flutterwave's app_fee and
// must be confirmed against settlement reports (reconciliation, phase 2c).
// Verified with injected transports only; run it against Flutterwave test
// mode before qualifying the sandbox platform account.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "../../partners/money";
import type { PlatformAdapter, PlatformManifest, PlatformModule, RefundState } from "./contract";
import { accountNameMatches } from "./paystack-split";

const countryCurrency: Record<string, string> = {
  NG: "NGN",
  GH: "GHS",
  KE: "KES",
  UG: "UGX",
  TZ: "TZS",
  RW: "RWF",
  ZA: "ZAR",
};

export const flutterwaveSplitManifest: PlatformManifest = {
  id: "flutterwave-split",
  name: "Flutterwave",
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: true,
  feeCollection: "withheld",
  merchantCountries: Object.keys(countryCurrency),
  methods: ["card", "bank-transfer", "mobile-money", "ussd"],
  sharedFields: ["legalName", "tradingName", "country", "supportEmail", "representative"],
  paymentHosts: ["checkout.flutterwave.com", "checkout-v2.dev-flutterwave.com"],
  documentation: "https://developer.flutterwave.com/v3.0/docs/split-payments",
};

const mobileMoney: Record<string, string> = {
  GHS: "mobilemoneyghana",
  KES: "mpesa",
  UGX: "mobilemoneyuganda",
  RWF: "mobilemoneyrwanda",
  TZS: "mobilemoneytanzania",
  XOF: "mobilemoneyfranco",
  XAF: "mobilemoneyfranco",
  ZMW: "mobilemoneyzambia",
};
export function flutterwaveOption(method: string, currency: string) {
  if (method === "card") return "card";
  if (method === "bank-transfer") return "banktransfer";
  if (method === "ussd") return currency === "NGN" ? "ussd" : undefined;
  if (method === "mobile-money") return mobileMoney[currency];
  return undefined;
}

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.flutterwave.com").default("https://api.flutterwave.com"),
    secretKeyRef: z.string().max(100).optional(),
    // The "secret hash" set for webhooks in Flutterwave's dashboard.
    webhookHashRef: z.string().max(100).optional(),
    settlementDays: z.number().int().min(0).max(14).default(1),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const subaccountId = /^RS_[A-Za-z0-9]{4,60}$/;
export const flutterwaveReference = (attemptKey: string) => attemptKey.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);

// Flutterwave amounts are major-unit numbers; convert exactly or refuse.
function majorToMinor(value: unknown, currency: string) {
  const exp = currencyExponent(currency);
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || exp === null) return null;
  return BigInt(Math.round(value * 10 ** exp));
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const c = configSchema.parse(raw);
  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const secret = c.secretKeyRef ? await deps.credentials.get(c.secretKeyRef) : "";
    if (!secret) throw new PortalError("FLUTTERWAVE_CREDENTIALS_NOT_CONFIGURED", 409);
    const test = secret.startsWith("FLWSECK_TEST-");
    if (test !== (c.environment === "sandbox") || !secret.startsWith("FLWSECK"))
      throw new PortalError("FLUTTERWAVE_KEY_ENVIRONMENT_MISMATCH", 409);
    const response = await deps.http(c.baseUrl, {
      method,
      path: `/v3${path}`,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("FLUTTERWAVE", response.status);
    const parsed = parseJson(response.body);
    if (parsed.status !== "success") throw new PortalError("FLUTTERWAVE_REQUEST_REJECTED", 422);
    return (parsed.data ?? {}) as Record<string, unknown>;
  }
  const sub = (id: string) => {
    if (!subaccountId.test(id)) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
    return id;
  };
  async function verify(reference: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(reference)) return null;
    try {
      return await call("GET", `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    } catch (error) {
      if (error instanceof PortalError && error.status === 422) return null;
      throw error;
    }
  }
  // The payment carries the subaccount PayRouta attached in its metadata;
  // a payment echoing another subaccount is never this merchant's.
  function belongsTo(t: Record<string, unknown>, providerAccountId: string) {
    const meta = (t.meta ?? {}) as { payrouta_subaccount?: unknown };
    if (meta.payrouta_subaccount !== undefined && meta.payrouta_subaccount !== sub(providerAccountId))
      throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
  }
  return {
    async createAccount(input) {
      if (input.environment !== c.environment) throw new PortalError("PLATFORM_ENVIRONMENT_MISMATCH", 409);
      const bank = input.details.payoutAccount;
      const country = input.profile.country ?? "";
      if (countryCurrency[country] !== bank.currency || bank.country !== country || !bank.routingNumber)
        throw new PortalError("PAYOUT_ACCOUNT_NOT_SUPPORTED", 422);
      const resolved = await call("POST", "/accounts/resolve", {
        account_number: bank.accountNumber,
        account_bank: bank.routingNumber,
      });
      if (typeof resolved.account_name !== "string" || !accountNameMatches(bank.holderName, resolved.account_name))
        throw new PortalError("PAYOUT_ACCOUNT_NAME_MISMATCH", 422);
      const rep = input.profile.representative;
      let created: Record<string, unknown>;
      try {
        created = await call("POST", "/subaccounts", {
          account_bank: bank.routingNumber,
          account_number: bank.accountNumber,
          business_name: (input.profile.tradingName ?? input.profile.legalName ?? "").slice(0, 100),
          country,
          business_mobile: input.details.businessPhone,
          business_email: input.profile.supportEmail,
          business_contact: rep ? `${rep.givenName} ${rep.familyName}` : undefined,
          business_contact_mobile: input.details.representative.phone ?? input.details.businessPhone,
          // PayRouta's share is set per payment.
          split_type: "flat",
          split_value: 0,
          meta: [{ meta_name: "payrouta_link", meta_value: input.linkId }],
        });
      } catch (error) {
        if (!(error instanceof PortalError) || error.status !== 422) throw error;
        const list = await call("GET", `/subaccounts?account_number=${encodeURIComponent(bank.accountNumber)}`);
        const match = Array.isArray(list)
          ? (list.find(
              (item) =>
                (item as { account_number?: unknown; account_bank?: unknown }).account_number === bank.accountNumber &&
                (item as { account_bank?: unknown }).account_bank === bank.routingNumber,
            ) as Record<string, unknown> | undefined)
          : undefined;
        if (!match) throw error;
        created = match;
      }
      if (typeof created.subaccount_id !== "string" || !subaccountId.test(created.subaccount_id))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        providerAccountId: created.subaccount_id,
        // Flutterwave does not verify subaccounts: PayRouta's underwriting and
        // the name enquiry above are the checks.
        snapshot: {
          state: "Approved",
          providerAccountId: created.subaccount_id,
          requirementsDue: [],
          paymentsEnabled: true,
          payoutsEnabled: true,
        },
      };
    },
    // Subaccounts carry no provider-side verification state; PayRouta
    // restricts a merchant in its own underwriting instead.
    async accountStatus(id) {
      return {
        state: "Approved",
        providerAccountId: sub(id),
        requirementsDue: [],
        paymentsEnabled: true,
        payoutsEnabled: true,
      };
    },
    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      const option = flutterwaveOption(input.method, input.currency);
      if (minor === null || !option || input.feeMinor >= minor) return { state: "Rejected", reference: "" };
      if (!input.payerEmail || !z.email().safeParse(input.payerEmail).success)
        throw new PortalError("PROVIDER_CUSTOMER_DETAILS_REQUIRED", 409);
      const reference = flutterwaveReference(input.attemptKey);
      const t = await call("POST", "/payments", {
        tx_ref: reference,
        amount: Number(input.amount),
        currency: input.currency,
        redirect_url: input.returnUrl,
        customer: { email: input.payerEmail },
        payment_options: option,
        subaccounts: [
          {
            id: sub(input.providerAccountId),
            transaction_charge_type: "flat",
            transaction_charge: Number(fromMinorUnits(input.feeMinor, input.currency)),
          },
        ],
        meta: { payrouta_attempt: input.attemptKey, payrouta_subaccount: input.providerAccountId },
      });
      if (typeof t.link !== "string") throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        state: "Requires action",
        reference,
        actionUrl: assertPaymentHost(flutterwaveSplitManifest.paymentHosts, t.link),
      };
    },
    async paymentStatus(input) {
      const t = await verify(input.reference);
      if (!t) return null;
      const currency = typeof t.currency === "string" ? t.currency : "";
      const minor = majorToMinor(t.amount, currency);
      const amount = minor === null ? null : fromMinorUnits(minor, currency);
      if (!amount) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      if (t.status === "successful") belongsTo(t, input.providerAccountId);
      const state =
        t.status === "successful"
          ? "Confirmed"
          : t.status === "failed" || t.status === "cancelled"
            ? "Rejected"
            : "Pending";
      return { state, reference: input.reference, amount, currency };
    },
    async verifyEvent({ rawBody, headers }) {
      const hash = c.webhookHashRef ? await deps.credentials.get(c.webhookHashRef) : "";
      const given = Buffer.from(headers.get("verif-hash") || "");
      if (!hash || given.length !== Buffer.byteLength(hash) || !timingSafeEqual(given, Buffer.from(hash))) return null;
      const body = parseJson(rawBody);
      const type = typeof body.event === "string" ? body.event.slice(0, 100) : "";
      const data = (body.data ?? {}) as { id?: unknown; tx_ref?: unknown; status?: unknown };
      if (!type || typeof data.id !== "number") return null;
      return {
        eventId: `${type}:${data.id}:${String(data.status ?? "")}`,
        type,
        kind: type === "charge.completed" ? "payment" : "other",
        objectRef: typeof data.tx_ref === "string" ? data.tx_ref : undefined,
      };
    },
    async createRefund(input) {
      let id = input.paymentRef && /^\d{1,20}$/.test(input.paymentRef) ? input.paymentRef : undefined;
      if (!id) {
        const t = await verify(input.reference);
        if (typeof t?.id !== "number") throw new PortalError("REFUND_PAYMENT_NOT_FOUND", 422);
        id = String(t.id);
      }
      const r = await call("POST", `/transactions/${id}/refund`, {
        amount: Number(fromMinorUnits(input.amountMinor, input.currency)),
        comments: `PayRouta refund ${input.refundId}`.slice(0, 100),
      });
      if (r.id === undefined) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { reference: String(r.id), ...flutterwaveRefundState(r) };
    },
    async refundStatus(input) {
      if (!/^\d{1,20}$/.test(input.reference)) return null;
      return flutterwaveRefundState(await call("GET", `/refunds/${input.reference}`));
    },
    async fundsAvailability(input) {
      const t = await verify(input.reference);
      if (!t || t.status !== "successful") return null;
      belongsTo(t, input.providerAccountId);
      const currency = typeof t.currency === "string" ? t.currency : "";
      const gross = majorToMinor(t.amount, currency);
      const appFee = majorToMinor(t.app_fee ?? 0, currency);
      const created = typeof t.created_at === "string" ? new Date(t.created_at) : null;
      if (gross === null || appFee === null || !created || Number.isNaN(created.getTime()))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        paymentRef: typeof t.id === "number" ? String(t.id) : input.reference,
        netMinor: gross - input.feeMinor - appFee,
        availableAt: new Date(created.getTime() + c.settlementDays * 86400000),
      };
    },
  };
}

export function flutterwaveRefundState(r: Record<string, unknown>): { state: RefundState; failureCode?: string } {
  if (r.status === "completed" || r.status === "successful") return { state: "Succeeded" };
  if (r.status === "failed") return { state: "Failed", failureCode: "flutterwave-refund-failed" };
  return { state: "Pending" };
}

export const flutterwaveSplitPlatform: PlatformModule = {
  manifest: flutterwaveSplitManifest,
  configSchema,
  create,
};
