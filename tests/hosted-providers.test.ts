import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  HostedQualificationAdapter,
  verifyPaystack,
  verifyFlutterwaveV3,
} from "../lib/payments/providers/hosted";
const input = {
  reference: "order-1234",
  amount: "100.00",
  method: "card" as const,
  email: "fixture@example.test",
  callbackUrl: "https://merchant.example.test/return",
};
test("Paystack initialization is method-specific and acceptance is not confirmation", async () => {
  const adapter = new HostedQualificationAdapter(
    "paystack",
    {
      secret: "sk_test_fixture",
      accountId: "123",
      channelRestrictionVerified: true,
    },
    async (url, _secret, body) => {
      assert.equal(url, "https://api.paystack.co/transaction/initialize");
      assert.deepEqual((body as { channels: string[] }).channels, ["card"]);
      assert.equal((body as { amount: string }).amount, "10000");
      return {
        status: 200,
        body: {
          status: true,
          data: {
            reference: input.reference,
            authorization_url: "https://checkout.paystack.com/fixture",
          },
        },
      };
    },
  );
  assert.equal((await adapter.initialize(input)).state, "Requires action");
});
test("Paystack verification rejects selected-method, amount, and environment mismatch", async () => {
  const data = {
    reference: input.reference,
    currency: "NGN",
    amount: 10000,
    status: "success",
    channel: "card",
    domain: "test",
  };
  const adapter = new HostedQualificationAdapter(
    "paystack",
    {
      secret: "sk_test_fixture",
      accountId: "123",
      channelRestrictionVerified: true,
    },
    async () => ({ status: 200, body: { status: true, data } }),
  );
  assert.equal((await adapter.status(input)).state, "Confirmed");
  data.channel = "bank_transfer";
  await assert.rejects(adapter.status(input), /METHOD_MISMATCH/);
  data.channel = "card";
  data.amount = 10001;
  await assert.rejects(adapter.status(input), /AMOUNT_MISMATCH/);
  data.amount = 10000;
  data.domain = "live";
  await assert.rejects(adapter.status(input), /ENVIRONMENT_MISMATCH/);
});
test("Flutterwave account binding and dashboard channel setting fail closed", async () => {
  assert.throws(
    () =>
      new HostedQualificationAdapter("flutterwave-v3", {
        secret: "FLWSECK_TEST-fixture",
        accountId: "123",
        channelRestrictionVerified: false,
      }),
  );
  const data = {
    tx_ref: input.reference,
    amount: "100.00",
    currency: "NGN",
    account_id: "123",
    payment_type: "card",
    status: "successful",
  };
  const adapter = new HostedQualificationAdapter(
    "flutterwave-v3",
    {
      secret: "FLWSECK_TEST-fixture",
      accountId: "123",
      channelRestrictionVerified: true,
    },
    async () => ({ status: 200, body: { status: "success", data } }),
  );
  assert.equal((await adapter.status(input)).state, "Confirmed");
  data.account_id = "456";
  await assert.rejects(adapter.status(input), /ACCOUNT_MISMATCH/);
});
test("provider webhook contracts differ and live credentials are excluded", () => {
  const raw = Buffer.from('{"event":"charge.success"}');
  const sig = createHmac("sha512", "secret").update(raw).digest("hex");
  assert.equal(verifyPaystack(raw, sig, "secret"), true);
  assert.equal(verifyPaystack(Buffer.from("{}"), sig, "secret"), false);
  assert.equal(verifyFlutterwaveV3("secret", "secret"), true);
  assert.equal(verifyFlutterwaveV3("wrong", "secret"), false);
  assert.throws(
    () =>
      new HostedQualificationAdapter("paystack", {
        secret: "sk_live_x",
        accountId: "123",
        channelRestrictionVerified: true,
      }),
  );
});
test("provider status errors remain unknown and are never safe fallback evidence", async () => {
  const adapter = new HostedQualificationAdapter(
    "paystack",
    {
      secret: "sk_test_fixture",
      accountId: "123",
      channelRestrictionVerified: true,
    },
    async () => ({ status: 404, body: {} }),
  );
  assert.equal((await adapter.status(input)).state, "Unknown");
});
test("malformed initialization is uncertain after external dispatch", async () => {
  const { ProviderBoundaryError } =
    await import("../lib/payments/providers/hosted");
  const adapter = new HostedQualificationAdapter(
    "paystack",
    {
      secret: "sk_test_fixture",
      accountId: "123",
      channelRestrictionVerified: true,
    },
    async () => ({ status: 200, body: { malformed: true } }),
  );
  await assert.rejects(
    adapter.initialize(input),
    (error: unknown) =>
      error instanceof ProviderBoundaryError && error.uncertain,
  );
});

test("unqualified real integrations cannot fall through to simulator execution", async () => {
  const { resolveExecutionAdapter } = await import("../lib/payments/execution");
  for (const adapter of ["paystack", "flutterwave-v3", "provider", "unknown"])
    assert.throws(
      () =>
        resolveExecutionAdapter({
          environment: "sandbox",
          config: { adapter },
        }),
      /EXECUTION_ADAPTER_NOT_QUALIFIED/,
    );
  assert.throws(
    () =>
      resolveExecutionAdapter({
        environment: "production",
        config: { adapter: "simulator" },
      }),
    /SANDBOX_ONLY/,
  );
});
