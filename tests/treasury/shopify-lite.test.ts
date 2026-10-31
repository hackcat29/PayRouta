// Shopify with a manual payment method, end to end against the local
// database with a fake Shopify Admin API: the order webhook tracks the
// order, the Pay button opens PayRouta checkout, the buyer pays by card, the
// confirmation marks the order paid; an order left unpaid is cancelled.
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.PAYMENT_TEST_LEGACY_METHODS;
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { secretManager } from "../../lib/portal/adapters";
import { enforceLaunchScope } from "../../lib/payments/launch";
import { confirm, customerAction, methods, selectMethod } from "../../lib/payments/service";
import { dispatch, poll } from "../../lib/payments/processing";
import { paymentJob } from "../../lib/payments/jobs";
import { cancelUnpaid, handleLiteWebhook, liteReturn, markOrderPaid, payOrder } from "../../lib/integrations/shopify-lite";
import type { Http } from "../../lib/integrations/shopify";
import { liveMerchant, sandboxEntity } from "../fixtures/live-merchant";

const secret = "hush-shopify-lite-secret";
let orgId: string;
let shop: string;

before(async () => {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") || process.env.PORTAL_MODE !== "local")
    throw new Error("Requires isolated local fixtures");
  assert.equal(enforceLaunchScope(), true);
  const { entityId, accounts } = await sandboxEntity("Shopify Lite", ["sandbox-platform"]);
  orgId = await liveMerchant(entityId, [accounts["sandbox-platform"]], "USD");
  shop = `lite-${randomUUID().slice(0, 8)}.myshopify.com`;
  process.env.SHOPIFY_LITE_API_KEY = "lite-client-id";
  process.env.SHOPIFY_LITE_API_SECRET_REF = await secretManager.put(secret);
  await db.shopifyLiteShop.create({
    data: {
      shop,
      orgId,
      environment: "sandbox",
      accessTokenRef: await secretManager.put("shpat_fictional_lite"),
      scopes: "write_orders",
      gateway: "PayRouta",
      cancelAfterHours: 48,
      methods: ["card"],
      cryptoOptions: [],
    },
  });
});
after(() => db.$disconnect());

const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const bearer = (sub?: string) => {
  const s = Date.now() / 1000;
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ dest: shop, aud: "lite-client-id", exp: s + 300, nbf: s - 1, iat: s - 1, jti: randomUUID(), ...(sub ? { sub } : {}) })}`;
  return `Bearer ${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
};

// A fake Admin API holding one order per test.
function fakeShopify(order: Record<string, unknown>, devStore = false) {
  const calls: string[] = [];
  const http: Http = async (base, o) => {
    assert.equal(base, `https://${shop}`);
    assert.equal(o.path, "/admin/api/2026-10/graphql.json");
    assert.equal(o.headers?.["X-Shopify-Access-Token"], "shpat_fictional_lite");
    const { query, variables } = JSON.parse(o.body!);
    let data: unknown;
    if (/orderMarkAsPaid/.test(query)) {
      calls.push("markAsPaid");
      assert.deepEqual(variables, { input: { id: order.id } });
      Object.assign(order, { displayFinancialStatus: "PAID", totalOutstandingSet: { presentmentMoney: { amount: "0.00", currencyCode: "USD" } } });
      data = { orderMarkAsPaid: { order: { id: order.id, displayFinancialStatus: "PAID" }, userErrors: [] } };
    } else if (/orderCancel/.test(query)) {
      calls.push("cancel");
      assert.equal(variables.orderId, order.id);
      assert.equal(variables.restock, true);
      assert.equal(variables.notifyCustomer, true);
      Object.assign(order, { cancelledAt: new Date().toISOString() });
      data = { orderCancel: { job: { id: "gid://shopify/Job/1" }, orderCancelUserErrors: [] } };
    } else {
      calls.push("order");
      assert.equal(variables.id, order.id);
      data = { order, shop: { billingAddress: { countryCodeV2: "GB" }, plan: { partnerDevelopment: devStore } } };
    }
    return { status: 200, headers: {}, bytes: 0, body: JSON.stringify({ data }) };
  };
  return { http, calls };
}

const newOrder = (over: Record<string, unknown> = {}) => {
  const n = Math.floor(Math.random() * 1e12);
  return {
    id: `gid://shopify/Order/${n}`,
    name: `#${n % 10000}`,
    test: true,
    createdAt: new Date().toISOString(),
    cancelledAt: null,
    displayFinancialStatus: "PENDING",
    paymentGatewayNames: ["PayRouta"],
    statusPageUrl: `https://${shop}/1/orders/abc${n}/authenticate?key=k`,
    customer: { id: "gid://shopify/Customer/7" },
    totalOutstandingSet: { presentmentMoney: { amount: "25.00", currencyCode: "USD" } },
    ...over,
  };
};

const webhook = (order: { id: string; paymentGatewayNames: string[] }, http: Http) => {
  const raw = JSON.stringify({ id: Number(order.id.split("/").pop()), admin_graphql_api_id: order.id, payment_gateway_names: order.paymentGatewayNames, financial_status: "pending" });
  return handleLiteWebhook("orders/create", shop, raw, createHmac("sha256", secret).update(raw).digest("base64"), http);
};

test("shopify lite: the buyer pays from the Pay button and the order is marked paid", async () => {
  const order = newOrder();
  const { http, calls } = fakeShopify(order);
  await webhook(order, http);
  const row = await db.shopifyLiteOrder.findUniqueOrThrow({ where: { shop_orderId: { shop, orderId: order.id } } });
  assert.equal(row.amount, "25.00");
  const cancelJob = await db.job.findUniqueOrThrow({ where: { key: `shopify-lite-cancel:${row.id}` } });
  assert.equal(cancelJob.availableAt.getTime(), row.placedAt.getTime() + 48 * 3600000);

  const pay = await payOrder(bearer("gid://shopify/Customer/7"), { order: order.id, country: "GB" }, http);
  assert.equal(pay.pay, true);
  // The button asks again on every page view: same checkout.
  const again = await payOrder(bearer(), { order: order.id }, http);
  assert.equal(again.pay && again.url, pay.pay && pay.url);
  // Another signed-in customer can't open this order.
  await assert.rejects(payOrder(bearer("gid://shopify/Customer/8"), { order: order.id }, http), /SHOPIFY_ORDER_NOT_FOUND/);

  const checkout = new URL(pay.pay ? pay.url : "");
  const id = checkout.pathname.split("/")[2];
  const token = checkout.hash.slice(1);
  await methods(id, token);
  const route = await selectMethod(id, token, "card");
  const { attemptId } = await confirm(id, token, route.routeId);
  await dispatch(attemptId!);
  await customerAction(id, token);
  await poll(attemptId!);
  const stored = await db.shopifyLiteOrder.findUniqueOrThrow({ where: { id: row.id } });
  assert.ok(stored.checkoutGroup);
  assert.ok(!JSON.stringify(stored).includes(token), "the checkout link is not stored");
  const resolve = await db.job.findUniqueOrThrow({ where: { key: `shopify-resolve:${stored.checkoutGroup}` } });
  assert.equal(resolve.kind, "payment-shopify-resolve");

  // Checkout returns the buyer through PayRouta: the order is marked paid
  // and the buyer lands on Shopify's order status page.
  assert.equal(await liteReturn(stored.returnToken!, http), order.statusPageUrl);
  assert.equal((await db.shopifyLiteOrder.findUniqueOrThrow({ where: { id: row.id } })).state, "Paid");
  assert.equal(calls.filter((c) => c === "markAsPaid").length, 1);
  // The worker's resolve job finds it already done.
  await markOrderPaid(stored.checkoutGroup!, http);
  assert.equal(calls.filter((c) => c === "markAsPaid").length, 1, "marked paid once");
  // A paid order is never cancelled, and the button disappears.
  await cancelUnpaid(row.id, http);
  assert.equal(calls.includes("cancel"), false);
  assert.deepEqual(await payOrder(bearer(), { order: order.id }, http), { pay: false });
});

test("shopify lite: an order left unpaid is cancelled once its checkout has ended", async () => {
  const order = newOrder();
  const { http, calls } = fakeShopify(order);
  const pay = await payOrder(bearer(), { order: order.id, country: "GB" }, http);
  assert.equal(pay.pay, true);
  const row = await db.shopifyLiteOrder.findUniqueOrThrow({ where: { shop_orderId: { shop, orderId: order.id } } });
  // The checkout can still be paid: cancellation waits until it expires.
  await cancelUnpaid(row.id, http);
  assert.equal(calls.includes("cancel"), false);
  const later = await db.job.findMany({ where: { key: { startsWith: `shopify-lite-cancel:${row.id}:` } } });
  assert.equal(later.length, 1);
  const intents = await db.paymentIntent.findMany({ where: { checkoutGroup: row.checkoutGroup! } });
  const after = new Date(Math.max(...intents.map((i) => i.expiresAt.getTime())) + 1000);
  await cancelUnpaid(row.id, http, after);
  assert.deepEqual(calls.filter((c) => c === "cancel"), ["cancel"]);
  assert.equal((await db.shopifyLiteOrder.findUniqueOrThrow({ where: { id: row.id } })).state, "Cancelled");
  assert.deepEqual(await payOrder(bearer(), { order: order.id }, http), { pay: false });
});

test("shopify lite: other payment methods, test-mode mismatches and forged webhooks are ignored or refused", async () => {
  const cod = newOrder({ paymentGatewayNames: ["Cash on Delivery (COD)"] });
  const { http, calls } = fakeShopify(cod);
  await webhook(cod, http);
  assert.equal(calls.length, 0, "orders paid another way aren't read");
  assert.deepEqual(await payOrder(bearer(), { order: cod.id }, http), { pay: false });
  assert.equal(await db.shopifyLiteOrder.count({ where: { orderId: cod.id } }), 0);

  // A sandbox connection takes manual-method orders from a development
  // store, but not real orders from a real store.
  const dev = newOrder({ test: false });
  assert.equal((await payOrder(bearer(), { order: dev.id, country: "GB" }, fakeShopify(dev, true).http)).pay, true);
  const live = newOrder({ test: false });
  await assert.rejects(payOrder(bearer(), { order: live.id }, fakeShopify(live).http), /SHOPIFY_TEST_MODE_MISMATCH/);
  await assert.rejects(payOrder("Bearer x.y.z", { order: live.id }, http), /SHOPIFY_SESSION_TOKEN_INVALID/);
  await assert.rejects(handleLiteWebhook("orders/create", shop, "{}", "forged", http), /SHOPIFY_HMAC_INVALID/);

  // The worker routes a group that isn't a payments-app session to Lite.
  await paymentJob("payment-shopify-resolve", { checkoutGroup: "grp_unknown" });
});
