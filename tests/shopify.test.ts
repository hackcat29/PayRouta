import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  installUrl,
  paymentSessionRequest,
  shopDomain,
  shopifyAmount,
  verifyQueryHmac,
  verifyWebhookHmac,
} from "../lib/integrations/shopify";

const secret = "hush-shopify-app-secret";

test("shop domains are permanent myshopify.com domains only", () => {
  assert.equal(shopDomain("Example-Store.myshopify.com"), "example-store.myshopify.com");
  for (const bad of ["evil.com", "example.myshopify.com.evil.com", "https://example.myshopify.com", "", "-x.myshopify.com"])
    assert.throws(() => shopDomain(bad), /SHOPIFY_SHOP_INVALID/);
});

test("OAuth query HMAC: sorted parameters without hmac, hex SHA-256", () => {
  const params = new URLSearchParams({ shop: "example.myshopify.com", code: "abc123", state: "s1", timestamp: "1700000000" });
  const message = "code=abc123&shop=example.myshopify.com&state=s1&timestamp=1700000000";
  params.set("hmac", createHmac("sha256", secret).update(message).digest("hex"));
  assert.equal(verifyQueryHmac(params, secret), true);
  params.set("shop", "other.myshopify.com");
  assert.equal(verifyQueryHmac(params, secret), false);
  assert.equal(verifyQueryHmac(new URLSearchParams({ shop: "x" }), secret), false);
});

test("webhook HMAC: base64 SHA-256 of the raw body", () => {
  const raw = '{"shop_domain":"example.myshopify.com"}';
  const good = createHmac("sha256", secret).update(raw).digest("base64");
  assert.equal(verifyWebhookHmac(raw, good, secret), true);
  assert.equal(verifyWebhookHmac(raw + " ", good, secret), false);
  assert.equal(verifyWebhookHmac(raw, null, secret), false);
});

test("install asks only for the payments app scopes and returns to the callback", () => {
  process.env.SHOPIFY_API_KEY = "test-client-id";
  process.env.BETTER_AUTH_URL = "https://pay.example";
  const url = new URL(installUrl("example.myshopify.com", "state-1"));
  assert.equal(url.origin, "https://example.myshopify.com");
  assert.equal(url.pathname, "/admin/oauth/authorize");
  assert.equal(url.searchParams.get("scope"), "write_payment_gateways,write_payment_sessions");
  assert.equal(url.searchParams.get("redirect_uri"), "https://pay.example/api/integrations/shopify/callback");
  assert.equal(url.searchParams.get("state"), "state-1");
});

test("Shopify amounts are normalized to the currency's exponent and never rounded", () => {
  assert.equal(shopifyAmount("19.9", "USD"), "19.90");
  assert.equal(shopifyAmount("19.90", "USD"), "19.90");
  assert.equal(shopifyAmount("1500", "JPY"), "1500");
  assert.equal(shopifyAmount("45000.00", "NGN"), "45000.00");
  assert.throws(() => shopifyAmount("19.999", "USD"), /INVALID_AMOUNT/);
  assert.throws(() => shopifyAmount("-1", "USD"), /INVALID_AMOUNT/);
});

test("offsite payment session requests parse as Shopify documents them", () => {
  const parsed = paymentSessionRequest.parse({
    id: "u0nwmSrNntjIWozmNslK5Tlq",
    gid: "gid://shopify/PaymentSession/u0nwmSrNntjIWozmNslK5Tlq",
    group: "rZNOwrQ2BjqNHtWg31ga7vmd",
    session_id: "s1",
    amount: "123.00",
    currency: "NGN",
    test: true,
    merchant_locale: "en",
    proposed_at: "2026-10-20T12:00:00Z",
    kind: "sale",
    customer: { email: "buyer@example.com", locale: "en-NG", billing_address: { country_code: "NG" } },
    payment_method: { type: "offsite", data: { cancel_url: "https://example.myshopify.com/checkouts/c/1" } },
  });
  assert.equal(parsed.customer?.billing_address?.country_code, "NG");
  assert.throws(() => paymentSessionRequest.parse({ ...parsed, gid: "gid://shopify/Order/1" }));
});
