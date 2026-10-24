// Monnify subaccounts on PayRouta's Monnify account (split settlement).
// Merchants never see Monnify: PayRouta verifies the Nigerian payout bank
// account via NIBSS name enquiry (/api/v1/disbursements/account/validate) and
// creates the subaccount by API (/api/v1/sub-accounts). Each payment is
// initialised on PayRouta's contract with an `incomeSplitConfig` entry routing
// `amount - feeMinor` to the merchant's subaccount while the subaccount bears
// Monnify's processing fee (`feeBearer: true, feePercentage: 100`). Monnify
// settles the subaccount directly to the merchant's bank account via NIBSS, so
// this rail cannot hold a rolling reserve (see paystack-split.ts).
//
// Verified with injected transports only; run it against Monnify sandbox
// before qualifying the sandbox platform account.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "../../partners/money";
import type { PlatformAdapter, PlatformManifest, PlatformModule, RefundState } from "./contract";
import { accountNameMatches } from "./paystack-split";

export const monnifySplitManifest: PlatformManifest = {
  id: "monnify-split",
  name: "Monnify",
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: true,
  feeCollection: "withheld",
  merchantCountries: ["NG"],
  methods: ["card", "bank-transfer", "ussd"],
  sharedFields: ["legalName", "tradingName", "productDescription", "country", "supportEmail", "representative"],
  paymentHosts: ["sdk.monnify.com", "sandbox.sdk.monnify.com"],
  documentation: "https://docs.monnify.com/docs/collections/splitting-payments",
};

const channels: Record<string, string> = {
  card: "CARD",
  "bank-transfer": "ACCOUNT_TRANSFER",
  ussd: "USSD",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    apiKeyRef: z.string().max(100).optional(),
    secretKeyRef: z.string().max(100).optional(),
    contractCode: z.string().regex(/^[0-9A-Za-z_-]{4,40}$/).optional(),
    settlementDays: z.number().int().min(0).max(14).default(1),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const subaccountCode = /^MFY_SUB_[A-Za-z0-9_-]{4,40}$/;

export const monnifyReference = (attemptKey: string) => attemptKey.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 100);

function majorToMinor(value: unknown, currency: string) {
  const exp = currencyExponent(currency);
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || num < 0 || exp === null) return null;
  return BigInt(Math.round(num * 10 ** exp));
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const c = configSchema.parse(raw);
  const baseUrl = c.environment === "production" ? "https://api.monnify.com" : "https://sandbox.monnify.com";
  const expectedHost = c.environment === "production" ? "sdk.monnify.com" : "sandbox.sdk.monnify.com";

  async function credentials() {
    const [apiKey, secretKey] = await Promise.all([
      c.apiKeyRef ? deps.credentials.get(c.apiKeyRef) : Promise.resolve(undefined),
      c.secretKeyRef ? deps.credentials.get(c.secretKeyRef) : Promise.resolve(undefined),
    ]);
    if (!apiKey || !secretKey) throw new PortalError("MONNIFY_CREDENTIALS_NOT_CONFIGURED", 409);
    const expectedPrefix = c.environment === "production" ? "MK_PROD_" : "MK_TEST_";
    if (!apiKey.startsWith(expectedPrefix)) throw new PortalError("MONNIFY_KEY_ENVIRONMENT_MISMATCH", 409);
    return { apiKey, secretKey };
  }

  async function accessToken() {
    const { apiKey, secretKey } = await credentials();
    const basic = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
    const response = await deps.http(baseUrl, {
      method: "POST",
      path: "/api/v1/auth/login",
      headers: { Authorization: `Basic ${basic}` },
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("MONNIFY", response.status);
    const parsed = parseJson(response.body);
    const body = (parsed.responseBody ?? {}) as { accessToken?: unknown };
    if (parsed.requestSuccessful !== true || typeof body.accessToken !== "string" || !body.accessToken)
      throw new PortalError("MONNIFY_AUTH_FAILED", 502);
    return body.accessToken;
  }

  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    const token = await accessToken();
    const response = await deps.http(baseUrl, {
      method,
      path,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("MONNIFY", response.status);
    const parsed = parseJson(response.body);
    if (parsed.requestSuccessful !== true) throw new PortalError("MONNIFY_REQUEST_REJECTED", 422);
    return parsed.responseBody ?? {};
  }

  const sub = (id: string) => {
    if (!subaccountCode.test(id)) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
    return id;
  };

  async function verify(reference: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(reference)) return null;
    const res = await call(
      "GET",
      `/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`,
    );
    return (res ?? {}) as Record<string, unknown>;
  }

  function belongsTo(t: Record<string, unknown>, providerAccountId: string) {
    const expected = sub(providerAccountId);
    const meta = (t.metaData ?? t.metadata ?? {}) as { payrouta_subaccount?: unknown };
    if (meta.payrouta_subaccount !== undefined && meta.payrouta_subaccount !== expected)
      throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
    const splits = Array.isArray(t.incomeSplitConfig) ? (t.incomeSplitConfig as Array<{ subAccountCode?: unknown }>) : null;
    if (splits && splits.length > 0 && !splits.some((s) => s.subAccountCode === expected))
      throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
  }

  return {
    async createAccount(input) {
      if (input.environment !== c.environment) throw new PortalError("PLATFORM_ENVIRONMENT_MISMATCH", 409);
      const bank = input.details.payoutAccount;
      const country = input.profile.country ?? "";
      if (country !== "NG" || bank.country !== "NG" || bank.currency !== "NGN" || !bank.routingNumber)
        throw new PortalError("PAYOUT_ACCOUNT_NOT_SUPPORTED", 422);
      const resolved = (await call(
        "GET",
        `/api/v2/disbursements/account/validate?accountNumber=${encodeURIComponent(bank.accountNumber)}&bankCode=${encodeURIComponent(bank.routingNumber)}`,
      )) as { accountName?: unknown };
      if (typeof resolved.accountName !== "string" || !accountNameMatches(bank.holderName, resolved.accountName))
        throw new PortalError("PAYOUT_ACCOUNT_NAME_MISMATCH", 422);
      let first: { subAccountCode?: unknown } | undefined;
      try {
        const created = await call("POST", "/api/v1/sub-accounts", [
          {
            currencyCode: "NGN",
            bankCode: bank.routingNumber,
            accountNumber: bank.accountNumber,
            email: input.profile.supportEmail,
            defaultSplitPercentage: 99,
          },
        ]);
        first = (Array.isArray(created) ? created[0] : created) as { subAccountCode?: unknown } | undefined;
      } catch (error) {
        if (!(error instanceof PortalError) || error.status !== 422) throw error;
        const list = await call("GET", "/api/v1/sub-accounts");
        first = Array.isArray(list)
          ? (list.find(
              (item) =>
                (item as { accountNumber?: unknown; bankCode?: unknown }).accountNumber === bank.accountNumber &&
                (item as { bankCode?: unknown }).bankCode === bank.routingNumber,
            ) as { subAccountCode?: unknown } | undefined)
          : undefined;
        if (!first) throw error;
      }
      if (!first || typeof first.subAccountCode !== "string" || !subaccountCode.test(first.subAccountCode))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        providerAccountId: first.subAccountCode,
        snapshot: {
          state: "Approved",
          providerAccountId: first.subAccountCode,
          requirementsDue: [],
          paymentsEnabled: true,
          payoutsEnabled: true,
        },
      };
    },
    async accountStatus(id) {
      const code = sub(id);
      const list = await call("GET", "/api/v1/sub-accounts");
      const active =
        Array.isArray(list) &&
        list.some((item) => (item as { subAccountCode?: unknown }).subAccountCode === code);
      return {
        state: active ? "Approved" : "Restricted",
        providerAccountId: code,
        requirementsDue: active ? [] : ["review"],
        paymentsEnabled: active,
        payoutsEnabled: active,
      };
    },
    async createPayment(input) {
      if (!c.contractCode) throw new PortalError("MONNIFY_CONTRACT_CODE_NOT_CONFIGURED", 409);
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      const channel = channels[input.method];
      if (input.currency !== "NGN" || minor === null || !channel || input.feeMinor >= minor)
        return { state: "Rejected", reference: "" };
      if (!input.payerEmail || !z.email().safeParse(input.payerEmail).success)
        throw new PortalError("PROVIDER_CUSTOMER_DETAILS_REQUIRED", 409);
      const reference = monnifyReference(input.attemptKey);
      const merchantShare = Number(fromMinorUnits(minor - input.feeMinor, input.currency));
      const t = (await call("POST", "/api/v1/merchant/transactions/init-transaction", {
        amount: Number(input.amount),
        customerName: input.payerEmail.split("@")[0].slice(0, 100) || "Customer",
        customerEmail: input.payerEmail,
        paymentReference: reference,
        paymentDescription: `Payment ${input.reference}`.slice(0, 100),
        currencyCode: input.currency,
        contractCode: c.contractCode,
        redirectUrl: input.returnUrl,
        paymentMethods: [channel],
        incomeSplitConfig: [
          {
            subAccountCode: sub(input.providerAccountId),
            splitAmount: merchantShare,
            feePercentage: 100,
            feeBearer: true,
          },
        ],
        metadata: {
          payrouta_attempt: input.attemptKey,
          payrouta_subaccount: input.providerAccountId,
          cancel_action: input.cancelUrl,
        },
      })) as { checkoutUrl?: unknown };
      if (typeof t.checkoutUrl !== "string") throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const actionUrl = assertPaymentHost([expectedHost], t.checkoutUrl);
      return {
        state: "Requires action",
        reference,
        actionUrl: assertPaymentHost(monnifySplitManifest.paymentHosts, actionUrl),
      };
    },
    async paymentStatus(input) {
      const t = await verify(input.reference);
      if (!t) return null;
      const currency =
        typeof t.currency === "string" ? t.currency : typeof t.currencyCode === "string" ? t.currencyCode : "";
      const minor = majorToMinor(t.amountPaid ?? t.totalPayable ?? t.amount, currency);
      const amount = minor === null ? null : fromMinorUnits(minor, currency);
      if (!amount) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const status = String(t.paymentStatus ?? "");
      if (status === "PAID") belongsTo(t, input.providerAccountId);
      const state =
        status === "PAID"
          ? "Confirmed"
          : ["FAILED", "CANCELLED", "EXPIRED"].includes(status)
            ? "Rejected"
            : ["PENDING", "OVERPAID", "PARTIALLY_PAID"].includes(status)
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },
    async verifyEvent({ rawBody, headers }) {
      const secret = c.secretKeyRef ? await deps.credentials.get(c.secretKeyRef) : "";
      const given = (headers.get("monnify-signature") || "").toLowerCase();
      if (!secret || !/^[a-f0-9]{128}$/.test(given)) return null;
      const expected = createHmac("sha512", secret).update(rawBody).digest();
      if (!timingSafeEqual(Buffer.from(given, "hex"), expected)) return null;
      const body = parseJson(rawBody);
      const type = typeof body.eventType === "string" ? body.eventType.slice(0, 100) : "";
      const data = (body.eventData ?? {}) as {
        transactionReference?: unknown;
        paymentReference?: unknown;
        refundReference?: unknown;
      };
      const id = data.transactionReference ?? data.refundReference ?? data.paymentReference;
      if (!type || typeof id !== "string" || !id) return null;
      const kind =
        type === "SUCCESSFUL_TRANSACTION"
          ? "payment"
          : type === "SUCCESSFUL_REFUND" || type === "FAILED_REFUND"
            ? "refund"
            : "other";
      const objectRef =
        kind === "payment"
          ? typeof data.paymentReference === "string"
            ? data.paymentReference
            : undefined
          : kind === "refund"
            ? typeof data.refundReference === "string"
              ? data.refundReference
              : undefined
            : undefined;
      return {
        eventId: `${type}:${id}`,
        type,
        kind,
        objectRef,
      };
    },
    async createRefund(input) {
      let txRef =
        input.paymentRef && /^[A-Za-z0-9_|=-]{1,100}$/.test(input.paymentRef) ? input.paymentRef : undefined;
      if (!txRef) {
        const t = await verify(input.reference);
        if (typeof t?.transactionReference !== "string" || !t.transactionReference)
          throw new PortalError("REFUND_PAYMENT_NOT_FOUND", 422);
        txRef = t.transactionReference;
      }
      const refundReference = monnifyReference(input.refundId).slice(0, 64);
      const r = (await call("POST", "/api/v1/refunds/initiate-refund", {
        transactionReference: txRef,
        refundReference,
        refundAmount: Number(fromMinorUnits(input.amountMinor, input.currency)),
        refundReason: `PayRouta refund ${input.refundId}`.slice(0, 64),
        customerNote: "PayRouta refund",
      })) as Record<string, unknown>;
      const ref = typeof r.refundReference === "string" && r.refundReference ? r.refundReference : refundReference;
      return { reference: ref, ...monnifyRefundState(r) };
    },
    async refundStatus(input) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(input.reference)) return null;
      const r = (await call(
        "GET",
        `/api/v1/refunds/${encodeURIComponent(input.reference)}`,
      )) as Record<string, unknown>;
      return monnifyRefundState(r);
    },
    async fundsAvailability(input) {
      const t = await verify(input.reference);
      if (!t || t.paymentStatus !== "PAID") return null;
      belongsTo(t, input.providerAccountId);
      const currency =
        typeof t.currency === "string" ? t.currency : typeof t.currencyCode === "string" ? t.currencyCode : "";
      const gross = majorToMinor(t.amountPaid ?? t.totalPayable ?? t.amount, currency);
      const fee = majorToMinor(t.fee ?? 0, currency);
      const paidOn = typeof t.paidOn === "string" ? new Date(t.paidOn) : null;
      if (gross === null || fee === null || !paidOn || Number.isNaN(paidOn.getTime()))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        paymentRef: typeof t.transactionReference === "string" ? t.transactionReference : input.reference,
        netMinor: gross - input.feeMinor - fee,
        availableAt: new Date(paidOn.getTime() + c.settlementDays * 86400000),
      };
    },
  };
}

export function monnifyRefundState(r: Record<string, unknown>): { state: RefundState; failureCode?: string } {
  const status = String(r.refundStatus ?? r.status ?? "").toUpperCase();
  if (status === "COMPLETED" || status === "SUCCESSFUL") return { state: "Succeeded" };
  if (status === "FAILED" || status === "REJECTED") return { state: "Failed", failureCode: "monnify-refund-failed" };
  return { state: "Pending" };
}

export const monnifySplitPlatform: PlatformModule = {
  manifest: monnifySplitManifest,
  configSchema,
  create,
};
