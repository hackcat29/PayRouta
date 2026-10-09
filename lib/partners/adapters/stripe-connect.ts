// Stripe Connect partner module.
//
// Accounts are created with controller properties equivalent to legacy
// Standard accounts: full Stripe Dashboard, Stripe collects requirements,
// Stripe bears negative-balance losses and the account pays its own fees.
// The merchant contracts with Stripe directly and keeps the account if it
// leaves PayRouta. Express/Custom-style accounts (platform liable) are
// intentionally not offered.
//
// Verified with injected transports only; run the conformance suite against
// Stripe test mode before enabling a production connection.
import { createHmac, timingSafeEqual } from "node:crypto";
import { stripeBankTransfer } from "../../providers/adapters/native/stripe-bank-transfer";
import { selectStripeTypes, stripePaymentTypes } from "../../providers/adapters/native/stripe-methods";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type {
  PartnerAdapter,
  PartnerDeps,
  PartnerManifest,
  PartnerModule,
  StatusSnapshot,
} from "../contract";
import { assertLinkHost, assertPaymentHost, parseJson, providerFailure } from "../contract";
import { fromMinorUnits, toMinorUnits } from "../money";
import type { KybProfile } from "../kyb";

export const stripeManifest: PartnerManifest = {
  id: "stripe-connect",
  name: "Stripe",
  contractVersion: 1,
  paymentMethods: ["card", "digital-wallet", "direct-debit", "bnpl", "bank-transfer"],
  ownership: {
    merchantContractsDirectly: true,
    merchantHasOwnLogin: true,
    lossesBorneBy: "provider",
    settlesToMerchant: true,
    portableOnExit: true,
  },
  onboarding: "api-prefill",
  methods: ["card", "digital-wallet", "direct-debit", "bnpl", "bank-transfer"],
  merchantCountries: null,
  sharedFields: [
    "legalName",
    "tradingName",
    "businessType",
    "country",
    "website",
    "productDescription",
    "supportEmail",
    "address",
    "representative",
  ],
  linkHosts: ["connect.stripe.com"],
  requiresPartnerApproval: false,
  documentation: "https://docs.stripe.com/connect/accounts-v2",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.stripe.com").default("https://api.stripe.com"),
    apiVersion: z.string().regex(/^\d{4}-\d{2}-\d{2}(\.\w+)?$/).default("2024-06-20"),
    euBankTransferCountry: z.enum(["DE", "FR", "IE", "NL"]).default("DE"),
    enabledPaymentTypes: z.array(z.enum(stripePaymentTypes)).min(1).default(["card"]),
    secretKeyRef: z.string().max(100).optional(),
    webhookSecretRef: z.string().max(100).optional(),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

// application/x-www-form-urlencoded with Stripe's bracket notation.
export function formEncode(value: unknown, prefix = ""): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value))
    return value.flatMap((v, i) => formEncode(v, `${prefix}[${i}]`));
  if (typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) =>
      formEncode(v, prefix ? `${prefix}[${k}]` : k),
    );
  return [`${encodeURIComponent(prefix)}=${encodeURIComponent(String(value))}`];
}

const businessType = {
  company: "company",
  partnership: "company",
  "sole-proprietor": "individual",
  "non-profit": "non_profit",
} as const;

export function stripeAccountBody(
  applicationId: string,
  p: Partial<KybProfile>,
) {
  const type = p.businessType ? businessType[p.businessType] : undefined;
  const address = p.address && {
    line1: p.address.line1,
    line2: p.address.line2,
    city: p.address.city,
    state: p.address.region,
    postal_code: p.address.postalCode,
    country: p.address.country,
  };
  return {
    controller: {
      stripe_dashboard: { type: "full" },
      fees: { payer: "account" },
      losses: { payments: "stripe" },
      requirement_collection: "stripe",
    },
    country: p.country,
    email: p.representative?.email,
    business_type: type,
    business_profile: {
      name: p.tradingName ?? p.legalName,
      url: p.website,
      product_description: p.productDescription,
      support_email: p.supportEmail,
    },
    ...(type === "individual"
      ? {
          individual: {
            first_name: p.representative?.givenName,
            last_name: p.representative?.familyName,
            email: p.representative?.email,
            address,
          },
        }
      : { company: { name: p.legalName, address } }),
    metadata: { payrouta_application: applicationId },
  };
}

export function stripeSnapshot(a: Record<string, unknown>): StatusSnapshot {
  const req = (a.requirements ?? {}) as {
    currently_due?: unknown;
    past_due?: unknown;
    disabled_reason?: unknown;
  };
  const due = [
    ...new Set(
      [
        ...(Array.isArray(req.past_due) ? req.past_due : []),
        ...(Array.isArray(req.currently_due) ? req.currently_due : []),
      ]
        .filter((v): v is string => typeof v === "string")
        .map((v) => v.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(0, 80))
        .filter((v) => /^[a-z0-9]/.test(v)),
    ),
  ].slice(0, 50);
  const disabled =
    typeof req.disabled_reason === "string" ? req.disabled_reason : "";
  const charges = a.charges_enabled === true;
  const payouts = a.payouts_enabled === true;
  const id = typeof a.id === "string" ? a.id : undefined;
  const base = {
    providerAccountId: id,
    requirementsDue: due,
    paymentsEnabled: charges,
    payoutsEnabled: payouts,
  };
  if (disabled.startsWith("rejected"))
    return { ...base, state: "Rejected", reason: disabled.slice(0, 200) };
  if (charges && payouts)
    return due.length
      ? { ...base, state: "Restricted", reason: "requirements-due" }
      : { ...base, state: "Approved" };
  if (charges || payouts)
    return { ...base, state: "Restricted", reason: disabled.slice(0, 200) || undefined };
  if (due.length) return { ...base, state: "Action required" };
  if (a.details_submitted === true) return { ...base, state: "Under review" };
  return { ...base, state: "Pending provider" };
}

// Stripe-Signature: t=<unix>,v1=<hex>[,v1=<hex>]. Tolerance five minutes.
export function verifyStripeSignature(
  secret: string,
  rawBody: string,
  header: string,
  now: Date,
) {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1] ?? "";
  const signatures = parts
    .filter(([k, v]) => k === "v1" && /^[a-f0-9]{64}$/.test(v ?? ""))
    .map(([, v]) => Buffer.from(v, "hex"));
  if (!/^\d{1,12}$/.test(t) || !signatures.length) return false;
  if (Math.abs(now.getTime() - Number(t) * 1000) > 300000) return false;
  const expected = createHmac("sha256", secret)
    .update(`${t}.${rawBody}`)
    .digest();
  return signatures.some((s) => timingSafeEqual(s, expected));
}

function create(raw: unknown, deps: PartnerDeps): PartnerAdapter {
  const c = configSchema.parse(raw);
  const now = () => deps.now?.() ?? new Date();
  async function key() {
    const secret = c.secretKeyRef ? await deps.credentials.get(c.secretKeyRef) : "";
    if (!secret) throw new PortalError("STRIPE_CREDENTIALS_NOT_CONFIGURED", 409);
    // A test key can never act on production merchants, or the reverse.
    const mode = c.environment === "production" ? "live" : "test";
    if (!new RegExp(`^(sk|rk)_${mode}_`).test(secret))
      throw new PortalError("STRIPE_KEY_ENVIRONMENT_MISMATCH", 409);
    return secret;
  }
  async function call(
    method: "GET" | "POST",
    path: string,
    form?: unknown,
    idempotencyKey?: string,
    account?: string,
  ) {
    const response = await deps.http(c.baseUrl, {
      method,
      path,
      headers: {
        Authorization: `Bearer ${await key()}`,
        "Stripe-Version": c.apiVersion,
        ...(account ? { "Stripe-Account": account } : {}),
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: form ? formEncode(form).join("&") : undefined,
      timeoutMs: c.timeoutMs,
    });
    if (response.status < 200 || response.status >= 300)
      providerFailure("STRIPE", response.status);
    return parseJson(response.body);
  }
  const connected = (a: { accountRef: string; providerAccountId?: string }) => {
    const id = a.providerAccountId ?? a.accountRef;
    if (!/^acct_\w{1,64}$/.test(id)) throw new PortalError("PARTNER_ACCOUNT_UNKNOWN", 404);
    return id;
  };
  return {
    manifest: stripeManifest,
    // Stripe Checkout on the merchant's own connected account (direct
    // charges): Stripe collects card details; PayRouta never sees them, and
    // the merchant's account receives the funds and pays its own fees.
    payments: {
      methods: stripeManifest.paymentMethods!,
      paymentHosts: ["checkout.stripe.com"],
      async create(input) {
        const minor = toMinorUnits(input.amount, input.precision, input.currency);
        if (minor === null) return { state: "Rejected", reference: "" };
        const now = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
        const types = selectStripeTypes(input.method, input.currency, c.enabledPaymentTypes, input.paymentHint);
        const transfer = stripeBankTransfer(types, input.currency, input.customerReference, c.euBankTransferCountry);
        const session = await call(
          "POST",
          "/v1/checkout/sessions",
          {
            mode: "payment",
            payment_method_types: types,
            ...transfer,
            ...(types.includes("wechat_pay") ? { payment_method_options: { wechat_pay: { client: "web" } } } : {}),
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: input.currency.toLowerCase(),
                  unit_amount: minor.toString(),
                  product_data: { name: `Payment ${input.reference}`.slice(0, 250) },
                },
              },
            ],
            success_url: input.returnUrl,
            cancel_url: input.cancelUrl,
            client_reference_id: input.attemptKey.slice(0, 200),
            expires_at: now + 1860,
            metadata: { payrouta_attempt: input.attemptKey },
            payment_intent_data: { metadata: { payrouta_attempt: input.attemptKey } },
          },
          `payrouta-${input.attemptKey}`,
          connected(input.account),
        );
        if (typeof session.id !== "string" || !/^cs_\w{1,200}$/.test(session.id) || typeof session.url !== "string")
          throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
        return {
          state: "Requires action",
          reference: session.id,
          actionUrl: assertPaymentHost(["checkout.stripe.com"], session.url),
        };
      },
      async status(input) {
        if (!/^cs_\w{1,200}$/.test(input.reference)) return null;
        const s = await call(
          "GET",
          `/v1/checkout/sessions/${input.reference}`,
          undefined,
          undefined,
          connected(input.account),
        );
        const currency = typeof s.currency === "string" ? s.currency.toUpperCase() : "";
        const amount =
          typeof s.amount_total === "number" ? fromMinorUnits(s.amount_total, currency) : null;
        if (!amount) throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
        const state =
          s.status === "complete" && s.payment_status === "paid"
            ? "Confirmed"
            : s.status === "expired"
              ? "Rejected"
              : s.status === "complete"
                ? "Pending"
                : "Requires action";
        return { state, reference: input.reference, amount, currency };
      },
    },
    async createAccount(input) {
      if (input.environment !== c.environment)
        throw new PortalError("PARTNER_ENVIRONMENT_MISMATCH", 409);
      const account = await call(
        "POST",
        "/v1/accounts",
        stripeAccountBody(input.applicationId, input.profile as Partial<KybProfile>),
        `payrouta-partner-${input.applicationId}`,
      );
      if (typeof account.id !== "string" || !/^acct_\w{1,64}$/.test(account.id))
        throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
      return { accountRef: account.id, snapshot: stripeSnapshot(account) };
    },
    async onboardingLink(input) {
      const link = await call("POST", "/v1/account_links", {
        account: input.accountRef,
        refresh_url: input.refreshUrl,
        return_url: input.returnUrl,
        type: "account_onboarding",
      });
      if (typeof link.url !== "string")
        throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
      return {
        url: assertLinkHost(stripeManifest, link.url),
        expiresAt:
          typeof link.expires_at === "number"
            ? new Date(link.expires_at * 1000)
            : undefined,
      };
    },
    async status(input) {
      if (!/^acct_\w{1,64}$/.test(input.accountRef))
        throw new PortalError("PARTNER_ACCOUNT_UNKNOWN", 404);
      return stripeSnapshot(await call("GET", `/v1/accounts/${input.accountRef}`));
    },
    async verifyEvent({ rawBody, headers }) {
      if (!c.webhookSecretRef) return null;
      const secret = await deps.credentials.get(c.webhookSecretRef);
      if (
        !secret ||
        !verifyStripeSignature(secret, rawBody, headers.get("stripe-signature") || "", now())
      )
        return null;
      let event: Record<string, unknown>;
      try {
        event = parseJson(rawBody);
      } catch {
        return null;
      }
      const object = ((event.data as { object?: Record<string, unknown> })?.object ?? {});
      const type = typeof event.type === "string" ? event.type.slice(0, 100) : "";
      const account =
        typeof event.account === "string"
          ? event.account
          : type.startsWith("account.") && typeof object.id === "string"
            ? object.id
            : undefined;
      if (typeof event.id !== "string" || !/^evt_\w{1,100}$/.test(event.id) || !type)
        return null;
      // Refuse events from the other mode.
      if ((event.livemode === true) !== (c.environment === "production")) return null;
      return {
        eventId: event.id,
        type,
        accountRef: account,
        providerAccountId: account,
        objectRef: typeof object.id === "string" ? object.id.slice(0, 200) : undefined,
      };
    },
  };
}

export const stripePartner: PartnerModule = {
  manifest: stripeManifest,
  configSchema,
  create,
};
