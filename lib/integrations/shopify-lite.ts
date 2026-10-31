// PayRouta for Shopify with a manual payment method, see docs/shopify.md and
// integrations/shopify-lite. It needs no Payments Partner approval: the
// merchant adds a manual payment method named after PayRouta, and the buyer
// pays from a Pay now button on the Thank you and order status pages
// (a checkout UI extension). The button asks PayRouta for a checkout with the
// order's session token; PayRouta reads the order through the Admin API,
// opens a universal checkout for what is outstanding, marks the order paid
// once the payment is confirmed (orderMarkAsPaid), and cancels orders left
// unpaid past the shop's deadline (orderCancel).
//
// It is a separate Shopify app from the payments app (./shopify.ts), with its
// own client ID and secret, and the scopes read_orders and write_orders.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { secretManager } from "../portal/adapters";
import { providerRequest } from "../providers/adapters/http";
import { fiatPaymentMethodIds } from "../providers/normalized";
import { createUniversalCheckout, universalCheckoutPath } from "../payments/universal";
import { apiVersion, shopDomain, shopifyAmount, verifyQueryHmac, verifyWebhookHmac, type Http } from "./shopify";
export { newState } from "./shopify";

export const liteScopes = "read_orders,write_orders";
export const liteMethods = ["card", "digital-wallet", "bank-transfer", "mobile-money", "ussd", "bnpl"];

function origin() {
  const value = process.env.BETTER_AUTH_URL;
  if (!value) throw new PortalError("PORTAL_ORIGIN_NOT_CONFIGURED", 503);
  return new URL(value).origin;
}

async function appSecret() {
  const ref = process.env.SHOPIFY_LITE_API_SECRET_REF;
  if (!ref || !process.env.SHOPIFY_LITE_API_KEY) throw new PortalError("SHOPIFY_NOT_CONFIGURED", 503);
  return secretManager.get(ref);
}

const equal = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// The manual payment method's name, as orders list it in paymentGatewayNames.
export const gatewayMatches = (names: string[], gateway: string) =>
  names.some((n) => n.trim().toLowerCase() === gateway.trim().toLowerCase());

// --- Install (OAuth) -------------------------------------------------------

export const liteSettings = z.object({
  gateway: z.string().trim().min(1).max(100),
  // Hours an unpaid order stays open; 0 never cancels.
  cancelAfterHours: z.coerce.number().int().min(0).max(720),
});

export function liteInstallUrl(shop: string, state: string) {
  const url = new URL(`https://${shopDomain(shop)}/admin/oauth/authorize`);
  url.searchParams.set("client_id", process.env.SHOPIFY_LITE_API_KEY ?? "");
  url.searchParams.set("scope", liteScopes);
  url.searchParams.set("redirect_uri", `${origin()}/api/integrations/shopify-lite/callback`);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function completeLiteInstall(
  params: URLSearchParams,
  pending: { state?: string; shop?: string; orgId: string; environment: "sandbox" | "production"; settings: z.infer<typeof liteSettings> },
  http: Http = providerRequest,
) {
  const secret = await appSecret();
  if (!verifyQueryHmac(params, secret)) throw new PortalError("SHOPIFY_HMAC_INVALID", 401);
  if (!pending.state || !equal(params.get("state") ?? "", pending.state)) throw new PortalError("SHOPIFY_STATE_INVALID", 401);
  const shop = shopDomain(params.get("shop"));
  if (pending.shop !== shop) throw new PortalError("SHOPIFY_STATE_INVALID", 401);
  const code = params.get("code");
  if (!code || !/^[A-Za-z0-9_-]{8,200}$/.test(code)) throw new PortalError("SHOPIFY_CODE_INVALID", 400);
  const response = await http(`https://${shop}`, {
    method: "POST",
    path: "/admin/oauth/access_token",
    body: JSON.stringify({ client_id: process.env.SHOPIFY_LITE_API_KEY, client_secret: secret, code }),
    timeoutMs: 10000,
  });
  const parsed = z
    .object({ access_token: z.string().min(10).max(500), scope: z.string().max(1000) })
    .safeParse(response.status === 200 ? JSON.parse(response.body) : null);
  if (!parsed.success) throw new PortalError("SHOPIFY_TOKEN_EXCHANGE_FAILED", 502);
  const granted = parsed.data.scope.split(",");
  // write_orders implies read_orders, and Shopify may report only the former.
  if (!granted.includes("write_orders")) throw new PortalError("SHOPIFY_SCOPES_MISSING", 409);
  const accessTokenRef = await secretManager.put(parsed.data.access_token);
  const settings = liteSettings.parse(pending.settings);
  const data = { orgId: pending.orgId, environment: pending.environment, accessTokenRef, scopes: parsed.data.scope, ...settings };
  await db.shopifyLiteShop.upsert({
    where: { shop },
    create: { shop, ...data, methods: liteMethods, cryptoOptions: [] },
    update: { ...data, uninstalledAt: null },
  });
  return shop;
}

// --- Admin GraphQL -----------------------------------------------------------

async function admin<T>(shop: string, query: string, variables: Record<string, unknown>, http: Http) {
  const record = await db.shopifyLiteShop.findUnique({ where: { shop } });
  if (!record || record.uninstalledAt) throw new PortalError("SHOPIFY_SHOP_NOT_INSTALLED", 409);
  const token = await secretManager.get(record.accessTokenRef);
  const response = await http(`https://${shop}`, {
    method: "POST",
    path: `/admin/api/${apiVersion()}/graphql.json`,
    headers: { "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    timeoutMs: 10000,
    maxResponseBytes: 262144,
  });
  if (response.status !== 200) throw new PortalError("SHOPIFY_UNAVAILABLE", 503);
  const body = JSON.parse(response.body) as { data?: T; errors?: unknown };
  if (!body.data) throw new PortalError("SHOPIFY_GRAPHQL_ERROR", 502);
  return body.data;
}

const money = z.object({ amount: z.string(), currencyCode: z.string().regex(/^[A-Z]{3}$/) });
const shopifyOrder = z.object({
  id: z.string().startsWith("gid://shopify/Order/"),
  name: z.string().max(100),
  test: z.boolean(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  displayFinancialStatus: z.string().nullable(),
  paymentGatewayNames: z.array(z.string()),
  statusPageUrl: z.url(),
  customer: z.object({ id: z.string() }).nullable().optional(),
  totalOutstandingSet: z.object({ presentmentMoney: money }),
});
export type ShopifyOrder = z.infer<typeof shopifyOrder>;

const orderQuery = `query Order($id: ID!) {
  order(id: $id) {
    id name test createdAt cancelledAt displayFinancialStatus paymentGatewayNames statusPageUrl
    customer { id }
    totalOutstandingSet { presentmentMoney { amount currencyCode } }
  }
  shop { billingAddress { countryCodeV2 } plan { partnerDevelopment } }
}`;

async function readOrder(shop: string, id: string, http: Http) {
  const data = await admin<{
    order: unknown;
    shop: { billingAddress?: { countryCodeV2?: string | null } | null; plan?: { partnerDevelopment?: boolean } | null };
  }>(shop, orderQuery, { id }, http);
  if (!data.order) throw new PortalError("SHOPIFY_ORDER_NOT_FOUND", 404);
  return {
    order: shopifyOrder.parse(data.order),
    shopCountry: data.shop.billingAddress?.countryCodeV2 ?? null,
    devStore: data.shop.plan?.partnerDevelopment === true,
  };
}

// Manual-method orders are never Shopify test orders, so a sandbox
// connection takes test orders or any order from a development store; a
// live connection takes only real orders from a real store.
export const modeMatches = (environment: string, order: { test: boolean }, devStore: boolean) =>
  environment === "sandbox" ? order.test || devStore : !order.test && !devStore;

type UserErrors = { userErrors: { field?: string[] | null; message: string }[] };

// --- Pay now -------------------------------------------------------------------

// Session tokens from checkout and customer account UI extensions: HS256
// JWTs signed with the app secret, valid for five minutes.
const decode = (part: string) => {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString());
  } catch {
    return null;
  }
};

export function verifySessionToken(token: string, secret: string, now = Date.now()) {
  const [header, payload, signature, extra] = token.split(".");
  if (!header || !payload || !signature || extra !== undefined) throw new PortalError("SHOPIFY_SESSION_TOKEN_INVALID", 401);
  const alg = z.object({ alg: z.literal("HS256") }).safeParse(decode(header));
  const expected = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  if (!alg.success || !equal(expected, signature)) throw new PortalError("SHOPIFY_SESSION_TOKEN_INVALID", 401);
  const claims = z
    .object({ dest: z.string(), aud: z.string(), exp: z.number(), nbf: z.number().optional(), sub: z.string().optional() })
    .safeParse(decode(payload));
  const seconds = now / 1000;
  if (!claims.success || claims.data.aud !== process.env.SHOPIFY_LITE_API_KEY || claims.data.exp < seconds - 5 || (claims.data.nbf ?? 0) > seconds + 5)
    throw new PortalError("SHOPIFY_SESSION_TOKEN_INVALID", 401);
  return { shop: shopDomain(claims.data.dest.replace(/^https:\/\//, "")), customer: claims.data.sub };
}

export const payRequest = z.object({
  order: z.string().regex(/^gid:\/\/shopify\/Order\/\d{1,20}$/),
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
});

const keyFor = (shop: string, order: string) => `shl-${createHash("sha256").update(`${shop}:${order}`).digest("hex").slice(0, 40)}`;

// Records an order placed with the PayRouta manual payment method, and
// schedules its cancellation if it stays unpaid.
async function track(shop: { shop: string; orgId: string; cancelAfterHours: number }, order: ShopifyOrder) {
  const row = await db.shopifyLiteOrder.upsert({
    where: { shop_orderId: { shop: shop.shop, orderId: order.id } },
    create: {
      shop: shop.shop,
      orderId: order.id,
      name: order.name,
      amount: order.totalOutstandingSet.presentmentMoney.amount,
      currency: order.totalOutstandingSet.presentmentMoney.currencyCode,
      test: order.test,
      statusUrl: order.statusPageUrl,
      placedAt: new Date(order.createdAt),
    },
    update: {},
  });
  if (shop.cancelAfterHours > 0)
    await db.job.upsert({
      where: { key: `shopify-lite-cancel:${row.id}` },
      create: {
        orgId: shop.orgId,
        kind: "payment-shopify-lite-cancel",
        key: `shopify-lite-cancel:${row.id}`,
        payload: { orderRowId: row.id },
        availableAt: new Date(row.placedAt.getTime() + shop.cancelAfterHours * 3600000),
      },
      update: {},
    });
  return row;
}

// POST /api/integrations/shopify-lite/pay from the Pay now button.
export async function payOrder(authorization: string | null, raw: unknown, http: Http = providerRequest, prices?: Parameters<typeof createUniversalCheckout>[4]) {
  const token = authorization?.match(/^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/)?.[1];
  if (!token) throw new PortalError("SHOPIFY_SESSION_TOKEN_INVALID", 401);
  const claims = verifySessionToken(token, await appSecret());
  const body = payRequest.parse(raw);
  const shop = await db.shopifyLiteShop.findUnique({ where: { shop: claims.shop } });
  if (!shop || shop.uninstalledAt) throw new PortalError("SHOPIFY_SHOP_NOT_CONNECTED", 409);
  const { order, shopCountry, devStore } = await readOrder(shop.shop, body.order, http);
  // A signed-in buyer may only pay their own order.
  if (claims.customer && order.customer && order.customer.id !== claims.customer) throw new PortalError("SHOPIFY_ORDER_NOT_FOUND", 404);
  if (!gatewayMatches(order.paymentGatewayNames, shop.gateway)) return { pay: false as const };
  if (!modeMatches(shop.environment, order, devStore)) throw new PortalError("SHOPIFY_TEST_MODE_MISMATCH", 409);
  const row = await track(shop, order);
  const outstanding = order.totalOutstandingSet.presentmentMoney;
  if (order.cancelledAt || row.state !== "Pending" || Number(outstanding.amount) <= 0) return { pay: false as const };
  // An order edited after its checkout opened is settled by the merchant.
  if (row.amount !== outstanding.amount || row.currency !== outstanding.currencyCode) throw new PortalError("SHOPIFY_ORDER_CHANGED", 409);
  const key = keyFor(shop.shop, order.id);
  if (row.checkoutKey) {
    const path = await universalCheckoutPath(shop.orgId, shop.environment, row.checkoutKey);
    if (path) return { pay: true as const, url: `${origin()}${path}`, amount: row.amount, currency: row.currency };
  }
  const payerCountry = body.country ?? shopCountry;
  if (!payerCountry) throw new PortalError("SHOPIFY_BUYER_COUNTRY_REQUIRED", 422);
  const crypto = row.currency === "USD" ? (shop.cryptoOptions as { network: string; identifier: string }[]) : [];
  const returnToken = row.returnToken ?? randomBytes(18).toString("base64url");
  if (!row.returnToken) await db.shopifyLiteOrder.update({ where: { id: row.id }, data: { returnToken } });
  const checkout = await createUniversalCheckout(
    shop.orgId,
    shop.environment,
    key,
    {
      reference: `Shopify ${order.name}`.slice(0, 100),
      payerCountry,
      amount: shopifyAmount(row.amount, row.currency),
      currency: row.currency,
      methods: (shop.methods as string[]).filter((m) => (fiatPaymentMethodIds as readonly string[]).includes(m)),
      ...(crypto.length ? { crypto: { options: crypto } } : {}),
      returnUrl: `${origin()}/api/integrations/shopify-lite/return?order=${returnToken}`,
      metadata: { shopify_shop: shop.shop, shopify_order: order.id },
    },
    ...(prices ? [prices] : []),
  );
  await db.shopifyLiteOrder.update({ where: { id: row.id }, data: { checkoutKey: key, checkoutGroup: checkout.id } });
  return { pay: true as const, url: `${origin()}${checkout.checkoutPath}`, amount: row.amount, currency: row.currency };
}

// Where PayRouta checkout returns the buyer: the order status page, once
// the order is marked paid if the payment is already confirmed.
export async function liteReturn(returnToken: string, http: Http = providerRequest) {
  const row = await db.shopifyLiteOrder.findUnique({ where: { returnToken } });
  if (!row) throw new PortalError("NOT_FOUND", 404);
  if (row.state === "Pending" && row.checkoutGroup) await markOrderPaid(row.checkoutGroup, http).catch(() => null);
  return row.statusUrl;
}

// --- Worker jobs -----------------------------------------------------------------

// payment-shopify-resolve, for a Lite order: a payment in the order's
// checkout group was confirmed, so the order is marked paid. Returns null
// when the group is not a Lite order.
export async function markOrderPaid(checkoutGroup: string, http: Http = providerRequest) {
  const row = await db.shopifyLiteOrder.findUnique({ where: { checkoutGroup } });
  if (!row || row.state === "Paid" || row.state === "Needs review") return row;
  if (!(await db.paymentIntent.count({ where: { checkoutGroup, state: "Confirmed" } }))) return row;
  const { order } = await readOrder(row.shop, row.orderId, http);
  const outstanding = order.totalOutstandingSet.presentmentMoney;
  if (Number(outstanding.amount) <= 0 && !order.cancelledAt)
    return db.shopifyLiteOrder.update({ where: { id: row.id }, data: { state: "Paid", paidAt: new Date() } });
  // Paid after cancellation, or the order changed: the merchant decides.
  if (order.cancelledAt || outstanding.amount !== row.amount || outstanding.currencyCode !== row.currency)
    return db.shopifyLiteOrder.update({ where: { id: row.id }, data: { state: "Needs review" } });
  const data = await admin<{ orderMarkAsPaid: UserErrors }>(
    row.shop,
    `mutation MarkPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) { order { id displayFinancialStatus } userErrors { field message } }
    }`,
    { input: { id: row.orderId } },
    http,
  );
  if (data.orderMarkAsPaid.userErrors.length) throw new PortalError("SHOPIFY_MARK_PAID_FAILED", 502);
  return db.shopifyLiteOrder.update({ where: { id: row.id }, data: { state: "Paid", paidAt: new Date() } });
}

// payment-shopify-lite-cancel: the shop's deadline passed. Cancels the order
// in Shopify unless it was paid, or a payment for it is still under way.
export async function cancelUnpaid(orderRowId: string, http: Http = providerRequest, now = new Date()) {
  const row = await db.shopifyLiteOrder.findUnique({ where: { id: orderRowId } });
  if (!row || row.state !== "Pending") return row;
  const shop = await db.shopifyLiteShop.findUnique({ where: { shop: row.shop } });
  if (!shop || shop.uninstalledAt) return row;
  const intents = row.checkoutGroup ? await db.paymentIntent.findMany({ where: { checkoutGroup: row.checkoutGroup } }) : [];
  if (intents.some((i) => i.state === "Confirmed")) return row;
  // A checkout that can still be paid, or a payment being confirmed, is
  // given until it ends.
  const live = intents.filter((i) => i.state === "Processing" || (i.state === "Open" && i.expiresAt > now));
  if (live.length) {
    const later = Math.max(now.getTime() + 3600000, ...live.map((i) => i.expiresAt.getTime() + 60000));
    await db.job.upsert({
      where: { key: `shopify-lite-cancel:${row.id}:${later}` },
      create: { orgId: shop.orgId, kind: "payment-shopify-lite-cancel", key: `shopify-lite-cancel:${row.id}:${later}`, payload: { orderRowId: row.id }, availableAt: new Date(later) },
      update: {},
    });
    return row;
  }
  const { order } = await readOrder(row.shop, row.orderId, http);
  if (order.cancelledAt) return db.shopifyLiteOrder.update({ where: { id: row.id }, data: { state: "Cancelled", cancelledAt: new Date(order.cancelledAt) } });
  // Paid some other way, or partly: left to the merchant.
  if (order.displayFinancialStatus !== "PENDING") return db.shopifyLiteOrder.update({ where: { id: row.id }, data: { state: "Closed" } });
  const data = await admin<{ orderCancel: { orderCancelUserErrors: { field?: string[] | null; message: string; code?: string }[] } }>(
    row.shop,
    `mutation Cancel($orderId: ID!, $reason: OrderCancelReason!, $restock: Boolean!, $notifyCustomer: Boolean, $refundMethod: OrderCancelRefundMethodInput, $staffNote: String) {
      orderCancel(orderId: $orderId, reason: $reason, restock: $restock, notifyCustomer: $notifyCustomer, refundMethod: $refundMethod, staffNote: $staffNote) {
        job { id }
        orderCancelUserErrors { field message code }
      }
    }`,
    {
      orderId: row.orderId,
      reason: "DECLINED",
      restock: true,
      notifyCustomer: true,
      refundMethod: { originalPaymentMethodsRefund: false },
      staffNote: `Not paid with PayRouta within ${shop.cancelAfterHours} hours`,
    },
    http,
  );
  if (data.orderCancel.orderCancelUserErrors.length) throw new PortalError("SHOPIFY_CANCEL_FAILED", 502);
  return db.shopifyLiteOrder.update({ where: { id: row.id }, data: { state: "Cancelled", cancelledAt: now } });
}

// --- Webhooks ------------------------------------------------------------------

const orderWebhook = z
  .object({ admin_graphql_api_id: z.string().startsWith("gid://shopify/Order/"), payment_gateway_names: z.array(z.string()).default([]) })
  .passthrough();

export async function handleLiteWebhook(topic: string | null, shopHeader: string | null, raw: string, hmac: string | null, http: Http = providerRequest) {
  if (!verifyWebhookHmac(raw, hmac, await appSecret())) throw new PortalError("SHOPIFY_HMAC_INVALID", 401);
  const domain = shopDomain(shopHeader);
  const shop = await db.shopifyLiteShop.findUnique({ where: { shop: domain } });
  if (topic === "orders/create" && shop && !shop.uninstalledAt) {
    const payload = orderWebhook.parse(JSON.parse(raw));
    // The webhook carries no buyer details; the order is read from the Admin API.
    if (gatewayMatches(payload.payment_gateway_names, shop.gateway)) {
      const { order, devStore } = await readOrder(domain, payload.admin_graphql_api_id, http);
      if (modeMatches(shop.environment, order, devStore) && !order.cancelledAt) await track(shop, order);
    }
  }
  if ((topic === "app/uninstalled" || topic === "shop/redact") && shop)
    await db.shopifyLiteShop.update({ where: { shop: domain }, data: { uninstalledAt: new Date() } });
  // customers/data_request and customers/redact: Lite orders hold no buyer
  // details, only the order ID, name and amount.
  return { ok: true };
}
