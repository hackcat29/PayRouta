// Tink one-time payments (pay by bank) under Tink's PISP licence, as a Tink
// partner. Merchants never see Tink: PayRouta registers each merchant through
// Tink's Merchants API, which screens it, and every payment request names
// the merchant's own verified bank account as the recipient. The payer's bank
// pays the merchant directly, so PayRouta never holds the funds, cannot
// withhold its fee (it is invoiced monthly) and cannot hold a reserve.
//
// Sources: docs.tink.com one-time payments (token, payment requests, Tink
// Link, transfer statuses, market formats) and partner integration (merchant
// fields). Two details are not in Tink's public Markdown docs and must be
// taken from the API reference in Tink Console before qualifying: the
// Merchants API path (`merchantsPath`, required) and the payment request's
// merchant field (sent as `merchantId`). Merchants also need provisioning by
// Tink. Verified with injected transports only.
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps, StatusSnapshot } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { currencyExponent, fromMinorUnits, toMinorUnits } from "../../partners/money";
import type { PlatformAdapter, PlatformManifest, PlatformModule } from "./contract";

const markets = ["AT", "DK", "EE", "FI", "FR", "DE", "IE", "IT", "LT", "NL", "NO", "PL", "PT", "ES", "SE", "CH", "GB"];

export const tinkManifest: PlatformManifest = {
  id: "tink",
  name: "Tink",
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: false,
  feeCollection: "invoice",
  needsPayoutAccount: true,
  merchantCountries: markets,
  methods: ["bank-transfer"],
  sharedFields: ["legalName", "tradingName", "country", "registrationNumber", "website"],
  paymentHosts: ["link.tink.com"],
  documentation: "https://docs.tink.com/resources/payments/one-time-payments/partner-integration-one-time-payments",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.tink.com").default("https://api.tink.com"),
    clientId: z.string().regex(/^[A-Za-z0-9]{8,64}$/),
    clientSecretRef: z.string().max(100).optional(),
    // Returned once when the Events v2 webhook endpoint is created.
    webhookSecretRef: z.string().max(100).optional(),
    // From Tink's API reference (Partner integration → Merchants).
    merchantsPath: z.string().regex(/^\/[a-z0-9/-]{2,80}$/),
    // Must be registered as a redirect URI in Tink Console.
    redirectUri: z.url(),
    // Transfer statuses treated as paid. SENT only means "sent to the bank";
    // include it knowingly for markets that report nothing later.
    confirmOn: z.array(z.enum(["SENT", "SETTLED_PAYER", "SETTLED_PAYEE", "SETTLED"])).min(1).default(["SETTLED_PAYEE", "SETTLED"]),
    locale: z.string().regex(/^[a-z]{2}_[A-Z]{2}$/).default("en_US"),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const merchantId = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const requestId = /^[0-9a-f]{32}$/i;

export function tinkMerchantSnapshot(m: Record<string, unknown>): StatusSnapshot {
  const id = typeof m.id === "string" ? m.id : undefined;
  const status = String(m.status ?? "").toUpperCase();
  const base = { providerAccountId: id, requirementsDue: [] as string[] };
  if (status === "APPROVED") return { ...base, state: "Approved", paymentsEnabled: true, payoutsEnabled: true };
  if (status === "DENIED")
    return { ...base, state: "Rejected", paymentsEnabled: false, payoutsEnabled: false, reason: "screening-denied" };
  return { ...base, state: "Under review", paymentsEnabled: false, payoutsEnabled: false };
}

// The recipient as Tink's market formats require it.
export function tinkRecipient(r: { accountNumber: string; routingNumber?: string; country: string }) {
  if (r.country === "GB") {
    const sort = (r.routingNumber ?? "").replace(/\D/g, "");
    const acct = r.accountNumber.replace(/\D/g, "");
    if (sort.length !== 6 || acct.length !== 8) return null;
    return { accountNumber: `${sort}${acct}`, accountType: "sort-code" };
  }
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(r.accountNumber) ? { accountNumber: r.accountNumber, accountType: "iban" } : null;
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const c = configSchema.parse(raw);
  async function token() {
    const secret = c.clientSecretRef ? await deps.credentials.get(c.clientSecretRef) : "";
    if (!secret) throw new PortalError("TINK_CREDENTIALS_NOT_CONFIGURED", 409);
    const response = await deps.http(c.baseUrl, {
      method: "POST",
      path: "/api/v1/oauth/token",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: c.clientId,
        client_secret: secret,
        grant_type: "client_credentials",
        scope: "payment:read,payment:write",
      }).toString(),
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("TINK", response.status);
    const t = parseJson(response.body);
    if (typeof t.access_token !== "string") throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
    return t.access_token;
  }
  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const response = await deps.http(c.baseUrl, {
      method,
      path,
      headers: {
        Authorization: `Bearer ${await token()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300) providerFailure("TINK", response.status);
    return parseJson(response.body);
  }
  const merchant = (id: string) => {
    if (!merchantId.test(id)) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
    return id;
  };
  async function transfer(reference: string) {
    if (!requestId.test(reference)) return null;
    const r = await call("GET", `/api/v1/payments/requests/${reference}/transfers`);
    // One payment request, one transfer: anything else needs a human.
    const list = Array.isArray(r.paymentRequestCreatedTransfers) ? r.paymentRequestCreatedTransfers : [];
    if (list.length > 1) throw new PortalError("TINK_MULTIPLE_TRANSFERS", 409);
    return (list[0] ?? null) as Record<string, unknown> | null;
  }
  return {
    async createAccount(input) {
      if (input.environment !== c.environment) throw new PortalError("PLATFORM_ENVIRONMENT_MISMATCH", 409);
      const p = input.profile;
      if (!input.details.merchantCategoryCode || !p.registrationNumber)
        throw new PortalError("PLATFORM_DETAILS_MISSING: business-details", 422);
      const m = await call("POST", c.merchantsPath, {
        name: (p.tradingName ?? p.legalName ?? "").slice(0, 100),
        country: p.country,
        organizationNumber: p.registrationNumber,
        url: p.website,
        categoryCode: input.details.merchantCategoryCode,
        externalId: input.linkId,
      });
      if (typeof m.id !== "string" || !merchantId.test(m.id)) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      return { providerAccountId: m.id, snapshot: tinkMerchantSnapshot(m) };
    },
    async accountStatus(id) {
      return tinkMerchantSnapshot(await call("GET", `${c.merchantsPath}/${merchant(id)}`));
    },
    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      const market = input.recipient?.country;
      const recipient = input.recipient && tinkRecipient(input.recipient);
      if (minor === null || input.method !== "bank-transfer" || !recipient || !market || !markets.includes(market) || input.feeMinor !== 0n)
        return { state: "Rejected", reference: "" };
      const gb = market === "GB";
      const r = await call("POST", "/api/v1/payments/requests", {
        recipient,
        amount: Number(input.amount),
        currency: input.currency,
        market,
        recipientName: input.recipient!.name.slice(0, 70),
        sourceMessage: `Payment ${input.reference}`.slice(0, 140),
        remittanceInformation: gb
          ? { type: "REFERENCE", value: input.reference.replace(/[^A-Za-z0-9-]/g, "").slice(0, 18) }
          : { type: "UNSTRUCTURED", value: `${input.reference} ${input.attemptKey}`.slice(0, 140) },
        ...(gb ? { paymentScheme: "FASTER_PAYMENTS" } : input.currency === "EUR" ? { paymentScheme: "SEPA_CREDIT_TRANSFER" } : {}),
        merchantId: merchant(input.providerAccountId),
      });
      if (typeof r.id !== "string" || !requestId.test(r.id)) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const link = new URL("https://link.tink.com/1.0/pay/direct/");
      link.searchParams.set("client_id", c.clientId);
      link.searchParams.set("redirect_uri", c.redirectUri);
      link.searchParams.set("market", market);
      link.searchParams.set("locale", c.locale);
      link.searchParams.set("payment_request_id", r.id);
      return {
        state: "Requires action",
        reference: r.id,
        actionUrl: assertPaymentHost(tinkManifest.paymentHosts, link.toString()),
      };
    },
    async paymentStatus(input) {
      const t = await transfer(input.reference);
      if (!t) return null;
      const currency = typeof t.currency === "string" ? t.currency : "";
      const exp = currencyExponent(currency);
      const amount =
        typeof t.amount === "number" && exp !== null ? fromMinorUnits(BigInt(Math.round(t.amount * 10 ** exp)), currency) : null;
      if (!amount) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      const status = String(t.status);
      const state = (c.confirmOn as string[]).includes(status)
        ? "Confirmed"
        : status === "FAILED" || status === "CANCELLED"
          ? "Rejected"
          : "Pending";
      return { state, reference: input.reference, amount, currency };
    },
    async verifyEvent({ rawBody, headers }) {
      const secret = c.webhookSecretRef ? await deps.credentials.get(c.webhookSecretRef) : "";
      const parts = Object.fromEntries((headers.get("x-tink-signature") || "").split(",").map((kv) => kv.trim().split("=")));
      const t = parts.t ?? "";
      const v1 = parts.v1 ?? "";
      if (!secret || !/^\d{1,12}$/.test(t) || !/^[a-f0-9]{64}$/.test(v1)) return null;
      if (Math.abs((deps.now?.() ?? new Date()).getTime() - Number(t) * 1000) > 300000) return null;
      const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
      if (!timingSafeEqual(Buffer.from(v1, "hex"), expected)) return null;
      const body = parseJson(rawBody);
      const type = typeof body.event === "string" ? body.event.slice(0, 100) : "";
      const content = (body.content ?? {}) as { id?: unknown; paymentRequestId?: unknown; status?: unknown };
      if (!type || typeof content.id !== "string") return null;
      return {
        eventId: `${content.id}:${String(content.status ?? "")}`,
        type,
        kind: type === "payment:updated" ? "payment" : "other",
        objectRef: typeof content.paymentRequestId === "string" ? content.paymentRequestId : undefined,
      };
    },
    async fundsAvailability(input) {
      const t = await transfer(input.reference);
      if (!t || !(c.confirmOn as string[]).includes(String(t.status))) return null;
      const currency = typeof t.currency === "string" ? t.currency : "";
      const exp = currencyExponent(currency);
      const updated = Number(t.updated);
      if (typeof t.amount !== "number" || exp === null || !Number.isFinite(updated))
        throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      // The payer's bank paid the merchant in full; PayRouta's fee is invoiced.
      return {
        paymentRef: input.reference,
        netMinor: BigInt(Math.round(t.amount * 10 ** exp)) - input.feeMinor,
        availableAt: new Date(updated),
      };
    },
  };
}

export const tinkPlatform: PlatformModule = {
  manifest: tinkManifest,
  configSchema,
  create,
};
