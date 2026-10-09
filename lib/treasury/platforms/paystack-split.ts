// Paystack subaccounts on PayRouta's Paystack account (split settlement).
// Merchants never see Paystack: PayRouta verifies the payout bank account by
// name enquiry and creates the subaccount by API. Each payment is initialised
// on PayRouta's account with the merchant's subaccount; PayRouta's fee is the
// flat `transaction_charge`, and the merchant bears Paystack's processing fee
// (`bearer: "subaccount"`). Paystack pays the merchant's share straight to the
// merchant's bank on its settlement schedule, so this rail cannot hold a
// rolling reserve: refunds or chargebacks after settlement fall on PayRouta's
// main balance. The live gate therefore only allows it for merchants
// underwritten without a reserve.
//
// Verified with injected transports only; run it against Paystack test mode
// before qualifying the sandbox platform account.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { fromMinorUnits, toMinorUnits } from "../../partners/money";
import type { PlatformAdapter, PlatformManifest, PlatformModule, RefundState } from "./contract";

// Countries where Paystack offers subaccounts, with the settlement currency.
const countryCurrency: Record<string, string> = {
  NG: "NGN",
  GH: "GHS",
  KE: "KES",
  ZA: "ZAR",
  CI: "XOF",
};

export const paystackSplitManifest: PlatformManifest = {
  id: "paystack-split",
  name: "Paystack",
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: true,
  feeCollection: "withheld",
  merchantCountries: Object.keys(countryCurrency),
  methods: ["card", "bank-transfer", "mobile-money", "ussd"],
  sharedFields: ["legalName", "tradingName", "productDescription", "country", "supportEmail", "representative"],
  paymentHosts: ["checkout.paystack.com"],
  documentation: "https://paystack.com/docs/payments/split-payments/",
};

const channels: Record<string, string> = {
  card: "card",
  "bank-transfer": "bank_transfer",
  "mobile-money": "mobile_money",
  ussd: "ussd",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.paystack.co").default("https://api.paystack.co"),
    secretKeyRef: z.string().max(100).optional(),
    // Paystack settles subaccounts on its own schedule (typically the next
    // business day); used to estimate availability until settlement reports
    // are reconciled.
    settlementDays: z.number().int().min(0).max(14).default(1),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const subaccountCode = /^ACCT_[A-Za-z0-9]{4,40}$/;

// Paystack references allow letters, digits, "-", "." and "=" only.
export const paystackReference = (attemptKey: string) => attemptKey.replace(/[^A-Za-z0-9.=-]/g, "-").slice(0, 100);

// The bank's registered account name must plausibly be the merchant's: at
// least two (or all, if fewer) of the holder name's words appear in it.
export function accountNameMatches(holder: string, resolved: string) {
  const words = (v: string) => v.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3);
  const expected = [...new Set(words(holder).filter((w) => !["LTD", "LIMITED", "PLC", "INC", "THE", "AND"].includes(w)))];
  const found = new Set(words(resolved));
  const hits = expected.filter((w) => found.has(w)).length;
  return expected.length > 0 && hits >= Math.min(2, expected.length);
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const c = configSchema.parse(raw);
  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const secret = c.secretKeyRef ? await deps.credentials.get(c.secretKeyRef) : "";
    if (!secret) throw new PortalError("PAYSTACK_CREDENTIALS_NOT_CONFIGURED", 409);
    if (!secret.startsWith(c.environment === "production" ? "sk_live_" : "sk_test_"))
      throw new PortalError("PAYSTACK_KEY_ENVIRONMENT_MISMATCH", 409);
    const response = await deps.http(c.baseUrl, {
      method,
      path,
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("PAYSTACK", response.status);
    const parsed = parseJson(response.body);
    if (parsed.status !== true) throw new PortalError("PAYSTACK_REQUEST_REJECTED", 422);
    return (parsed.data ?? {}) as Record<string, unknown>;
  }
  const code = (id: string) => {
    if (!subaccountCode.test(id)) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
    return id;
  };
  async function verify(reference: string) {
    if (!/^[A-Za-z0-9.=-]{1,100}$/.test(reference)) return null;
    return call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);
  }
  function belongsTo(t: Record<string, unknown>, providerAccountId: string) {
    const sub = (t.subaccount ?? {}) as { subaccount_code?: unknown };
    if (sub.subaccount_code !== code(providerAccountId))
      throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
  }
  return {
    async createAccount(input) {
      if (input.environment !== c.environment) throw new PortalError("PLATFORM_ENVIRONMENT_MISMATCH", 409);
      const bank = input.details.payoutAccount;
      const country = input.profile.country ?? "";
      if (countryCurrency[country] !== bank.currency || bank.country !== country || !bank.routingNumber)
        throw new PortalError("PAYOUT_ACCOUNT_NOT_SUPPORTED", 422);
      // Name enquiry: settlement may only go to an account in the merchant's name.
      const resolved = await call(
        "GET",
        `/bank/resolve?account_number=${encodeURIComponent(bank.accountNumber)}&bank_code=${encodeURIComponent(bank.routingNumber)}`,
      );
      if (typeof resolved.account_name !== "string" || !accountNameMatches(bank.holderName, resolved.account_name))
        throw new PortalError("PAYOUT_ACCOUNT_NAME_MISMATCH", 422);
      const rep = input.profile.representative;
      const sub = await call("POST", "/subaccount", {
        business_name: (input.profile.tradingName ?? input.profile.legalName ?? "").slice(0, 100),
        settlement_bank: bank.routingNumber,
        account_number: bank.accountNumber,
        // PayRouta's share is set per payment (transaction_charge), not as a
        // standing percentage.
        percentage_charge: 0,
        description: input.profile.productDescription?.slice(0, 200),
        primary_contact_email: input.profile.supportEmail,
        primary_contact_name: rep ? `${rep.givenName} ${rep.familyName}` : undefined,
        primary_contact_phone: input.details.businessPhone,
        metadata: { payrouta_link: input.linkId },
      });
      if (typeof sub.subaccount_code !== "string" || !subaccountCode.test(sub.subaccount_code))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        providerAccountId: sub.subaccount_code,
        // Paystack does not verify subaccounts: PayRouta's underwriting is
        // the check. An active subaccount can take payments and is settled.
        snapshot: {
          state: sub.active === false ? "Restricted" : "Approved",
          providerAccountId: sub.subaccount_code,
          requirementsDue: [],
          paymentsEnabled: sub.active !== false,
          payoutsEnabled: sub.active !== false,
        },
      };
    },
    async accountStatus(id) {
      const sub = await call("GET", `/subaccount/${code(id)}`);
      const active = sub.active !== false;
      return {
        state: active ? "Approved" : "Restricted",
        providerAccountId: id,
        requirementsDue: active ? [] : ["review"],
        paymentsEnabled: active,
        payoutsEnabled: active,
      };
    },
    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      const channel = channels[input.method];
      if (minor === null || !channel || input.feeMinor >= minor) return { state: "Rejected", reference: "" };
      if (!input.payerEmail || !z.email().safeParse(input.payerEmail).success)
        throw new PortalError("PROVIDER_CUSTOMER_DETAILS_REQUIRED", 409);
      const reference = paystackReference(input.attemptKey);
      const t = await call("POST", "/transaction/initialize", {
        email: input.payerEmail,
        amount: minor.toString(),
        currency: input.currency,
        reference,
        callback_url: input.returnUrl,
        channels: [channel],
        subaccount: code(input.providerAccountId),
        transaction_charge: Number(input.feeMinor),
        bearer: "subaccount",
        metadata: { payrouta_attempt: input.attemptKey, cancel_action: input.cancelUrl },
      });
      if (typeof t.authorization_url !== "string") throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        state: "Requires action",
        reference,
        actionUrl: assertPaymentHost(paystackSplitManifest.paymentHosts, t.authorization_url),
      };
    },
    async paymentStatus(input) {
      const t = await verify(input.reference);
      if (!t) return null;
      const currency = typeof t.currency === "string" ? t.currency : "";
      const amount = typeof t.amount === "number" ? fromMinorUnits(t.amount, currency) : null;
      if (!amount) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      if (t.status === "success") belongsTo(t, input.providerAccountId);
      const state =
        t.status === "success"
          ? "Confirmed"
          : ["failed", "abandoned", "reversed"].includes(String(t.status))
            ? "Rejected"
            : t.status === "ongoing" || t.status === "pending" || t.status === "processing" || t.status === "queued"
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },
    async verifyEvent({ rawBody, headers }) {
      const secret = c.secretKeyRef ? await deps.credentials.get(c.secretKeyRef) : "";
      const given = headers.get("x-paystack-signature") || "";
      if (!secret || !/^[a-f0-9]{128}$/.test(given)) return null;
      const expected = createHmac("sha512", secret).update(rawBody).digest();
      if (!timingSafeEqual(Buffer.from(given, "hex"), expected)) return null;
      const body = parseJson(rawBody);
      const type = typeof body.event === "string" ? body.event.slice(0, 100) : "";
      const data = (body.data ?? {}) as { id?: unknown; reference?: unknown };
      if (!type || (typeof data.id !== "number" && typeof data.reference !== "string")) return null;
      const kind = type === "charge.success" ? "payment" : type.startsWith("charge.dispute.") ? "dispute" : type.startsWith("refund.") ? "refund" : "other";
      return {
        eventId: `${type}:${String(data.id ?? data.reference)}`,
        type,
        kind,
        objectRef: kind === "payment" ? (typeof data.reference === "string" ? data.reference : undefined) : data.id !== undefined ? String(data.id) : undefined,
      };
    },
    // Split refunds reverse the split; once the subaccount was settled the
    // refund comes from PayRouta's balance (see refunds.ts).
    async createRefund(input) {
      const r = await call("POST", "/refund", {
        transaction: input.reference,
        amount: input.amountMinor.toString(),
        merchant_note: `PayRouta refund ${input.refundId}`.slice(0, 100),
      });
      const id = r.id ?? (r.transaction as { id?: unknown } | undefined)?.id;
      if (id === undefined) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { reference: String(id), ...paystackRefundState(r) };
    },
    async refundStatus(input) {
      if (!/^\d{1,20}$/.test(input.reference)) return null;
      return paystackRefundState(await call("GET", `/refund/${input.reference}`));
    },
    async disputeStatus(input) {
      if (!/^\d{1,20}$/.test(input.reference)) return null;
      const d = await call("GET", `/dispute/${input.reference}`);
      const t = (d.transaction ?? {}) as { reference?: unknown; amount?: unknown; currency?: unknown };
      const amount = typeof d.refund_amount === "number" && d.refund_amount > 0 ? d.refund_amount : t.amount;
      const currency = typeof d.currency === "string" ? d.currency : t.currency;
      if (typeof amount !== "number" || typeof currency !== "string") throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const resolved = d.status === "resolved";
      return {
        reference: input.reference,
        // "declined": the claim was refused and the merchant keeps the money.
        state: resolved ? (d.resolution === "declined" ? "Won" : "Lost") : "Open",
        amountMinor: BigInt(amount),
        currency,
        feeMinor: 0n,
        paymentReference: typeof t.reference === "string" ? t.reference : undefined,
        reason: typeof d.category === "string" ? d.category : undefined,
        evidenceDueBy: typeof d.dueAt === "string" ? new Date(d.dueAt) : undefined,
      };
    },
    async submitDisputeEvidence(input) {
      if (!/^\d{1,20}$/.test(input.reference)) throw new PortalError("DISPUTE_UNKNOWN", 404);
      const e = input.evidence;
      // Paystack requires the customer's contact details with the evidence.
      if (!e.customerName || !e.customerEmail || !e.customerPhone)
        throw new PortalError("EVIDENCE_CUSTOMER_DETAILS_REQUIRED", 422);
      await call("POST", `/dispute/${input.reference}/evidence`, {
        customer_email: e.customerEmail,
        customer_name: e.customerName,
        customer_phone: e.customerPhone,
        service_details: [e.productDescription, e.explanation].filter(Boolean).join("\n\n").slice(0, 2000),
        delivery_address: e.deliveryAddress,
        delivery_date: e.shippingDate ?? e.serviceDate,
      });
    },
    async fundsAvailability(input) {
      const t = await verify(input.reference);
      if (!t || t.status !== "success") return null;
      belongsTo(t, input.providerAccountId);
      const split = (t.fees_split ?? {}) as { subaccount?: unknown };
      const paidAt = typeof t.paid_at === "string" ? new Date(t.paid_at) : null;
      if (typeof split.subaccount !== "number" || !paidAt || Number.isNaN(paidAt.getTime()))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        paymentRef: typeof t.id === "number" ? String(t.id) : input.reference,
        netMinor: BigInt(split.subaccount),
        availableAt: new Date(paidAt.getTime() + c.settlementDays * 86400000),
      };
    },
  };
}

export function paystackRefundState(r: Record<string, unknown>): { state: RefundState; failureCode?: string } {
  if (r.status === "processed") return { state: "Succeeded" };
  if (r.status === "failed") return { state: "Failed", failureCode: "paystack-refund-failed" };
  return { state: "Pending" };
}

export const paystackSplitPlatform: PlatformModule = {
  manifest: paystackSplitManifest,
  configSchema,
  create,
};
