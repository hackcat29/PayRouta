import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { PayRouta, PayRoutaError, verifyWebhook } from "../sdks/node/src/index";
import { openapi } from "../lib/merchant/contracts";
const options = {
  baseUrl: "http://127.0.0.1:3000/api/v1",
  secretKey: "pr_sandbox_test",
  environment: "sandbox" as const,
};
test("SDK never replays an uncertain write and preserves idempotency key", async () => {
  let calls = 0;
  const sdk = new PayRouta({
    ...options,
    transport: async (_u, init) => {
      calls++;
      assert.equal(
        (init?.headers as Record<string, string>)["Idempotency-Key"],
        "same-key",
      );
      throw new Error("timeout");
    },
  });
  await assert.rejects(
    sdk.createCheckoutSession("intent", "same-key"),
    (e: unknown) =>
      e instanceof PayRoutaError && e.uncertain && e.code === "TRANSPORT_ERROR",
  );
  assert.equal(calls, 1);
});
test("SDK bounded reads honor retry hint and preserve exact amounts", async () => {
  let calls = 0;
  const waits: number[] = [];
  const sdk = new PayRouta({
    ...options,
    sleep: async (ms) => {
      waits.push(ms);
    },
    transport: async () =>
      ++calls < 3
        ? new Response("{}", { status: 503, headers: { "Retry-After": "2" } })
        : Response.json({ amount: "9007199254740993.01" }),
  });
  const value = await sdk.getPayment("test");
  assert.equal(value.amount, "9007199254740993.01");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 2000]);
});
test("SDK structured errors include request ID and forbid alternate origins", async () => {
  const sdk = new PayRouta({
    ...options,
    transport: async () =>
      Response.json(
        { error: { code: "FORBIDDEN" } },
        { status: 403, headers: { "X-Request-Id": "req1" } },
      ),
  });
  await assert.rejects(
    sdk.getPayment("test"),
    (e: unknown) =>
      e instanceof PayRoutaError && e.requestId === "req1" && e.status === 403,
  );
  await assert.rejects(sdk.request("GET", "https://evil.example"));
  assert.throws(() => new PayRouta({ ...options, environment: "production" }));
});
test("SDK verifies raw bytes, rotation key ID, timestamp, and event identity", () => {
  const raw = Buffer.from('{"text":"é", "state":"Confirmed"}');
  const timestamp = "1700000000";
  const headers = {
    "payrouta-timestamp": timestamp,
    "payrouta-event-id": "evt",
    "payrouta-key-id": "old",
    "payrouta-signature": createHmac("sha256", "secret")
      .update(`${timestamp}.evt.`)
      .update(raw)
      .digest("hex"),
  };
  assert.equal(
    verifyWebhook(raw, headers, { old: "secret", current: "new" }, 1700000000),
    true,
  );
  assert.equal(
    verifyWebhook(raw, headers, { current: "new" }, 1700000000),
    false,
  );
  assert.equal(
    verifyWebhook(
      Buffer.from(JSON.stringify(JSON.parse(raw.toString()))),
      headers,
      { old: "secret" },
      1700000000,
    ),
    false,
  );
  assert.equal(
    verifyWebhook(raw, headers, { old: "secret" }, 1700000301),
    false,
  );
});
test("OpenAPI request schema comes from runtime validation", () => {
  const schema = openapi();
  assert.equal(schema.openapi, "3.1.0");
  const text = JSON.stringify(schema.paths["/payment-intents"]);
  assert.ok(text.includes('"additionalProperties":false'));
  assert.ok(text.includes('"amount"'));
});
test("CSV neutralizes formula prefixes including whitespace and quotes", async () => {
  const { csvCell } = await import("../lib/merchant/csv");
  assert.equal(csvCell("  =SUM(A1:A2)"), '"\'  =SUM(A1:A2)"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell("100.00"), '"100.00"');
});
