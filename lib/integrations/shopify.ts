// PayRouta as a Shopify payments app (offsite payments extension), see
// docs/shopify.md and integrations/shopify. At Shopify checkout the buyer
// picks PayRouta; Shopify sends a payment session here; PayRouta opens a
// universal checkout (cards, digital wallets, bank transfer, mobile money, credit, and crypto
// for USD shops) and returns its link as `redirect_url`. When the payment is
// confirmed, PayRouta resolves the session through the Payments Apps GraphQL
// API and the buyer returns to Shopify's order status page.
//
// Transport security: Shopify calls payment and refund session URLs with
// mutual TLS. nginx terminates it on a dedicated host (deploy/nginx.conf),
// verifies Shopify's client certificate against Shopify's CA, and forwards
// the verification result with a proxy secret; requests without both are
// refused here. GraphQL calls from PayRouta to Shopify use the shop's
// offline access token.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../portal/db";
import { atomic } from "../portal/service";
import { PortalError } from "../portal/domain";
import { secretManager } from "../portal/adapters";
import { providerRequest, type ProviderHttpOptions, type ProviderHttpResponse } from "../providers/adapters/http";
import { fiatPaymentMethodIds } from "../providers/normalized";
import { createUniversalCheckout, universalCheckoutPath } from "../payments/universal";
import { queue } from "../payments/service";
import { requestRefund } from "../treasury/refunds";
import { currencyExponent } from "../partners/money";

export type Http = (base: string, options: ProviderHttpOptions) => Promise<ProviderHttpResponse>;
export const shopifyScopes = "write_payment_gateways,write_payment_sessions";
export const apiVersion = () => process.env.SHOPIFY_API_VERSION || "2026-10";

export function shopDomain(value: string | null | undefined) {
  const shop = (value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(shop)) throw new PortalError("SHOPIFY_SHOP_INVALID", 400);
  return shop;
}

function origin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new PortalError("PORTAL_ORIGIN_NOT_CONFIGURED", 503);
  return new URL(value).origin;
}

async function appSecret() {
  const ref = process.env.SHOPIFY_API_SECRET_REF;
  if (!ref || !process.env.SHOPIFY_API_KEY) throw new PortalError("SHOPIFY_NOT_CONFIGURED", 503);
  return secretManager.get(ref);
}

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// OAuth callback and app-home query strings: hex HMAC-SHA256 of the other
// parameters, sorted, as key=value joined with "&".
export function verifyQueryHmac(params: URLSearchParams, secret: string) {
  const supplied = params.get("hmac") ?? "";
  const message = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return /^[a-f0-9]{64}$/.test(supplied) && equal(createHmac("sha256", secret).update(message).digest("hex"), supplied);
}

// Webhooks: base64 HMAC-SHA256 of the raw body in X-Shopify-Hmac-Sha256.
export function verifyWebhookHmac(raw: string, supplied: string | null, secret: string) {
  return !!supplied && equal(createHmac("sha256", secret).update(raw, "utf8").digest("base64"), supplied);
}

// Payment-session requests arrive only through the mTLS proxy.
export async function assertMtls(headers: Headers) {
  const ref = process.env.SHOPIFY_MTLS_PROXY_SECRET_REF;
  if (!ref) throw new PortalError("SHOPIFY_NOT_CONFIGURED", 503);
  const secret = await secretManager.get(ref);
  if (headers.get("x-payrouta-client-verify") !== "SUCCESS" || !equal(headers.get("x-payrouta-proxy-secret") ?? "", secret))
    throw new PortalError("SHOPIFY_CLIENT_CERTIFICATE_REQUIRED", 401);
}

// --- Install (OAuth) -------------------------------------------------------

export function installUrl(shop: string, state: string) {
  const url = new URL(`https://${shopDomain(shop)}/admin/oauth/authorize`);
  url.searchParams.set("client_id", process.env.SHOPIFY_API_KEY ?? "");
  url.searchParams.set("scope", shopifyScopes);
  url.searchParams.set("redirect_uri", `${origin()}/api/integrations/shopify/callback`);
  url.searchParams.set("state", state);
  return url.toString();
}

export const newState = () => randomBytes(24).toString("base64url");

export async function completeInstall(params: URLSearchParams, expectedState: string | undefined, http: Http = providerRequest) {
  const secret = await appSecret();
  if (!verifyQueryHmac(params, secret)) throw new PortalError("SHOPIFY_HMAC_INVALID", 401);
  if (!expectedState || !equal(params.get("state") ?? "", expectedState)) throw new PortalError("SHOPIFY_STATE_INVALID", 401);
  const shop = shopDomain(params.get("shop"));
  const code = params.get("code");
  if (!code || !/^[A-Za-z0-9_-]{8,200}$/.test(code)) throw new PortalError("SHOPIFY_CODE_INVALID", 400);
  const response = await http(`https://${shop}`, {
    method: "POST",
    path: "/admin/oauth/access_token",
    body: JSON.stringify({ client_id: process.env.SHOPIFY_API_KEY, client_secret: secret, code }),
    timeoutMs: 10000,
  });
  const parsed = z
    .object({ access_token: z.string().min(10).max(500), scope: z.string().max(1000) })
    .safeParse(response.status === 200 ? JSON.parse(response.body) : null);
  if (!parsed.success) throw new PortalError("SHOPIFY_TOKEN_EXCHANGE_FAILED", 502);
  const granted = parsed.data.scope.split(",");
  if (!shopifyScopes.split(",").every((s) => granted.includes(s))) throw new PortalError("SHOPIFY_SCOPES_MISSING", 409);
  const accessTokenRef = await secretManager.put(parsed.data.access_token);
  await db.shopifyShop.upsert({
    where: { shop },
    create: { shop, accessTokenRef, scopes: parsed.data.scope, methods: ["card", "digital-wallet", "bank-transfer", "mobile-money", "bnpl"], cryptoOptions: [] },
    // A reinstall must be marked ready again (paymentsAppConfigure).
    update: { accessTokenRef, scopes: parsed.data.scope, uninstalledAt: null, ready: false },
  });
  return shop;
}

// --- GraphQL ---------------------------------------------------------------

async function graphql<T>(shop: string, query: string, variables: Record<string, unknown>, http: Http) {
  const record = await db.shopifyShop.findUnique({ where: { shop } });
  if (!record || record.uninstalledAt) throw new PortalError("SHOPIFY_SHOP_NOT_INSTALLED", 409);
  const token = await secretManager.get(record.accessTokenRef);
  const response = await http(`https://${shop}`, {
    method: "POST",
    path: `/payments_apps/api/${apiVersion()}/graphql.json`,
    headers: { "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    timeoutMs: 10000,
    maxResponseBytes: 262144,
  });
  // 5xx and throttling: the caller's job retries with backoff.
  if (response.status !== 200) throw new PortalError("SHOPIFY_UNAVAILABLE", 503);
  const body = JSON.parse(response.body) as { data?: T; errors?: unknown };
  if (!body.data) throw new PortalError("SHOPIFY_GRAPHQL_ERROR", 502);
  return body.data;
}

type UserErrors = { userErrors: { field?: string[]; message: string; code?: string }[] };

// Links an installed shop to a PayRouta merchant and marks the app ready.
export async function connectShop(
  input: { shop: string; orgId: string; environment: "sandbox" | "production"; methods: string[]; cryptoOptions: { network: string; identifier: string }[] },
  http: Http = providerRequest,
) {
  const shop = shopDomain(input.shop);
  const methods = input.methods.filter((m) => (fiatPaymentMethodIds as readonly string[]).includes(m));
  await db.shopifyShop.update({
    where: { shop },
    data: { orgId: input.orgId, environment: input.environment, methods, cryptoOptions: input.cryptoOptions.slice(0, 20) },
  });
  const data = await graphql<{ paymentsAppConfigure: UserErrors }>(
    shop,
    `mutation Configure($externalHandle: String, $ready: Boolean!) {
      paymentsAppConfigure(externalHandle: $externalHandle, ready: $ready) {
        paymentsAppConfiguration { externalHandle ready }
        userErrors { field message }
      }
    }`,
    { externalHandle: input.orgId.slice(0, 50), ready: true },
    http,
  );
  if (data.paymentsAppConfigure.userErrors.length) throw new PortalError("SHOPIFY_CONFIGURE_FAILED", 502);
  await db.shopifyShop.update({ where: { shop }, data: { ready: true } });
  return `https://${shop}/services/payments_partners/gateways/${process.env.SHOPIFY_API_KEY}/settings`;
}

// --- Payment sessions --------------------------------------------------------

const address = z.object({ country_code: z.string().regex(/^[A-Z]{2}$/).optional() }).passthrough();
export const paymentSessionRequest = z
  .object({
    id: z.string().min(1).max(200),
    gid: z.string().startsWith("gid://shopify/PaymentSession/").max(300),
    group: z.string().min(1).max(200),
    amount: z.union([z.string(), z.number()]).transform(String),
    currency: z.string().regex(/^[A-Z]{3}$/),
    test: z.boolean(),
    kind: z.enum(["sale", "authorization"]),
    merchant_locale: z.string().max(40).optional(),
    customer: z
      .object({
        email: z.string().max(254).optional().nullable(),
        locale: z.string().max(40).optional(),
        billing_address: address.optional().nullable(),
        shipping_address: address.optional().nullable(),
      })
      .passthrough()
      .optional(),
    payment_method: z.object({ type: z.literal("offsite"), data: z.object({ cancel_url: z.url() }).passthrough() }).passthrough(),
  })
  .passthrough();

const keyFor = (shop: string, id: string) => `shp-${createHash("sha256").update(`${shop}:${id}`).digest("hex").slice(0, 40)}`;

// Amount as Shopify sends it ("19.99" or 19.99), in the currency's exponent.
export function shopifyAmount(amount: string, currency: string) {
  const exp = currencyExponent(currency);
  if (exp === null || exp === undefined || !/^\d{1,15}(\.\d{1,8})?$/.test(amount)) throw new PortalError("INVALID_AMOUNT", 400);
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.replace(/0+$/, "").length > exp) throw new PortalError("INVALID_AMOUNT", 400);
  return exp ? `${whole}.${fraction.padEnd(exp, "0").slice(0, exp)}` : whole;
}

export async function startPaymentSession(headers: Headers, raw: unknown, prices?: Parameters<typeof createUniversalCheckout>[4]) {
  await assertMtls(headers);
  const shop = shopDomain(headers.get("shopify-shop-domain"));
  const body = paymentSessionRequest.parse(raw);
  const existing = await db.shopifyPaymentSession.findUnique({ where: { id: body.id } });
  const record = await db.shopifyShop.findUnique({ where: { shop } });
  if (!record?.orgId || !record.ready || record.uninstalledAt) throw new PortalError("SHOPIFY_SHOP_NOT_CONNECTED", 409);
  if (body.kind !== "sale") throw new PortalError("SHOPIFY_AUTHORIZATION_NOT_SUPPORTED", 422);
  // Shopify test mode is PayRouta sandbox; never mix the two.
  if (body.test !== (record.environment === "sandbox")) throw new PortalError("SHOPIFY_TEST_MODE_MISMATCH", 409);
  const key = keyFor(shop, body.id);
  if (existing) {
    if (existing.shop !== shop) throw new PortalError("IDEMPOTENCY_CONFLICT", 409);
    const path = await universalCheckoutPath(record.orgId, record.environment, existing.checkoutKey);
    if (!path) throw new PortalError("SHOPIFY_SESSION_UNAVAILABLE", 409);
    return { redirect_url: `${origin()}${path}` };
  }
  const locale = body.customer?.locale?.match(/[-_]([A-Z]{2})$/)?.[1];
  const payerCountry = body.customer?.billing_address?.country_code ?? body.customer?.shipping_address?.country_code ?? locale;
  if (!payerCountry) throw new PortalError("SHOPIFY_BUYER_COUNTRY_REQUIRED", 422);
  const crypto = body.currency === "USD" ? (record.cryptoOptions as { network: string; identifier: string }[]) : [];
  const checkout = await createUniversalCheckout(
    record.orgId,
    record.environment,
    key,
    {
      reference: `Shopify ${body.group}`.slice(0, 100),
      payerCountry,
      amount: shopifyAmount(body.amount, body.currency),
      currency: body.currency,
      methods: record.methods as string[],
      ...(crypto.length ? { crypto: { options: crypto } } : {}),
      returnUrl: `${origin()}/api/integrations/shopify/return?session=${encodeURIComponent(body.id)}`,
      metadata: {
        shopify_shop: shop,
        shopify_payment: body.id.slice(0, 200),
        ...(body.customer?.email ? { payer_email: body.customer.email.slice(0, 200) } : {}),
      },
    },
    ...(prices ? [prices] : []),
  );
  await db.shopifyPaymentSession.create({
    data: {
      id: body.id,
      gid: body.gid,
      shop,
      checkoutGroup: checkout.id,
      amount: body.amount,
      currency: body.currency,
      test: body.test,
      cancelUrl: body.payment_method.data.cancel_url,
      checkoutKey: key,
    },
  });
  return { redirect_url: `${origin()}${checkout.checkoutPath}` };
}

// Worker job (payment-shopify-resolve): a payment in this checkout group was
// confirmed, so the Shopify session is resolved. Idempotent at Shopify too.
export async function resolveGroup(checkoutGroup: string, http: Http = providerRequest) {
  const session = await db.shopifyPaymentSession.findUnique({ where: { checkoutGroup } });
  if (!session || session.state === "Resolved") return session;
  const confirmed = await db.paymentIntent.count({ where: { checkoutGroup, state: "Confirmed" } });
  if (!confirmed) return session;
  const data = await graphql<{
    paymentSessionResolve: UserErrors & {
      paymentSession: { state?: { code?: string }; nextAction?: { action?: string; context?: { redirectUrl?: string } } } | null;
    };
  }>(
    session.shop,
    `mutation Resolve($id: ID!) {
      paymentSessionResolve(id: $id) {
        paymentSession {
          state { ... on PaymentSessionStateResolved { code } }
          nextAction { action context { ... on PaymentSessionActionsRedirect { redirectUrl } } }
        }
        userErrors { field message }
      }
    }`,
    { id: session.gid },
    http,
  );
  const result = data.paymentSessionResolve;
  if (result.userErrors.length || !result.paymentSession) throw new PortalError("SHOPIFY_RESOLVE_FAILED", 502);
  return db.shopifyPaymentSession.update({
    where: { id: session.id },
    data: { state: "Resolved", resolvedAt: new Date(), nextActionUrl: result.paymentSession.nextAction?.context?.redirectUrl ?? null },
  });
}

// Where a buyer returning from PayRouta checkout goes: Shopify's order page
// once resolved, back to the unfinished checkout while a payment is still
// being confirmed, otherwise back to Shopify checkout to choose again.
export async function returnDestination(sessionId: string, http: Http = providerRequest) {
  let session = await db.shopifyPaymentSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new PortalError("NOT_FOUND", 404);
  const intents = await db.paymentIntent.findMany({ where: { checkoutGroup: session.checkoutGroup } });
  if (intents.some((i) => i.state === "Confirmed") && session.state !== "Resolved")
    session = (await resolveGroup(session.checkoutGroup, http).catch(() => session)) ?? session;
  if (session.state === "Resolved" && session.nextActionUrl) return session.nextActionUrl;
  if (intents.some((i) => i.state === "Processing")) {
    const shop = await db.shopifyShop.findUnique({ where: { shop: session.shop } });
    const path = shop?.orgId ? await universalCheckoutPath(shop.orgId, shop.environment, session.checkoutKey) : null;
    if (path) return `${origin()}${path}`;
  }
  return session.cancelUrl;
}

// --- Refund sessions ---------------------------------------------------------

export const refundSessionRequest = z
  .object({
    id: z.string().min(1).max(200),
    gid: z.string().startsWith("gid://shopify/RefundSession/").max(300),
    payment_id: z.string().min(1).max(200),
    amount: z.union([z.string(), z.number()]).transform(String),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .passthrough();

export async function startRefundSession(headers: Headers, raw: unknown) {
  await assertMtls(headers);
  const shop = shopDomain(headers.get("shopify-shop-domain"));
  const body = refundSessionRequest.parse(raw);
  const record = await db.shopifyShop.findUnique({ where: { shop } });
  if (!record?.orgId) throw new PortalError("SHOPIFY_SHOP_NOT_CONNECTED", 409);
  await atomic(async (tx) => {
    await tx.shopifyRefundSession.upsert({
      where: { id: body.id },
      create: { id: body.id, gid: body.gid, shop, paymentId: body.payment_id, amount: body.amount, currency: body.currency },
      update: {},
    });
    await queue(tx, record.orgId!, "payment-shopify-refund", `shopify-refund:${body.id}`, { refundSessionId: body.id });
  });
}

// Worker job (payment-shopify-refund): refunds a card/bank/credit payment on
// PayRouta's rails and reports the outcome to Shopify. Crypto payments are
// refunded by the merchant from their own wallet, so Shopify is told so.
export async function processRefund(refundSessionId: string, http: Http = providerRequest) {
  const r = await db.shopifyRefundSession.findUniqueOrThrow({ where: { id: refundSessionId } });
  if (r.state !== "Pending") return r;
  const payment = await db.shopifyPaymentSession.findUnique({ where: { id: r.paymentId } });
  const shop = await db.shopifyShop.findUnique({ where: { shop: r.shop } });
  const paid = payment
    ? await db.paymentIntent.findFirst({ where: { checkoutGroup: payment.checkoutGroup, state: "Confirmed" } })
    : null;
  const reject = async (message: string) => {
    await graphql<{ refundSessionReject: UserErrors }>(
      r.shop,
      `mutation Reject($id: ID!, $reason: RefundSessionRejectionReasonInput!) {
        refundSessionReject(id: $id, reason: $reason) { userErrors { field message } }
      }`,
      { id: r.gid, reason: { code: "PROCESSING_ERROR", merchantMessage: message } },
      http,
    );
    return db.shopifyRefundSession.update({ where: { id: r.id }, data: { state: "Rejected" } });
  };
  if (!paid || !shop?.orgId) return reject("PayRouta could not find a confirmed payment for this order.");
  if ((paid.asset as { kind?: string }).kind !== "fiat")
    return reject("This order was paid in crypto. Refund the customer from your own wallet, then mark the refund in Shopify.");
  let refundId = r.refundId;
  if (!refundId) {
    const amountMinor = BigInt(shopifyAmount(r.amount, r.currency).replace(".", ""));
    const refund = await atomic((tx) =>
      requestRefund(tx, { orgId: shop.orgId!, environment: shop.environment, intentId: paid.id, amountMinor, reason: "Shopify refund", initiatedBy: "shopify", now: new Date() }),
    ).catch((e: unknown) => e as Error);
    if (refund instanceof Error) return reject(`PayRouta could not refund this payment (${refund.message}).`);
    refundId = refund.id;
    await db.shopifyRefundSession.update({ where: { id: r.id }, data: { refundId } });
  }
  const state = (await db.platformRefund.findUniqueOrThrow({ where: { id: refundId } })).state;
  if (state === "Failed") return reject("The refund failed at the payment provider.");
  // Still with the provider: the job retries until it settles.
  if (state !== "Succeeded") throw new PortalError("SHOPIFY_REFUND_PENDING", 409);
  const data = await graphql<{ refundSessionResolve: UserErrors }>(
    r.shop,
    `mutation Resolve($id: ID!) { refundSessionResolve(id: $id) { userErrors { field message } } }`,
    { id: r.gid },
    http,
  );
  if (data.refundSessionResolve.userErrors.length) throw new PortalError("SHOPIFY_RESOLVE_FAILED", 502);
  return db.shopifyRefundSession.update({ where: { id: r.id }, data: { state: "Resolved" } });
}

// --- Webhooks ------------------------------------------------------------------

export async function handleWebhook(topic: string | null, shopHeader: string | null, raw: string, hmac: string | null) {
  if (!verifyWebhookHmac(raw, hmac, await appSecret())) throw new PortalError("SHOPIFY_HMAC_INVALID", 401);
  const shop = shopDomain(shopHeader);
  if (topic === "app/uninstalled" || topic === "shop/redact") {
    const record = await db.shopifyShop.findUnique({ where: { shop } });
    // Shopify revokes the access token on uninstall; the shop must
    // reinstall (and be marked ready again) to take payments.
    if (record) await db.shopifyShop.update({ where: { shop }, data: { uninstalledAt: new Date(), ready: false } });
  }
  // customers/data_request and customers/redact: PayRouta keeps no Shopify
  // customer records beyond the payer email in payment metadata, which the
  // merchant can export or erase from the PayRouta dashboard.
  return { ok: true };
}
