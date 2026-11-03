// dLocal for Platforms on PayRouta's dLocal platform account. Merchants never
// see dLocal: PayRouta creates each merchant's User account by API from the
// details it collected, with the consents the merchant gave by accepting
// PayRouta's terms (which must incorporate dLocal's). Payments use the
// Payins API with a split: the merchant's share goes to its User account and
// PayRouta's fee stays with the platform. Funds stay in the User account
// until PayRouta requests a settlement (Payouts API), so this rail holds
// funds like a connected-account platform. Processing fees are configured with dLocal as
// liable-account fees (PayRouta pays them), so the merchant's share is exact.
//
// Sources: docs.dlocal.com Platforms API (accounts, split payments) and Payins
// security. Platform credentials come from dLocal's technical account manager.
// Verified with injected transports only; run it against dLocal's sandbox
// before qualifying the sandbox platform account.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps, StatusSnapshot } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "../../partners/money";
import type { VerificationDetails } from "../verification";
import type { PlatformAdapter, PlatformManifest, PlatformModule, RefundState } from "./contract";

export const dlocalManifest: PlatformManifest = {
  id: "dlocal",
  name: "dLocal",
  custody: "partner-held",
  holdsFunds: true,
  merchantBearsProcessingFee: false,
  feeCollection: "withheld",
  merchantCountries: null,
  methods: ["card", "bank-transfer", "digital-wallet"],
  sharedFields: [
    "legalName",
    "tradingName",
    "businessType",
    "country",
    "registrationNumber",
    "taxId",
    "website",
    "supportEmail",
    "address",
    "representative",
    "owners",
  ],
  paymentHosts: [],
  documentation: "https://docs.dlocal.com/docs/platforms-overview",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    // Name dLocal assigns to PayRouta's platform (platform_type).
    platformType: z.string().regex(/^[A-Z0-9_]{2,60}$/),
    loginRef: z.string().max(100).optional(),
    transKeyRef: z.string().max(100).optional(),
    secretKeyRef: z.string().max(100).optional(),
    // Days funds stay in transit in the User account (account setting).
    settlementPeriod: z.number().int().min(0).max(60).default(7),
    // Hosts dLocal's REDIRECT flow may send customers to, taken from the
    // sandbox: unknown until observed, so payments fail closed until set.
    redirectHosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).default([]),
    notificationUrl: z.url().optional(),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const hosts = {
  sandbox: { accounts: "https://marketplace-api.dlocal-sbox.com", payins: "https://sandbox.dlocal.com" },
  production: { accounts: "https://marketplace-api.dlocal.com", payins: "https://api.dlocal.com" },
};

// V2-HMAC-SHA256: hmac(secretKey, X-Login + X-Date + body), hex.
export function dlocalSignature(secret: string, login: string, date: string, body: string) {
  return createHmac("sha256", secret).update(`${login}${date}${body}`).digest("hex");
}

const accountId = /^[A-Za-z0-9-]{8,64}$/;
const iso = (date: string) => `${date}T00:00:00.000Z`;
const major = (minor: bigint, currency: string) => Number(fromMinorUnits(minor, currency));

function person(p: VerificationDetails["representative"], name: string) {
  return {
    tax_id: p.idType === "tax-id" ? p.idNumber : undefined,
    document_type: p.idType === "tax-id" ? undefined : p.idType?.toUpperCase().replace(/-/g, "_"),
    document_number: p.idType === "tax-id" ? undefined : p.idNumber,
    name,
    nationality: p.nationality,
    date_of_birth: iso(p.dateOfBirth),
    phone: p.phone,
    email: p.email,
    country: p.address.country,
    city: p.address.city,
    zip_code: p.address.postalCode,
    address: [p.address.line1, p.address.line2].filter(Boolean).join(", "),
    is_pep: p.politicallyExposed,
  };
}

// dLocal statuses → PayRouta's snapshot, in PayRouta's own requirement codes.
export function dlocalSnapshot(a: Record<string, unknown>): StatusSnapshot {
  const id = typeof a.account_id === "string" ? a.account_id : undefined;
  const caps = Array.isArray(a.capabilities) ? (a.capabilities as { capability_name?: string; capability_status?: string }[]) : [];
  const enabled = (name: string) => caps.some((c) => c.capability_name === name && c.capability_status === "ENABLED");
  const detail = String(a.status_detail ?? "");
  const base = { providerAccountId: id, paymentsEnabled: false, payoutsEnabled: false, requirementsDue: [] as string[] };
  switch (a.status) {
    case "APPROVED": {
      const due = detail === "pending_documentation" ? ["business-document"] : [];
      const payments = enabled("PAYINS");
      return {
        ...base,
        state: payments && !due.length ? "Approved" : "Restricted",
        requirementsDue: due,
        paymentsEnabled: payments,
        payoutsEnabled: enabled("PAYOUTS"),
      };
    }
    case "PENDING":
      return detail === "documentation"
        ? { ...base, state: "Action required", requirementsDue: ["business-document"] }
        : { ...base, state: "Under review" };
    case "BLOCKED":
      return { ...base, state: "Restricted", requirementsDue: ["review"], reason: detail.slice(0, 200) || undefined };
    case "REJECTED":
    case "CANCELED":
      return { ...base, state: "Rejected", reason: detail.slice(0, 200) || undefined };
    default:
      return { ...base, state: "Pending provider" };
  }
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const c = configSchema.parse(raw);
  const now = () => deps.now?.() ?? new Date();
  async function call(api: "accounts" | "payins", method: "GET" | "POST", path: string, payload?: unknown) {
    const [login, transKey, secret] = await Promise.all(
      [c.loginRef, c.transKeyRef, c.secretKeyRef].map((ref) => (ref ? deps.credentials.get(ref) : Promise.resolve(""))),
    );
    if (!login || !transKey || !secret) throw new PortalError("DLOCAL_CREDENTIALS_NOT_CONFIGURED", 409);
    const date = now().toISOString();
    const body = payload ? JSON.stringify(payload) : "";
    const response = await deps.http(hosts[c.environment][api], {
      method,
      path,
      headers: {
        "X-Date": date,
        "X-Login": login,
        "X-Trans-Key": transKey,
        "X-Version": "2.1",
        "User-Agent": "PayRouta/1.0",
        "Content-Type": "application/json",
        Authorization: `V2-HMAC-SHA256, Signature: ${dlocalSignature(secret, login, date, body)}`,
      },
      body: body || undefined,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("DLOCAL", response.status);
    return parseJson(response.body);
  }
  const account = (id: string) => {
    if (!accountId.test(id)) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
    return id;
  };
  async function payment(reference: string) {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(reference)) return null;
    return call("payins", "GET", `/payments/${reference}`);
  }
  return {
    async createAccount(input) {
      if (input.environment !== c.environment) throw new PortalError("PLATFORM_ENVIRONMENT_MISMATCH", 409);
      const p = input.profile;
      const d = input.details;
      const rep = p.representative!;
      const repName = `${rep.givenName} ${rep.familyName}`;
      const individual = p.businessType === "sole-proprietor";
      // The merchant accepted these by accepting PayRouta's terms.
      const consents = ["DATA_COLLECTION", "TERMS_AND_CONDITIONS", ...(individual ? [] : ["CONTRACTUAL_EFFECTS", "DECLARATION_OF_FUNDS"])].map(
        (type) => ({ type, name: repName, accepted: true }),
      );
      const a = await call("accounts", "POST", "/v2/accounts", {
        platform_type: c.platformType,
        tax_category: individual ? "individual" : "company",
        account_name: p.tradingName ?? p.legalName,
        account_email: p.supportEmail,
        account_country: p.country,
        account_external_reference: input.linkId,
        notification_url: c.notificationUrl,
        consents,
        company_information: {
          tax_id: p.taxId ?? p.registrationNumber,
          website: p.website,
          registered_name: p.legalName,
          date_of_incoporation: d.incorporationDate ? iso(d.incorporationDate) : undefined,
          email: p.supportEmail,
          annual_sales_in_usd: d.annualSalesUsd,
          phone: d.businessPhone,
          legal_address: p.address && {
            country: p.address.country,
            city: p.address.city,
            zip_code: p.address.postalCode,
            address: [p.address.line1, p.address.line2].filter(Boolean).join(", "),
          },
          ...(individual
            ? { is_pep: d.representative.politicallyExposed }
            : {
                legal_representative: person({ ...d.representative, email: d.representative.email ?? rep.email }, repName),
                ubos: (p.owners ?? []).map((o, i) => ({
                  ...person(d.owners[i], `${o.givenName} ${o.familyName}`),
                  ownership_percentage: o.ownershipPercent,
                })),
              }),
        },
        settings: { settlement_period: c.settlementPeriod },
      });
      if (typeof a.account_id !== "string" || !accountId.test(a.account_id))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { providerAccountId: a.account_id, snapshot: dlocalSnapshot(a) };
    },
    async accountStatus(id) {
      return dlocalSnapshot(await call("accounts", "GET", `/v2/accounts/${account(id)}`));
    },
    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      const country = input.payerCountry ?? input.merchantCountry;
      if (minor === null || input.feeMinor >= minor || !country || !dlocalManifest.methods.includes(input.method))
        return { state: "Rejected", reference: "" };
      const p = await call("payins", "POST", "/payments", {
        amount: Number(input.amount),
        currency: input.currency,
        country,
        payment_method_flow: "REDIRECT",
        payer: input.payerEmail ? { email: input.payerEmail } : undefined,
        order_id: input.attemptKey.slice(0, 100),
        description: `Payment ${input.reference}`.slice(0, 100),
        callback_url: input.returnUrl,
        notification_url: c.notificationUrl,
        // The merchant's share to its User account; PayRouta's fee is the
        // remainder kept by the platform.
        splits: [{ account_id: account(input.providerAccountId), amount: major(minor - input.feeMinor, input.currency) }],
      });
      if (typeof p.id !== "string" || typeof p.redirect_url !== "string")
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return {
        state: "Requires action",
        reference: p.id,
        actionUrl: assertPaymentHost(c.redirectHosts, p.redirect_url),
      };
    },
    async paymentStatus(input) {
      const p = await payment(input.reference);
      if (!p) return null;
      const currency = typeof p.currency === "string" ? p.currency : "";
      const exp = currencyExponent(currency);
      const amount =
        typeof p.amount === "number" && exp !== null ? fromMinorUnits(BigInt(Math.round(p.amount * 10 ** exp)), currency) : null;
      if (!amount) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const state =
        p.status === "PAID"
          ? "Confirmed"
          : ["REJECTED", "CANCELLED", "EXPIRED"].includes(String(p.status))
            ? "Rejected"
            : p.status === "PENDING" && !p.approved_date
              ? "Requires action"
              : "Pending";
      return { state, reference: input.reference, amount, currency };
    },
    async verifyEvent({ rawBody, headers }) {
      const [login, secret] = await Promise.all(
        [c.loginRef, c.secretKeyRef].map((ref) => (ref ? deps.credentials.get(ref) : Promise.resolve(""))),
      );
      const date = headers.get("x-date") || "";
      const given = (headers.get("authorization") || "").match(/^V2-HMAC-SHA256, Signature: ([a-f0-9]{64})$/)?.[1];
      const at = Date.parse(date);
      if (!login || !secret || !given || headers.get("x-login") !== login || !Number.isFinite(at)) return null;
      if (Math.abs(now().getTime() - at) > 300000) return null;
      if (!timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(dlocalSignature(secret, login, date, rawBody), "hex"))) return null;
      const body = parseJson(rawBody);
      const id = typeof body.id === "string" ? body.id : undefined;
      const status = typeof body.status === "string" ? body.status : "";
      if (id)
        return { eventId: `${id}:${status}`, type: `payment.${status.toLowerCase() || "update"}`, kind: "payment", objectRef: id };
      const accountRef = typeof body.account_id === "string" ? body.account_id : undefined;
      return accountRef
        ? { eventId: `${accountRef}:${status}:${date}`, type: "account.update", kind: "account", accountRef }
        : null;
    },
    // Refunds reuse the payment's split, so the merchant's share is returned.
    async createRefund(input) {
      const r = await call("payins", "POST", "/refunds", {
        payment_id: input.reference,
        amount: major(input.amountMinor, input.currency),
        currency: input.currency,
        notification_url: c.notificationUrl,
      });
      if (typeof r.id !== "string") throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { reference: r.id, ...dlocalRefundState(r) };
    },
    async refundStatus(input) {
      if (!/^[A-Za-z0-9-]{1,100}$/.test(input.reference)) return null;
      return dlocalRefundState(await call("payins", "GET", `/refunds/${input.reference}/status`));
    },
    async fundsAvailability(input) {
      const p = await payment(input.reference);
      if (!p || p.status !== "PAID") return null;
      const currency = typeof p.currency === "string" ? p.currency : "";
      const exp = currencyExponent(currency);
      const approved = typeof p.approved_date === "string" ? new Date(p.approved_date) : null;
      if (typeof p.amount !== "number" || exp === null || !approved || Number.isNaN(approved.getTime()))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const gross = BigInt(Math.round(p.amount * 10 ** exp));
      return {
        paymentRef: input.reference,
        // Exactly the split PayRouta sent: processing fees are liable-account
        // fees, charged to PayRouta.
        netMinor: gross - input.feeMinor,
        availableAt: new Date(approved.getTime() + c.settlementPeriod * 86400000),
      };
    },
  };
}

export function dlocalRefundState(r: Record<string, unknown>): { state: RefundState; failureCode?: string } {
  if (r.status === "SUCCESS") return { state: "Succeeded" };
  if (r.status === "REJECTED" || r.status === "CANCELLED")
    return { state: "Failed", failureCode: typeof r.status_detail === "string" ? r.status_detail.slice(0, 100) : String(r.status) };
  return { state: "Pending" };
}

export const dlocalPlatform: PlatformModule = {
  manifest: dlocalManifest,
  configSchema,
  create,
};
