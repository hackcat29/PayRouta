import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { gatewayMatches, liteInstallUrl, liteSettings, payRequest, verifySessionToken } from "../lib/integrations/shopify-lite";

const secret = "hush-shopify-lite-secret";
process.env.SHOPIFY_LITE_API_KEY = "lite-client-id";
process.env.BETTER_AUTH_URL = "https://pay.example";

export function sessionToken(claims: Record<string, unknown>, key = secret, alg = "HS256") {
  const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const body = `${part({ alg, typ: "JWT" })}.${part(claims)}`;
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

const now = 1_800_000_000_000;
const claims = { dest: "example.myshopify.com", aud: "lite-client-id", exp: now / 1000 + 300, nbf: now / 1000 - 1, iat: now / 1000 - 1, jti: "j1" };

test("shopify lite: session tokens prove the shop, for this app, until they expire", () => {
  assert.deepEqual(verifySessionToken(sessionToken(claims), secret, now), { shop: "example.myshopify.com", customer: undefined });
  assert.equal(verifySessionToken(sessionToken({ ...claims, dest: "https://example.myshopify.com", sub: "gid://shopify/Customer/7" }), secret, now).customer, "gid://shopify/Customer/7");
  for (const bad of [
    sessionToken(claims, "other-secret"),
    sessionToken(claims, secret, "none"),
    sessionToken({ ...claims, aud: "another-app" }),
    sessionToken({ ...claims, exp: now / 1000 - 60 }),
    sessionToken({ ...claims, nbf: now / 1000 + 60 }),
    sessionToken({ ...claims, dest: "evil.example" }),
    "a.b",
  ])
    assert.throws(() => verifySessionToken(bad, secret, now), /SHOPIFY_SESSION_TOKEN_INVALID|SHOPIFY_SHOP_INVALID/);
});

test("shopify lite: install asks only for order scopes and returns to the Lite callback", () => {
  const url = new URL(liteInstallUrl("example.myshopify.com", "s1"));
  assert.equal(url.searchParams.get("client_id"), "lite-client-id");
  assert.equal(url.searchParams.get("scope"), "read_orders,write_orders");
  assert.equal(url.searchParams.get("redirect_uri"), "https://pay.example/api/integrations/shopify-lite/callback");
});

test("shopify lite: the manual method is matched by name, settings and requests are bounded", () => {
  assert.equal(gatewayMatches(["PayRouta "], "payrouta"), true);
  assert.equal(gatewayMatches(["Cash on Delivery (COD)"], "PayRouta"), false);
  assert.deepEqual(liteSettings.parse({ gateway: " PayRouta ", cancelAfterHours: "48" }), { gateway: "PayRouta", cancelAfterHours: 48 });
  assert.throws(() => liteSettings.parse({ gateway: "PayRouta", cancelAfterHours: "1000" }));
  assert.throws(() => payRequest.parse({ order: "gid://shopify/Customer/1" }));
  assert.equal(payRequest.parse({ order: "gid://shopify/Order/5", country: "NG" }).country, "NG");
});
