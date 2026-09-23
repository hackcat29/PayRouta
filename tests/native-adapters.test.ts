import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import type { ProviderHttpOptions } from "../lib/providers/adapters/http";
import type { ExecutionAdapter } from "../lib/providers/normalized";
import {
  monnifyExecutionAdapter,
  verifyMonnifyWebhook,
} from "../lib/providers/adapters/native/monnify";
import {
  paystackExecutionAdapter,
  verifyPaystackWebhook,
} from "../lib/providers/adapters/native/paystack";
import {
  flutterwaveExecutionAdapter,
  verifyFlutterwaveWebhook,
} from "../lib/providers/adapters/native/flutterwave";

// In-memory mock credentials store
function createMockCredentials(secrets: Record<string, string>) {
  return {
    async get(ref: string) {
      return secrets[ref] ?? "";
    },
  };
}

const mockAttempt = {
  id: "att_001",
  key: "att_key_001",
  environment: "sandbox",
  providerReference: "PR_REF_001",
};

type CreateIntentParam = Parameters<ExecutionAdapter["create"]>[1];

const mockBankIntent: CreateIntentParam = {
  id: "intent_001",
  merchantId: "m_001",
  environment: "sandbox",
  reference: "ref-1",
  amount: "1000.00",
  currency: "NGN",
  selectedMethod: "bank_transfer",
  asset: { kind: "fiat", identifier: "NGN", network: "" },
  status: "Initiated",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as CreateIntentParam;

const mockCardIntent: CreateIntentParam = {
  id: "intent_002",
  merchantId: "m_001",
  environment: "sandbox",
  reference: "ref-2",
  amount: "5000.00",
  currency: "NGN",
  selectedMethod: "card",
  asset: { kind: "fiat", identifier: "NGN", network: "" },
  status: "Initiated",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as CreateIntentParam;

test("monnify adapter fails closed when credentials are not configured", async () => {
  const adapter = monnifyExecutionAdapter(
    {
      adapter: "monnify",
      mode: "NATIVE",
      apiKeyRef: "missing_key",
      secretKeyRef: "missing_secret",
      contractCode: "123456",
    },
    {
      http: async () => ({ status: 200, headers: {}, body: "{}" }),
      credentials: createMockCredentials({}),
    },
  );

  await assert.rejects(
    adapter.create(mockAttempt, mockBankIntent),
    /MONNIFY_CREDENTIALS_NOT_CONFIGURED/,
  );
});

test("monnify adapter authenticates, initializes payment, and queries status", async () => {
  const calls: { method: string; path: string; headers?: Record<string, string> }[] = [];
  const credentials = createMockCredentials({
    monnify_api_key: "api-key-123",
    monnify_secret_key: "secret-key-456",
  });

  const http = async (_baseUrl: string, options: ProviderHttpOptions) => {
    calls.push({ method: options.method, path: options.path, headers: options.headers });
    if (options.path === "/api/v1/auth/login") {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          requestSuccessful: true,
          responseBody: { accessToken: "test-jwt-token", expiresIn: 3600 },
        }),
      };
    }
    if (options.path === "/api/v1/merchant/transactions/init-transaction") {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          requestSuccessful: true,
          responseBody: {
            transactionReference: "MNFY_TXN_999",
            paymentReference: "att_key_001",
          },
        }),
      };
    }
    if (options.path.startsWith("/api/v2/transactions/")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          requestSuccessful: true,
          responseBody: {
            paymentStatus: "PAID",
            amountPaid: 1000.0,
            transactionReference: "MNFY_TXN_999",
          },
        }),
      };
    }
    return { status: 404, headers: {}, body: "{}" };
  };

  const adapter = monnifyExecutionAdapter(
    {
      adapter: "monnify",
      mode: "NATIVE",
      apiKeyRef: "monnify_api_key",
      secretKeyRef: "monnify_secret_key",
      contractCode: "CONTRACT_123",
    },
    { http, credentials },
  );

  const initResult = await adapter.create(mockAttempt, mockBankIntent);

  assert.equal(initResult.reference, "MNFY_TXN_999");
  assert.equal(initResult.state, "Pending");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/api/v1/auth/login");
  assert.equal(calls[1].path, "/api/v1/merchant/transactions/init-transaction");

  const statusResult = await adapter.status(mockAttempt);
  assert.ok(statusResult);
  assert.equal(statusResult.state, "Confirmed");
  assert.equal(statusResult.amount, "1000");
  assert.equal(statusResult.reference, "MNFY_TXN_999");
});

test("monnify webhook verification enforces SHA-512 transaction signature", () => {
  const secretKey = "test_monnify_secret";
  const eventData = {
    paymentReference: "PR_REF_001",
    amountPaid: "1000.00",
    paidOn: "2026-09-23 12:00:00",
    transactionReference: "MNFY_TXN_999",
  };
  const rawString = `${secretKey}|${eventData.paymentReference}|${eventData.amountPaid}|${eventData.paidOn}|${eventData.transactionReference}`;
  const validHash = createHash("sha512").update(rawString, "utf8").digest("hex");

  assert.equal(
    verifyMonnifyWebhook(secretKey, {
      eventData,
      transactionHash: validHash,
    }),
    true,
  );

  // Tampered hash or amount
  assert.equal(
    verifyMonnifyWebhook(secretKey, {
      eventData,
      transactionHash: "invalid_hash_string",
    }),
    false,
  );
});

test("paystack adapter fails closed when credentials are not configured", async () => {
  const adapter = paystackExecutionAdapter(
    {
      adapter: "paystack",
      mode: "NATIVE",
      secretKeyRef: "missing_paystack_secret",
    },
    {
      http: async () => ({ status: 200, headers: {}, body: "{}" }),
      credentials: createMockCredentials({}),
    },
  );

  await assert.rejects(
    adapter.create(mockAttempt, mockCardIntent),
    /PAYSTACK_CREDENTIALS_NOT_CONFIGURED/,
  );
});

test("paystack adapter initializes payment and verifies status", async () => {
  const credentials = createMockCredentials({
    pstk_secret: "sk_test_paystack_secret_123",
  });

  const http = async (_baseUrl: string, options: ProviderHttpOptions) => {
    if (options.path === "/transaction/initialize") {
      const parsedBody = JSON.parse(options.body ?? "{}") as { amount: number };
      // Verify amount is converted to minor units (kobo: 5000 * 100 = 500000)
      assert.equal(parsedBody.amount, 500000);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          status: true,
          data: {
            reference: "pstk-ref-1",
            authorization_url: "https://checkout.paystack.com/auth-123",
            access_code: "access-code-123",
          },
        }),
      };
    }
    if (options.path.startsWith("/transaction/verify/")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          status: true,
          data: {
            status: "success",
            reference: "pstk-ref-1",
            amount: 500000,
            currency: "NGN",
          },
        }),
      };
    }
    return { status: 404, headers: {}, body: "{}" };
  };

  const adapter = paystackExecutionAdapter(
    {
      adapter: "paystack",
      mode: "NATIVE",
      secretKeyRef: "pstk_secret",
    },
    { http, credentials },
  );

  const init = await adapter.create(mockAttempt, mockCardIntent);

  assert.equal(init.reference, "pstk-ref-1");
  assert.equal(init.state, "Pending");

  const stat = await adapter.status({
    id: "att_001",
    key: "pstk-ref-1",
    providerReference: "pstk-ref-1",
  });
  assert.ok(stat);
  assert.equal(stat.state, "Confirmed");
  assert.equal(stat.amount, "5000.00");
});

test("paystack webhook verification validates HMAC-SHA512 signature", () => {
  const secretKey = "sk_test_paystack_secret_123";
  const rawBody = JSON.stringify({ event: "charge.success", data: { reference: "ref-10" } });
  const validSignature = createHmac("sha512", secretKey).update(rawBody).digest("hex");

  assert.equal(
    verifyPaystackWebhook(secretKey, rawBody, validSignature),
    true,
  );

  assert.equal(
    verifyPaystackWebhook(secretKey, rawBody, "00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"),
    false,
  );
});

test("flutterwave adapter initializes payment and verifies status", async () => {
  const credentials = createMockCredentials({
    flw_secret: "FLWSECK_TEST-12345678",
  });

  const flwIntent: CreateIntentParam = {
    ...mockCardIntent,
    amount: "2500.00",
  };

  const http = async (_baseUrl: string, options: ProviderHttpOptions) => {
    if (options.path === "/v3/payments") {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          status: "success",
          data: {
            link: "https://ravemodal-dev.herokuapp.com/v3/hosted/pay/test",
          },
        }),
      };
    }
    if (options.path.startsWith("/v3/transactions/verify_by_reference")) {
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          status: "success",
          data: {
            status: "successful",
            tx_ref: "flw-ref-001",
            amount: 2500,
            currency: "NGN",
          },
        }),
      };
    }
    return { status: 404, headers: {}, body: "{}" };
  };

  const adapter = flutterwaveExecutionAdapter(
    {
      adapter: "flutterwave",
      mode: "NATIVE",
      secretKeyRef: "flw_secret",
    },
    { http, credentials },
  );

  const init = await adapter.create(mockAttempt, flwIntent);

  assert.equal(init.reference, "att_key_001");
  assert.equal(init.state, "Pending");

  const stat = await adapter.status({
    id: "att_001",
    key: "flw-ref-001",
    providerReference: "flw-ref-001",
  });
  assert.ok(stat);
  assert.equal(stat.state, "Confirmed");
  assert.equal(stat.amount, "2500");
});

test("flutterwave webhook verification validates verif-hash secret header", () => {
  const webhookSecret = "flw_webhook_secret_signature";

  assert.equal(
    verifyFlutterwaveWebhook(webhookSecret, webhookSecret),
    true,
  );

  assert.equal(
    verifyFlutterwaveWebhook(webhookSecret, "tampered_header_1234567890"),
    false,
  );

  assert.equal(
    verifyFlutterwaveWebhook(webhookSecret, ""),
    false,
  );
});
