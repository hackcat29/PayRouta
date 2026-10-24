// Yellow Card licensed pan-African stablecoin-to-fiat settlement module
// (split settlement). Merchants without a Web3 wallet apply once to PayRouta;
// PayRouta verifies the merchant's local bank account via Yellow Card's bank
// resolver (/business/details/bank) and provisions a subaccount by API
// (/business/subaccounts). Each collection converts via Yellow Card's
// USDC/USDT liquidity rail and settles local currency directly to the
// merchant's bank account while withholding PayRouta's fee (`feeAmount`).
//
// Verified with injected transports; run against Yellow Card sandbox before
// qualifying the sandbox platform account.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
  ZA: "ZAR",
  UG: "UGX",
  TZ: "TZS",
  RW: "RWF",
  ZM: "ZMW",
  CM: "XAF",
  CI: "XOF",
  SN: "XOF",
};

export const yellowcardSplitManifest: PlatformManifest = {
  id: "yellowcard-split",
  name: "Yellow Card",
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: true,
  feeCollection: "withheld",
  merchantCountries: Object.keys(countryCurrency),
  methods: ["bank-transfer", "mobile-money"],
  sharedFields: ["legalName", "tradingName", "country", "registrationNumber", "supportEmail", "representative"],
  paymentHosts: ["widget.yellowcard.io", "sandbox.widget.yellowcard.io"],
  documentation: "https://docs.yellowcard.io/docs/collections-api",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    apiKeyRef: z.string().max(100).optional(),
    secretKeyRef: z.string().max(100).optional(),
    settlementDays: z.number().int().min(0).max(14).default(1),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const subaccountCode = /^yc_sub_[A-Za-z0-9_-]{4,60}$/;
export const yellowcardReference = (attemptKey: string) => attemptKey.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80);

export function yellowcardSignature(
  secretKey: string,
  timestamp: string,
  path: string,
  method: string,
  body?: string,
) {
  const bodyHash = body ? createHash("sha256").update(body).digest("base64") : "";
  return createHmac("sha256", secretKey)
    .update(`${timestamp}${path}${method.toUpperCase()}${bodyHash}`)
    .digest("base64");
}

function majorToMinor(value: unknown, currency: string) {
  const exp = currencyExponent(currency);
  const num = typeof value === "string" ? Number(value) : value;
  if (typeof num !== "number" || !Number.isFinite(num) || num < 0 || exp === null) return null;
  return BigInt(Math.round(num * 10 ** exp));
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const c = configSchema.parse(raw);
  const baseUrl = c.environment === "production" ? "https://api.yellowcard.io" : "https://sandbox.api.yellowcard.io";
  const expectedHost = c.environment === "production" ? "widget.yellowcard.io" : "sandbox.widget.yellowcard.io";
  const now = () => (deps.now ? deps.now() : new Date());

  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const [apiKey, secretKey] = await Promise.all([
      c.apiKeyRef ? deps.credentials.get(c.apiKeyRef) : Promise.resolve(undefined),
      c.secretKeyRef ? deps.credentials.get(c.secretKeyRef) : Promise.resolve(undefined),
    ]);
    if (!apiKey || !secretKey) throw new PortalError("YELLOWCARD_CREDENTIALS_NOT_CONFIGURED", 409);
    const expectedPrefix = c.environment === "production" ? "yc_live_" : "yc_test_";
    if (!apiKey.startsWith(expectedPrefix)) throw new PortalError("YELLOWCARD_KEY_ENVIRONMENT_MISMATCH", 409);
    const rawBody = body ? JSON.stringify(body) : undefined;
    const timestamp = now().toISOString();
    const signature = yellowcardSignature(secretKey, timestamp, path, method, rawBody);
    const response = await deps.http(baseUrl, {
      method,
      path,
      headers: {
        "X-YC-Timestamp": timestamp,
        Authorization: `YcHmacV1 ${apiKey}:${signature}`,
        ...(rawBody ? { "Content-Type": "application/json" } : {}),
      },
      body: rawBody,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("YELLOWCARD", response.status);
    return parseJson(response.body);
  }

  const sub = (id: string) => {
    if (!subaccountCode.test(id)) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
    return id;
  };

  function belongsTo(t: Record<string, unknown>, providerAccountId: string) {
    const expected = sub(providerAccountId);
    if (t.subaccountId !== expected) throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
  }

  return {
    async createAccount(input) {
      if (input.environment !== c.environment) throw new PortalError("PLATFORM_ENVIRONMENT_MISMATCH", 409);
      const bank = input.details.payoutAccount;
      const country = input.profile.country ?? "";
      if (countryCurrency[country] !== bank.currency || bank.country !== country || !bank.routingNumber)
        throw new PortalError("PAYOUT_ACCOUNT_NOT_SUPPORTED", 422);
      const resolved = await call("POST", "/business/details/bank", {
        accountNumber: bank.accountNumber,
        networkId: bank.routingNumber,
        country,
      });
      if (typeof resolved.accountName !== "string" || !accountNameMatches(bank.holderName, resolved.accountName))
        throw new PortalError("PAYOUT_ACCOUNT_NAME_MISMATCH", 422);
      const rep = input.profile.representative;
      const created = await call("POST", "/business/subaccounts", {
        businessName: (input.profile.tradingName ?? input.profile.legalName ?? "").slice(0, 100),
        legalName: input.profile.legalName,
        country,
        registrationNumber: input.profile.registrationNumber,
        email: input.profile.supportEmail,
        contactName: rep ? `${rep.givenName} ${rep.familyName}` : undefined,
        payoutAccount: {
          accountNumber: bank.accountNumber,
          networkId: bank.routingNumber,
          accountName: resolved.accountName,
          currency: bank.currency,
        },
        settlementAsset: "USDC",
        externalId: input.linkId,
      });
      if (typeof created.id !== "string" || !subaccountCode.test(created.id))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const active = created.status !== "restricted" && created.status !== "suspended";
      return {
        providerAccountId: created.id,
        snapshot: {
          state: active ? "Approved" : "Restricted",
          providerAccountId: created.id,
          requirementsDue: active ? [] : ["review"],
          paymentsEnabled: active,
          payoutsEnabled: active,
        },
      };
    },
    async accountStatus(id) {
      const code = sub(id);
      const res = await call("GET", `/business/subaccounts/${encodeURIComponent(code)}`);
      const active = res.status !== "restricted" && res.status !== "suspended";
      return {
        state: active ? "Approved" : "Restricted",
        providerAccountId: code,
        requirementsDue: active ? [] : ["review"],
        paymentsEnabled: active,
        payoutsEnabled: active,
      };
    },
    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      const channelType =
        input.method === "bank-transfer" ? "bank" : input.method === "mobile-money" ? "momo" : undefined;
      if (minor === null || !channelType || input.feeMinor >= minor) return { state: "Rejected", reference: "" };
      const reference = yellowcardReference(input.attemptKey);
      const t = await call("POST", "/business/collections", {
        subaccountId: sub(input.providerAccountId),
        sequenceId: reference,
        amount: Number(input.amount),
        currency: input.currency,
        country: input.payerCountry ?? input.merchantCountry,
        channelType,
        feeAmount: Number(fromMinorUnits(input.feeMinor, input.currency)),
        settlementAsset: "USDC",
        redirectUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
      });
      if (typeof t.checkoutUrl !== "string") throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const checked = assertPaymentHost([expectedHost], t.checkoutUrl);
      return {
        state: "Requires action",
        reference,
        actionUrl: assertPaymentHost(yellowcardSplitManifest.paymentHosts, checked),
      };
    },
    async paymentStatus(input) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.reference)) return null;
      const t = await call("GET", `/business/collections/reference/${encodeURIComponent(input.reference)}`);
      const currency = typeof t.currency === "string" ? t.currency : "";
      const minor = majorToMinor(t.amount, currency);
      const amount = minor === null ? null : fromMinorUnits(minor, currency);
      if (!amount) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const status = String(t.status ?? "").toLowerCase();
      if (status === "complete" || status === "settled") belongsTo(t, input.providerAccountId);
      const state =
        status === "complete" || status === "settled"
          ? "Confirmed"
          : ["failed", "expired", "cancelled", "rejected"].includes(status)
            ? "Rejected"
            : ["processing", "converting", "pending_approval"].includes(status)
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },
    async verifyEvent({ rawBody, headers }) {
      const secret = c.secretKeyRef ? await deps.credentials.get(c.secretKeyRef) : "";
      const given = headers.get("x-yc-signature") || "";
      if (!secret || !given) return null;
      const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
      const givenBuf = Buffer.from(given);
      const expectedBuf = Buffer.from(expected);
      if (givenBuf.length !== expectedBuf.length || !timingSafeEqual(givenBuf, expectedBuf)) return null;
      const body = parseJson(rawBody);
      const event = typeof body.event === "string" ? body.event.slice(0, 100) : "";
      const id = typeof body.id === "string" ? body.id : "";
      const seq = typeof body.sequenceId === "string" ? body.sequenceId : undefined;
      if (!event || !id) return null;
      const kind =
        event === "collection.complete" || event === "collection.settled"
          ? "payment"
          : event.startsWith("refund.")
            ? "refund"
            : "other";
      return {
        eventId: `${event}:${id}`,
        type: event,
        kind,
        objectRef: kind === "payment" ? seq ?? id : id,
      };
    },
    async createRefund(input) {
      sub(input.providerAccountId);
      const r = await call("POST", "/business/refunds", {
        sequenceId: input.reference,
        refundId: input.refundId,
        amount: Number(fromMinorUnits(input.amountMinor, input.currency)),
        currency: input.currency,
        reason: `PayRouta refund ${input.refundId}`.slice(0, 100),
      });
      if (typeof r.id !== "string" || !r.id) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { reference: r.id, ...yellowcardRefundState(r) };
    },
    async refundStatus(input) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.reference)) return null;
      return yellowcardRefundState(await call("GET", `/business/refunds/${encodeURIComponent(input.reference)}`));
    },
    async fundsAvailability(input) {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(input.reference)) return null;
      const t = await call("GET", `/business/collections/reference/${encodeURIComponent(input.reference)}`);
      const status = String(t.status ?? "").toLowerCase();
      if (status !== "complete" && status !== "settled") return null;
      belongsTo(t, input.providerAccountId);
      const currency = typeof t.currency === "string" ? t.currency : "";
      const gross = majorToMinor(t.amount, currency);
      const serviceFee = majorToMinor(t.serviceFeeAmount ?? 0, currency);
      const updated = typeof t.updatedAt === "string" ? new Date(t.updatedAt) : null;
      if (gross === null || serviceFee === null || !updated || Number.isNaN(updated.getTime()))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        paymentRef: typeof t.id === "string" ? t.id : input.reference,
        netMinor: gross - input.feeMinor - serviceFee,
        availableAt: new Date(updated.getTime() + c.settlementDays * 86400000),
      };
    },
  };
}

export function yellowcardRefundState(r: Record<string, unknown>): { state: RefundState; failureCode?: string } {
  const s = String(r.status ?? "").toLowerCase();
  if (s === "complete" || s === "succeeded") return { state: "Succeeded" };
  if (s === "failed" || s === "rejected") return { state: "Failed", failureCode: "yellowcard-refund-failed" };
  return { state: "Pending" };
}

export const yellowcardSplitPlatform: PlatformModule = {
  manifest: yellowcardSplitManifest,
  configSchema,
  create,
};
