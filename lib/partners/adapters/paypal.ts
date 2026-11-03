// PayPal partner module (Partner Referrals v2, "before payment" onboarding).
//
// PayRouta pre-fills a referral; the merchant signs up or logs in to their
// own PayPal account, accepts PayPal's terms and grants PayRouta third-party
// API permissions. PayPal is available only to approved partners, and sellers
// in send-only countries cannot receive payments, so availability is always
// confirmed by PayPal's own merchant-integration status.
//
// Verified with injected transports only; qualify against the PayPal sandbox
// before enabling a production connection.
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
import { currencyExponent, fromMinorUnits, toMinorUnits } from "../money";
import type { KybProfile } from "../kyb";

export const paypalManifest: PartnerManifest = {
  id: "paypal",
  name: "PayPal",
  contractVersion: 1,
  paymentMethods: ["digital-wallet"],
  ownership: {
    merchantContractsDirectly: true,
    merchantHasOwnLogin: true,
    lossesBorneBy: "merchant",
    settlesToMerchant: true,
    portableOnExit: true,
  },
  onboarding: "hosted-link",
  methods: ["digital-wallet", "card"],
  merchantCountries: null,
  sharedFields: [
    "legalName",
    "tradingName",
    "businessType",
    "website",
    "supportEmail",
    "address",
    "representative",
  ],
  linkHosts: ["www.paypal.com", "www.sandbox.paypal.com"],
  requiresPartnerApproval: true,
  documentation: "https://developer.paypal.com/docs/multiparty/seller-onboarding/before-payment/",
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    clientIdRef: z.string().max(100).optional(),
    clientSecretRef: z.string().max(100).optional(),
    partnerMerchantId: z.string().regex(/^[A-Z0-9]{8,20}$/).optional(),
    webhookId: z.string().regex(/^[A-Z0-9-]{8,40}$/).optional(),
    features: z
      .array(z.enum(["PAYMENT", "REFUND", "PARTNER_FEE", "DELAY_FUNDS_DISBURSEMENT"]))
      .default(["PAYMENT", "REFUND"]),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

const entityType = {
  individual: "INDIVIDUAL",
  company: "CORPORATION",
  partnership: "PARTNERSHIP",
  "sole-proprietor": "PROPRIETORSHIP",
  "non-profit": "NONPROFIT",
} as const;

export function paypalReferralBody(
  trackingId: string,
  returnUrl: string,
  features: string[],
  p?: Partial<KybProfile>,
) {
  const operations = [
    {
      operation: "API_INTEGRATION",
      api_integration_preference: {
        rest_api_integration: {
          integration_method: "PAYPAL",
          integration_type: "THIRD_PARTY",
          third_party_details: { features },
        },
      },
    },
  ];
  const entity = p && {
    ...(p.businessType ? { business_type: { type: entityType[p.businessType] } } : {}),
    names: [
      ...(p.legalName ? [{ business_name: p.legalName, type: "LEGAL_NAME" }] : []),
      ...(p.tradingName ? [{ business_name: p.tradingName, type: "DOING_BUSINESS_AS" }] : []),
    ],
    ...(p.supportEmail ? { emails: [{ type: "CUSTOMER_SERVICE", email: p.supportEmail }] } : {}),
    ...(p.website ? { website: p.website } : {}),
    ...(p.address
      ? {
          addresses: [
            {
              address_line_1: p.address.line1,
              address_line_2: p.address.line2,
              admin_area_2: p.address.city,
              admin_area_1: p.address.region,
              postal_code: p.address.postalCode,
              country_code: p.address.country,
              type: "WORK",
            },
          ],
        }
      : {}),
  };
  return {
    tracking_id: trackingId,
    ...(p?.representative?.email ? { email: p.representative.email } : {}),
    ...(entity ? { business_entity: entity } : {}),
    operations,
    products: ["EXPRESS_CHECKOUT"],
    legal_consents: [{ type: "SHARE_DATA_CONSENT", granted: true }],
    partner_config_override: { return_url: returnUrl },
  };
}

export function paypalSnapshot(m: Record<string, unknown> | null): StatusSnapshot {
  if (!m)
    return {
      state: "Action required",
      requirementsDue: ["complete-hosted-onboarding"],
      paymentsEnabled: false,
      payoutsEnabled: false,
    };
  const due: string[] = [];
  if (m.primary_email_confirmed !== true) due.push("confirm-email");
  if (m.payments_receivable !== true) due.push("enable-payments-receivable");
  if (!Array.isArray(m.oauth_integrations) || !m.oauth_integrations.length)
    due.push("grant-api-permissions");
  const id = typeof m.merchant_id === "string" ? m.merchant_id : undefined;
  return {
    state: due.length ? "Action required" : "Approved",
    providerAccountId: id,
    requirementsDue: due,
    paymentsEnabled: m.payments_receivable === true,
    payoutsEnabled: m.payments_receivable === true,
  };
}

function create(raw: unknown, deps: PartnerDeps): PartnerAdapter {
  const c = configSchema.parse(raw);
  const now = () => deps.now?.() ?? new Date();
  const baseUrl =
    c.environment === "production"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com";
  let token: { value: string; expires: number } | undefined;
  async function accessToken() {
    if (token && token.expires > now().getTime()) return token.value;
    const id = c.clientIdRef ? await deps.credentials.get(c.clientIdRef) : "";
    const secret = c.clientSecretRef ? await deps.credentials.get(c.clientSecretRef) : "";
    if (!id || !secret) throw new PortalError("PAYPAL_CREDENTIALS_NOT_CONFIGURED", 409);
    const response = await deps.http(baseUrl, {
      method: "POST",
      path: "/v1/oauth2/token",
      headers: {
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
      timeoutMs: c.timeoutMs,
    });
    if (response.status !== 200) providerFailure("PAYPAL_AUTH", response.status);
    const body = parseJson(response.body);
    if (typeof body.access_token !== "string")
      throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
    const ttl = typeof body.expires_in === "number" ? body.expires_in : 300;
    token = {
      value: body.access_token,
      expires: now().getTime() + Math.max(0, ttl - 60) * 1000,
    };
    return token.value;
  }
  async function call(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) {
    const response = await deps.http(baseUrl, {
      method,
      path,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      timeoutMs: c.timeoutMs,
    });
    if (method === "GET" && response.status === 404) return null;
    if (response.status < 200 || response.status >= 300)
      providerFailure("PAYPAL", response.status);
    return parseJson(response.body);
  }
  function partner() {
    if (!c.partnerMerchantId)
      throw new PortalError("PAYPAL_PARTNER_ID_NOT_CONFIGURED", 409);
    return c.partnerMerchantId;
  }
  async function referral(trackingId: string, returnUrl: string, p?: Partial<KybProfile>) {
    const res = await call(
      "POST",
      "/v2/customer/partner-referrals",
      paypalReferralBody(trackingId, returnUrl, c.features, p),
    );
    const links = Array.isArray(res?.links) ? res.links : [];
    const action = links.find(
      (l): l is { href: string } =>
        !!l && typeof l === "object" && (l as { rel?: unknown }).rel === "action_url",
    );
    if (!action || typeof action.href !== "string")
      throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
    return assertLinkHost(paypalManifest, action.href);
  }
  // Act as the merchant (third-party permissions granted at onboarding).
  async function assertion(merchantId: string) {
    const clientId = c.clientIdRef ? await deps.credentials.get(c.clientIdRef) : "";
    if (!clientId) throw new PortalError("PAYPAL_CREDENTIALS_NOT_CONFIGURED", 409);
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
    return `${b64({ alg: "none" })}.${b64({ iss: clientId, payer_id: merchantId })}.`;
  }
  const merchantOf = (a: { providerAccountId?: string }) => {
    if (!a.providerAccountId || !/^[A-Z0-9]{8,20}$/.test(a.providerAccountId))
      throw new PortalError("PARTNER_ACCOUNT_UNKNOWN", 404);
    return a.providerAccountId;
  };
  function orderState(order: Record<string, unknown>) {
    const unit = (Array.isArray(order.purchase_units) ? order.purchase_units[0] : null) as
      | { amount?: { currency_code?: unknown; value?: unknown }; payments?: { captures?: { status?: unknown }[] } }
      | null;
    const currency = typeof unit?.amount?.currency_code === "string" ? unit.amount.currency_code : "";
    const exponent = currencyExponent(currency);
    const minor =
      typeof unit?.amount?.value === "string" && exponent !== null
        ? toMinorUnits(unit.amount.value, exponent, currency)
        : null;
    const amount = minor === null ? null : fromMinorUnits(minor, currency);
    if (!amount) throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
    const capture = unit?.payments?.captures?.[0]?.status;
    const state =
      order.status === "COMPLETED"
        ? capture === "COMPLETED"
          ? "Confirmed"
          : capture === "DECLINED" || capture === "FAILED"
            ? "Rejected"
            : "Pending"
        : order.status === "VOIDED"
          ? "Rejected"
          : order.status === "APPROVED"
            ? "Pending"
            : "Requires action";
    return { state, amount, currency } as const;
  }
  return {
    manifest: paypalManifest,
    // PayPal Orders on the merchant's own PayPal account: the buyer approves
    // on PayPal, then PayRouta captures; funds land in the merchant's account.
    payments: {
      methods: paypalManifest.paymentMethods!,
      paymentHosts: ["www.paypal.com", "www.sandbox.paypal.com"],
      async create(input) {
        if (input.method !== "digital-wallet" || input.paymentHint && input.paymentHint !== "paypal")
          throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
        const minor = toMinorUnits(input.amount, input.precision, input.currency);
        if (minor === null) return { state: "Rejected", reference: "" };
        const value = fromMinorUnits(minor, input.currency)!;
        let order;
        try {
          order = await call(
            "POST",
            "/v2/checkout/orders",
            {
              intent: "CAPTURE",
              purchase_units: [
                {
                  reference_id: "default",
                  custom_id: input.attemptKey.slice(0, 127),
                  description: `Payment ${input.reference}`.slice(0, 127),
                  amount: { currency_code: input.currency, value },
                },
              ],
              payment_source: {
                paypal: {
                  experience_context: {
                    return_url: input.returnUrl,
                    cancel_url: input.cancelUrl,
                    user_action: "PAY_NOW",
                    shipping_preference: "NO_SHIPPING",
                  },
                },
              },
            },
            {
              "PayPal-Auth-Assertion": await assertion(merchantOf(input.account)),
              "PayPal-Request-Id": input.attemptKey.slice(0, 108),
              Prefer: "return=representation",
            },
          );
        } catch (error) {
          if (error instanceof PortalError && error.status === 422)
            return { state: "Rejected", reference: "" };
          throw error;
        }
        const links = Array.isArray(order?.links) ? order.links : [];
        const approve = links.find(
          (l): l is { href: string } =>
            !!l &&
            typeof l === "object" &&
            ["payer-action", "approve"].includes(String((l as { rel?: unknown }).rel)) &&
            typeof (l as { href?: unknown }).href === "string",
        );
        if (typeof order?.id !== "string" || !/^[A-Z0-9]{10,40}$/.test(order.id) || !approve)
          throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
        return {
          state: "Requires action",
          reference: order.id,
          actionUrl: assertPaymentHost(["www.paypal.com", "www.sandbox.paypal.com"], approve.href),
        };
      },
      async status(input) {
        if (!/^[A-Z0-9]{10,40}$/.test(input.reference)) return null;
        const headers = { "PayPal-Auth-Assertion": await assertion(merchantOf(input.account)) };
        let order = await call("GET", `/v2/checkout/orders/${input.reference}`, undefined, headers);
        if (!order) return null;
        if (order.status === "APPROVED") {
          const approved = orderState(order);
          try {
            order = await call(
              "POST",
              `/v2/checkout/orders/${input.reference}/capture`,
              {},
              { ...headers, "PayPal-Request-Id": `capture-${input.reference}`, Prefer: "return=representation" },
            );
          } catch (error) {
            // A declined capture moves no money: the attempt is rejected.
            if (error instanceof PortalError && error.status === 422)
              return { state: "Rejected", reference: input.reference, amount: approved.amount, currency: approved.currency };
            throw error;
          }
        }
        if (!order) return null;
        const s = orderState(order);
        return { state: s.state, reference: input.reference, amount: s.amount, currency: s.currency };
      },
    },
    async createAccount(input) {
      if (input.environment !== c.environment)
        throw new PortalError("PARTNER_ENVIRONMENT_MISMATCH", 409);
      partner();
      // The tracking ID is PayRouta's application ID, so a retried referral
      // resolves to the same seller rather than creating a second one.
      await referral(input.applicationId, input.returnUrl, input.profile as Partial<KybProfile>);
      return { accountRef: input.applicationId, snapshot: paypalSnapshot(null) };
    },
    async onboardingLink(input) {
      return { url: await referral(input.accountRef, input.returnUrl) };
    },
    async status(input) {
      const pmid = partner();
      let merchantId = input.providerAccountId;
      if (!merchantId) {
        const found = await call(
          "GET",
          `/v1/customer/partners/${pmid}/merchant-integrations?tracking_id=${encodeURIComponent(input.accountRef)}`,
        );
        merchantId =
          typeof found?.merchant_id === "string" ? found.merchant_id : undefined;
      }
      if (!merchantId) return paypalSnapshot(null);
      if (!/^[A-Z0-9]{8,20}$/.test(merchantId))
        throw new PortalError("PARTNER_RESPONSE_INVALID", 502);
      return paypalSnapshot(
        await call("GET", `/v1/customer/partners/${pmid}/merchant-integrations/${merchantId}`),
      );
    },
    // PayPal signatures are certificate-based; PayPal's own verification API
    // is the supported way to check them.
    async verifyEvent({ rawBody, headers }) {
      if (!c.webhookId) return null;
      const h = (k: string) => headers.get(k) || "";
      const sent = Date.parse(h("paypal-transmission-time"));
      if (
        !h("paypal-transmission-id") ||
        !h("paypal-transmission-sig") ||
        !Number.isFinite(sent) ||
        Math.abs(now().getTime() - sent) > 300000
      )
        return null;
      let event: Record<string, unknown>;
      try {
        event = parseJson(rawBody);
      } catch {
        return null;
      }
      const result = await call("POST", "/v1/notifications/verify-webhook-signature", {
        auth_algo: h("paypal-auth-algo"),
        cert_url: h("paypal-cert-url"),
        transmission_id: h("paypal-transmission-id"),
        transmission_sig: h("paypal-transmission-sig"),
        transmission_time: h("paypal-transmission-time"),
        webhook_id: c.webhookId,
        webhook_event: event,
      });
      if (result?.verification_status !== "SUCCESS") return null;
      const resource = (event.resource ?? {}) as Record<string, unknown>;
      if (typeof event.id !== "string" || typeof event.event_type !== "string")
        return null;
      const related = (resource.supplementary_data as { related_ids?: { order_id?: unknown } } | undefined)
        ?.related_ids?.order_id;
      return {
        objectRef:
          typeof related === "string"
            ? related
            : event.event_type.startsWith("CHECKOUT.ORDER") && typeof resource.id === "string"
              ? resource.id
              : undefined,
        eventId: event.id.slice(0, 100),
        type: event.event_type.slice(0, 100),
        accountRef:
          typeof resource.tracking_id === "string" ? resource.tracking_id : undefined,
        providerAccountId:
          typeof resource.merchant_id === "string" ? resource.merchant_id : undefined,
      };
    },
  };
}

export const paypalPartner: PartnerModule = {
  manifest: paypalManifest,
  configSchema,
  create,
};
