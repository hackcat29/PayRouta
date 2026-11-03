import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { turnstileHeader, verifyTurnstile } from "../lib/turnstile";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TURNSTILE_SECRET_KEY;
});
const request = (token?: string) =>
  new Request("https://payrouta.test/api/enquiries", {
    method: "POST",
    headers: token ? { [turnstileHeader]: token } : {},
  });
const cloudflare = (result: object, ok = true) => {
  const calls: URLSearchParams[] = [];
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.body as URLSearchParams);
    return new Response(JSON.stringify(result), { status: ok ? 200 : 500 });
  }) as typeof fetch;
  return calls;
};

test("without a secret key nothing is checked", async () => {
  assert.equal(await verifyTurnstile(request()), true);
});

test("a missing token is refused without calling Cloudflare", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  const calls = cloudflare({ success: true });
  assert.equal(await verifyTurnstile(request()), false);
  assert.equal(calls.length, 0);
});

test("a token Cloudflare accepts passes, and is sent with the secret", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  const calls = cloudflare({ success: true });
  assert.equal(await verifyTurnstile(request("token")), true);
  assert.equal(calls[0].get("secret"), "secret");
  assert.equal(calls[0].get("response"), "token");
});

test("a token Cloudflare rejects is refused", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  cloudflare({ success: false, "error-codes": ["invalid-input-response"] });
  assert.equal(await verifyTurnstile(request("bad")), false);
});

test("Cloudflare being unreachable is a refusal", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  globalThis.fetch = (async () => {
    throw new Error("network");
  }) as typeof fetch;
  assert.equal(await verifyTurnstile(request("token")), false);
  cloudflare({}, false);
  assert.equal(await verifyTurnstile(request("token")), false);
});
