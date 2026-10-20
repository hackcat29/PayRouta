// Shopify payments app end to end against the local database, with a fake
// Shopify GraphQL endpoint: Shopify opens a payment session, the buyer pays
// by card on PayRouta checkout, the confirmation queues a resolve job, and
// the buyer returns to Shopify's order page.
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.PAYMENT_TEST_LEGACY_METHODS;
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { secretManager } from "../../lib/portal/adapters";
import { enforceLaunchScope } from "../../lib/payments/launch";
import { confirm, customerAction, methods, selectMethod } from "../../lib/payments/service";
import { dispatch, poll } from "../../lib/payments/processing";
import { resolveGroup, returnDestination, startPaymentSession, type Http } from "../../lib/integrations/shopify";
import { liveMerchant, sandboxEntity } from "../fixtures/live-merchant";

let orgId: string;
let shop: string;
let proxySecret: string;

before(async () => {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") || process.env.PORTAL_MODE !== "local")
    throw new Error("Requires isolated local fixtures");
  assert.equal(enforceLaunchScope(), true);
  const { entityId, accounts } = await sandboxEntity("Shopify", ["sandbox-platform"]);
  orgId = await liveMerchant(entityId, [accounts["sandbox-platform"]], "USD");
  shop = `test-${randomUUID().slice(0, 8)}.myshopify.com`;
  proxySecret = randomBytes(24).toString("hex");
  process.env.SHOPIFY_MTLS_PROXY_SECRET_REF = await secretManager.put(proxySecret);
  await db.shopifyShop.create({
    data: {
      shop,
      orgId,
      environment: "sandbox",
      accessTokenRef: await secretManager.put("shpat_fictional_token"),
      scopes: "write_payment_gateways,write_payment_sessions",
      methods: ["card"],
      cryptoOptions: [],
      ready: true,
    },
  });
});
after(() => db.$disconnect());

const headers = (over: Record<string, string> = {}) =>
  new Headers({
    "shopify-shop-domain": shop,
    "shopify-request-id": randomUUID(),
    "shopify-api-version": "2026-10",
    "x-payrouta-client-verify": "SUCCESS",
    "x-payrouta-proxy-secret": proxySecret,
    ...over,
  });
const sessionBody = (id = randomUUID().replace(/-/g, "")) => ({
  id,
  gid: `gid://shopify/PaymentSession/${id}`,
  group: `grp${id.slice(0, 10)}`,
  amount: "25.00",
  currency: "USD",
  test: true,
  kind: "sale",
  customer: { email: "buyer@example.com", locale: "en-GB", billing_address: { country_code: "GB" } },
  payment_method: { type: "offsite", data: { cancel_url: `https://${shop}/checkouts/cancel` } },
});

test("shopify: a payment session opens PayRouta checkout and resolves once paid", async () => {
  const body = sessionBody();
  const { redirect_url } = await startPaymentSession(headers(), body);
  const checkout = new URL(redirect_url);
  assert.equal(checkout.pathname.startsWith("/checkout/"), true);
  // Shopify retries are idempotent.
  assert.equal((await startPaymentSession(headers(), body)).redirect_url, redirect_url);
  const stored = await db.shopifyPaymentSession.findUniqueOrThrow({ where: { id: body.id } });
  // The bearer link is never stored in the integration table.
  assert.ok(!JSON.stringify(stored).includes(checkout.hash.slice(1)));

  // Not yet paid: the buyer goes back to Shopify checkout.
  assert.equal(await returnDestination(body.id), body.payment_method.data.cancel_url);

  const id = checkout.pathname.split("/")[2];
  const token = checkout.hash.slice(1);
  await methods(id, token);
  const route = await selectMethod(id, token, "card");
  const { attemptId } = await confirm(id, token, route.routeId);
  await dispatch(attemptId!);
  await customerAction(id, token);
  await poll(attemptId!);
  const job = await db.job.findUnique({ where: { key: `shopify-resolve:${stored.checkoutGroup}` } });
  assert.ok(job, "confirmation queues the Shopify resolve");

  const calls: string[] = [];
  const http: Http = async (base, o) => {
    calls.push(`${base}${o.path}`);
    assert.equal(o.headers?.["X-Shopify-Access-Token"], "shpat_fictional_token");
    const q = JSON.parse(o.body!);
    assert.match(q.query, /paymentSessionResolve/);
    assert.equal(q.variables.id, body.gid);
    return {
      status: 200,
      headers: {},
      bytes: 0,
      body: JSON.stringify({
        data: {
          paymentSessionResolve: {
            paymentSession: { state: { code: "RESOLVED" }, nextAction: { action: "REDIRECT", context: { redirectUrl: `https://${shop}/orders/1` } } },
            userErrors: [],
          },
        },
      }),
    };
  };
  await resolveGroup(stored.checkoutGroup, http);
  assert.deepEqual(calls, [`https://${shop}/payments_apps/api/2026-10/graphql.json`]);
  await resolveGroup(stored.checkoutGroup, http);
  assert.equal(calls.length, 1, "resolved once");
  assert.equal(await returnDestination(body.id), `https://${shop}/orders/1`);
});

test("shopify: refuses requests that did not pass mutual TLS, test-mode mismatches and authorizations", async () => {
  await assert.rejects(startPaymentSession(headers({ "x-payrouta-client-verify": "FAILED:unknown" }), sessionBody()), /SHOPIFY_CLIENT_CERTIFICATE_REQUIRED/);
  await assert.rejects(startPaymentSession(headers({ "x-payrouta-proxy-secret": "guess" }), sessionBody()), /SHOPIFY_CLIENT_CERTIFICATE_REQUIRED/);
  await assert.rejects(startPaymentSession(headers(), { ...sessionBody(), test: false }), /SHOPIFY_TEST_MODE_MISMATCH/);
  await assert.rejects(startPaymentSession(headers(), { ...sessionBody(), kind: "authorization" }), /SHOPIFY_AUTHORIZATION_NOT_SUPPORTED/);
  await assert.rejects(startPaymentSession(headers({ "shopify-shop-domain": "unknown-shop.myshopify.com" }), sessionBody()), /SHOPIFY_SHOP_NOT_CONNECTED/);
});
