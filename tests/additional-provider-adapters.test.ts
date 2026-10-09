import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import { intentInput, factAction } from "../lib/payments/contracts";
import { supportedPaymentMethodIds } from "../lib/providers/normalized";
import { stripeExecutionAdapter } from "../lib/providers/adapters/native/stripe";
import { selectStripeTypes } from "../lib/providers/adapters/native/stripe-methods";
import {
  adyenExecutionAdapter,
  verifyAdyenItem,
} from "../lib/providers/adapters/native/adyen";
import { adyenCaptureEvents } from "../lib/payments/native-events";
import { mtnExecutionAdapter } from "../lib/providers/adapters/native/mtn-momo";
import { phonepeExecutionAdapter } from "../lib/providers/adapters/native/phonepe";
import {
  paypayExecutionAdapter,
  paypayAuthorization,
} from "../lib/providers/adapters/native/paypay";
import { picpayExecutionAdapter } from "../lib/providers/adapters/native/picpay";
import { xenditExecutionAdapter } from "../lib/providers/adapters/native/xendit";
import { mercadoExecutionAdapter } from "../lib/providers/adapters/native/mercado-pago";
import {
  coinbaseExecutionAdapter,
  coinbaseJwt,
} from "../lib/providers/adapters/native/coinbase-business";
import {
  binanceExecutionAdapter,
  binanceSignature,
} from "../lib/providers/adapters/native/binance-pay";
import {
  simulatedIntegration,
  nativeModules,
} from "../lib/providers/adapters/native/registry";
import {
  amountField,
  stableId,
  uuidId,
  type NativeDeps,
} from "../lib/providers/adapters/native/common";
import type { ProviderHttpOptions } from "../lib/providers/adapters/http";
import { tokenAssets } from "../lib/blockchain/assets";

const attempt = {
  id: "attempt-1",
  key: "attempt:one",
  environment: "sandbox",
  providerReference: null,
};
const now = new Date("2026-10-06T20:00:00Z");
const urls = {
  returnUrl: "https://merchant.example/return",
  cancelUrl: "https://merchant.example/cancel",
};
const base = { mode: "NATIVE", environment: "sandbox" };
const intent = (currency = "USD", method = "digital-wallet") => ({
  reference: "Order 1",
  amount: "12.34",
  precision: 2,
  asset: { kind: "fiat", identifier: currency, network: "" },
  selectedMethod: method,
  metadata: {},
});
function transport(
  respond: (o: ProviderHttpOptions, origin: string) => unknown,
  secrets: Record<string, string> = {},
) {
  const calls: { origin: string; options: ProviderHttpOptions }[] = [];
  const deps: NativeDeps = {
    now: () => now,
    credentials: { get: async (ref) => secrets[ref] ?? "test-secret" },
    http: async (origin, options) => {
      calls.push({ origin, options });
      const response = respond(options, origin);
      if (response instanceof Error) throw response;
      return { status: 200, headers: {}, body: JSON.stringify(response) };
    },
  };
  return { deps, calls };
}
const body = (o: ProviderHttpOptions) => JSON.parse(o.body ?? "{}");

test("merchant contract accepts nine documented categories, rejects duplicates and future cash/voucher", () => {
  const input = {
    reference: "Order 1",
    amount: "12.34",
    precision: 2,
    asset: intent().asset,
    methods: [...supportedPaymentMethodIds],
    settlement: intent().asset,
    returnUrl: urls.returnUrl,
  };
  assert.equal(intentInput.parse(input).methods.length, 9);
  assert.equal(
    intentInput.safeParse({ ...input, methods: ["cash-voucher"] }).success,
    false,
  );
  assert.equal(
    intentInput.safeParse({ ...input, methods: ["card", "card"] }).success,
    false,
  );
  assert.equal(
    factAction.safeParse({ kind: "qr", provider: "PicPay", text: "Pay" })
      .success,
    false,
  );
});

test("Stripe isolates wallet/BNPL/debit/Pix types from cards, currency and operator enablement", async () => {
  assert.deepEqual(
    selectStripeTypes(
      "digital-wallet",
      "USD",
      ["card", "cashapp", "klarna"],
      "cash-app",
    ),
    ["cashapp"],
  );
  assert.deepEqual(
    selectStripeTypes("direct-debit", "EUR", ["sepa_debit", "us_bank_account"]),
    ["sepa_debit"],
  );
  assert.deepEqual(selectStripeTypes("bnpl", "USD", ["affirm", "card"]), [
    "affirm",
  ]);
  assert.deepEqual(selectStripeTypes("bank-transfer", "BRL", ["pix", "card"]), [
    "pix",
  ]);
  assert.throws(
    () => selectStripeTypes("digital-wallet", "USD", ["card"]),
    /METHOD_UNAVAILABLE/,
  );
  assert.throws(
    () => selectStripeTypes("digital-wallet", "USD", ["cashapp"], "apple-pay"),
    /METHOD_UNAVAILABLE/,
  );
  const h = transport(
    (o) =>
      o.method === "POST"
        ? { id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/test" }
        : {
            id: "cs_test_123",
            client_reference_id: attempt.key,
            livemode: false,
            status: "complete",
            payment_status: "paid",
            amount_total: 1234,
            currency: "usd",
          },
    { stripe: "sk_test_123" },
  );
  const adapter = stripeExecutionAdapter(
    {
      ...base,
      ...urls,
      adapter: "stripe",
      secretKeyRef: "stripe",
      enabledPaymentTypes: ["card", "cashapp"],
    },
    h.deps,
  );
  const created = await adapter.create(attempt, intent());
  const form = new URLSearchParams(h.calls[0].options.body);
  assert.equal(form.get("payment_method_types[0]"), "cashapp");
  assert.equal(form.get("payment_method_types[1]"), null);
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "1234");
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: created.reference }))
      ?.amount,
    "12.34",
  );
  assert.equal(await adapter.status(attempt), null);
  assert.equal(h.calls.length, 2);
  await assert.rejects(
    adapter.create(attempt, { ...intent(), precision: 0 }),
    /AMOUNT/,
  );
  await assert.rejects(
    adapter.create({ ...attempt, environment: "production" }, intent()),
    /ENVIRONMENT_MISMATCH/,
  );
});

test("hosted redirect tampering and wrong Stripe receipt identity never confirm", async () => {
  const h = transport(
    (o) =>
      o.method === "POST"
        ? {
            id: "cs_test_123",
            url: "https://checkout.stripe.com.evil.example/",
          }
        : {
            id: "cs_test_123",
            client_reference_id: "another-attempt",
            livemode: false,
            currency: "usd",
            amount_total: 1234,
          },
    { stripe: "sk_test_123" },
  );
  const adapter = stripeExecutionAdapter(
    { ...base, ...urls, adapter: "stripe", secretKeyRef: "stripe" },
    h.deps,
  );
  await assert.rejects(
    adapter.create(attempt, intent("USD", "card")),
    /HOST_NOT_ALLOWED/,
  );
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: "cs_test_123" }),
    /SCOPE_MISMATCH/,
  );
});

const adyenConfig = {
  ...base,
  adapter: "adyen",
  apiKeyRef: "adyen",
  webhookSecretRef: "hmac",
  merchantAccount: "TestMerchant",
  baseUrl: "https://checkout-test.adyen.com",
  returnUrl: urls.returnUrl,
  countryCode: "DE",
  enabledPaymentTypes: ["scheme", "applepay", "googlepay"],
};
test("Adyen restricts Apple Pay and never treats completed authorization as captured money", async () => {
  const h = transport((o) =>
    o.method === "POST"
      ? { id: "link1", url: "https://test.adyen.link/one" }
      : {
          id: "link1",
          reference: attempt.key,
          merchantAccount: "TestMerchant",
          amount: { value: 1234, currency: "EUR" },
          status: "completed",
        },
  );
  const adapter = adyenExecutionAdapter(adyenConfig, h.deps);
  const created = await adapter.create(attempt, {
    ...intent("EUR"),
    metadata: { preferred_wallet: "apple-pay" },
  });
  assert.deepEqual(body(h.calls[0].options).allowedPaymentMethods, [
    "applepay",
  ]);
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: created.reference }))
      ?.state,
    "Pending",
  );
  assert.throws(
    () =>
      adyenExecutionAdapter(
        { ...adyenConfig, baseUrl: "https://evil.example" },
        h.deps,
      ),
    /CONFIGURATION/,
  );
});

const hmacKey =
  "44782DEF547AAA06C910C43932B1EB0C71FC68D9D0C057550C48EC2ACF6BA056";
test("Adyen verifier passes official vector, rejects tampering; authorizations cannot become capture events", () => {
  const item = {
    pspReference: "7914073381342284",
    merchantAccountCode: "TestMerchant",
    merchantReference: "TestPayment-1407325143704",
    amount: { value: 1130, currency: "EUR" },
    eventCode: "AUTHORISATION",
    success: "true",
    additionalData: {
      hmacSignature: "coqCmt/IZ4E3CzPvMY8zTjQVL5hYJUiBRg8UU+iCWo0=",
    },
  };
  assert.equal(verifyAdyenItem(item, hmacKey), true);
  assert.equal(
    verifyAdyenItem(
      { ...item, amount: { value: 999, currency: "EUR" } },
      hmacKey,
    ),
    false,
  );
  assert.deepEqual(
    adyenCaptureEvents(
      adyenConfig,
      JSON.stringify({
        live: "false",
        notificationItems: [{ NotificationRequestItem: item }],
      }),
      hmacKey,
    ),
    [],
  );
  const capture = {
    ...item,
    merchantReference: attempt.key,
    pspReference: "CAP123",
    originalReference: "AUTH123",
    eventCode: "CAPTURE",
  };
  const payload = [
    capture.pspReference,
    capture.originalReference,
    capture.merchantAccountCode,
    capture.merchantReference,
    1130,
    "EUR",
    "CAPTURE",
    "true",
  ]
    .map((v) => String(v).replace(/:/g, "\\:"))
    .join(":");
  capture.additionalData = {
    hmacSignature: createHmac("sha256", Buffer.from(hmacKey, "hex"))
      .update(payload)
      .digest("base64"),
  };
  const raw = JSON.stringify({
    live: "false",
    notificationItems: [{ NotificationRequestItem: capture }],
  });
  const events = adyenCaptureEvents(adyenConfig, raw, hmacKey);
  assert.equal(events[0].payload.amount, "11.30");
  assert.equal(events[0].payload.attemptKey, attempt.key);
  assert.throws(
    () =>
      adyenCaptureEvents(
        adyenConfig,
        raw.replace('"false"', '"true"'),
        hmacKey,
      ),
    /ENVIRONMENT/,
  );
  assert.throws(
    () =>
      adyenCaptureEvents(
        adyenConfig,
        raw.replace('"CAP123"', '"CAP124"'),
        hmacKey,
      ),
    /SIGNATURE/,
  );
});

test("MTN status recovers deterministic request UUID after an ambiguous create without sending a second prompt", async () => {
  const h = transport((o) =>
    o.path === "/collection/token/"
      ? { access_token: "token" }
      : o.method === "POST"
        ? new Error("timeout after acceptance")
        : {
            status: "SUCCESSFUL",
            externalId: attempt.key,
            currency: "EUR",
            amount: "12.34",
          },
  );
  const adapter = mtnExecutionAdapter(
    {
      ...base,
      adapter: "mtn-momo",
      apiUserRef: "user",
      apiKeyRef: "key",
      subscriptionKeyRef: "sub",
      targetEnvironment: "sandbox",
      currency: "EUR",
    },
    h.deps,
  );
  await assert.rejects(
    adapter.create(attempt, {
      ...intent("EUR", "mobile-money"),
      metadata: { payer_phone: "233241234567" },
    }),
    /timeout/,
  );
  const recovered = await adapter.status(attempt);
  assert.equal(recovered?.reference, uuidId(attempt.key));
  assert.equal(recovered?.state, "Confirmed");
  assert.equal(
    h.calls.filter((c) => c.options.path === "/collection/v1_0/requesttopay")
      .length,
    1,
  );
});

test("PhonePe uses environment-specific OAuth and UPI-only checkout; polls the original merchant order", async () => {
  const h = transport((o) =>
    o.path.endsWith("/oauth/token")
      ? { access_token: "token" }
      : o.method === "POST"
        ? {
            orderId: "provider-order",
            redirectUrl: "https://mercury-t2.phonepe.com/transact/one",
          }
        : {
            merchantId: "M1",
            merchantOrderId: stableId(attempt.key),
            state: "COMPLETED",
            amount: 1234,
          },
  );
  const adapter = phonepeExecutionAdapter(
    {
      ...base,
      adapter: "phonepe",
      clientIdRef: "client",
      clientSecretRef: "secret",
      clientVersion: 1,
      merchantId: "M1",
      returnUrl: urls.returnUrl,
      enabledModes: ["CARD", "UPI_INTENT", "UPI_QR"],
    },
    h.deps,
  );
  const created = await adapter.create(attempt, intent("INR", "bank-transfer"));
  const pay = h.calls.find((c) => c.options.path.endsWith("/pay"))!;
  assert.deepEqual(
    body(pay.options).paymentFlow.paymentModeConfig.enabledPaymentModes,
    [{ type: "UPI_INTENT" }, { type: "UPI_QR" }],
  );
  assert.equal(pay.options.headers?.Authorization, "O-Bearer token");
  assert.equal(created.reference, stableId(attempt.key));
  assert.equal((await adapter.status(attempt))?.state, "Confirmed");
  assert(h.calls.every((c) => c.origin === "https://api-preprod.phonepe.com"));
  await assert.rejects(
    adapter.create(attempt, intent("USD", "bank-transfer")),
    /ASSET/,
  );
});

test("PayPay signs exact JSON bytes and enforces integer JPY without authorization-only confirmation", async () => {
  let state = "AUTHORIZED";
  const h = transport((o) => ({
    resultInfo: { code: "SUCCESS" },
    data:
      o.method === "POST"
        ? { url: "https://stg-qr.paypay.ne.jp/one" }
        : {
            merchantPaymentId: stableId(attempt.key),
            status: state,
            amount: { amount: 1234, currency: "JPY" },
          },
  }));
  const adapter = paypayExecutionAdapter(
    {
      ...base,
      returnUrl: urls.returnUrl,
      adapter: "paypay",
      apiKeyRef: "key",
      secretKeyRef: "secret",
      merchantId: "merchant",
    },
    h.deps,
  );
  const created = await adapter.create(attempt, {
    ...intent("JPY"),
    amount: "1234",
    precision: 0,
  });
  assert.equal(body(h.calls[0].options).amount.amount, 1234);
  assert(
    h.calls[0].options.headers?.Authorization.startsWith("hmac OPA-Auth:"),
  );
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: created.reference }))
      ?.state,
    "Pending",
  );
  state = "COMPLETED";
  assert.equal((await adapter.status(attempt))?.state, "Confirmed");
  await assert.rejects(adapter.create(attempt, intent("JPY")), /AMOUNT/);
  assert.notEqual(
    paypayAuthorization("k", "s", "/v2/codes", "POST", "{}", "1", "n"),
    paypayAuthorization("k", "s", "/v2/codes", "POST", "{ }", "1", "n"),
  );
});

test("PicPay validates customer details, shows provider QR and only confirms paid wallet receipts", async () => {
  let refunded = 0;
  const h = transport((o) =>
    o.path === "/oauth2/token"
      ? { access_token: "token" }
      : {
          merchantChargeId: uuidId(attempt.key),
          chargeStatus: o.method === "POST" ? "PRE_AUTHORIZED" : "PAID",
          amount: 1234,
          refundedAmount: refunded,
          transactions: [
            {
              paymentType: "WALLET",
              transactionStatus: "PAID",
              wallet: {
                qrCode: "000201-PICPAY",
                qrCodeBase64: "data:image/png;base64,YWJj",
              },
            },
          ],
        },
  );
  const adapter = picpayExecutionAdapter(
    {
      ...base,
      adapter: "picpay",
      clientIdRef: "client",
      clientSecretRef: "secret",
    },
    h.deps,
  );
  await assert.rejects(
    adapter.create(attempt, intent("BRL")),
    /CUSTOMER_DETAILS/,
  );
  assert.equal(h.calls.length, 0);
  const metadata = {
    payer_name: "Test Customer",
    payer_email: "test@example.com",
    payer_document_type: "CPF",
    payer_document: "12345678901",
    payer_phone_country: "55",
    payer_phone_area: "11",
    payer_phone_number: "999999999",
    payer_ip: "203.0.113.1",
  };
  const created = await adapter.create(attempt, { ...intent("BRL"), metadata });
  assert.equal(factAction.parse(created.action).kind, "qr");
  assert.equal((await adapter.status(attempt))?.state, "Confirmed");
  refunded = 1234;
  assert.equal((await adapter.status(attempt))?.state, "Unknown");
});

test("Xendit restricts ShopeePay checkout and refuses a paid receipt from another channel", async () => {
  let wallet = "SHOPEEPAY";
  const h = transport(
    (o) =>
      o.method === "POST"
        ? { id: "inv1", invoice_url: "https://checkout.xendit.co/web/one" }
        : {
            id: "inv1",
            external_id: attempt.key,
            currency: "THB",
            status: "PAID",
            amount: 12.34,
            payment_method: "EWALLET",
            ewallet_type: wallet,
          },
    { key: "xnd_development_123" },
  );
  const adapter = xenditExecutionAdapter(
    {
      ...base,
      ...urls,
      adapter: "xendit",
      secretKeyRef: "key",
      currency: "THB",
      enabledWallets: ["SHOPEEPAY"],
    },
    h.deps,
  );
  const created = await adapter.create(attempt, intent("THB"));
  assert.deepEqual(body(h.calls[0].options).payment_methods, ["SHOPEEPAY"]);
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: created.reference }))
      ?.state,
    "Confirmed",
  );
  wallet = "CREDIT_CARD";
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: created.reference }),
    /METHOD_MISMATCH/,
  );
});

test("Mercado Pago requires wallet login and a single authenticated receipt in the correct environment", async () => {
  let total = 1;
  const h = transport((o) =>
    o.method === "POST"
      ? {
          id: "pref1",
          collector_id: 123,
          sandbox_init_point:
            "https://www.mercadopago.com.br/checkout/v1/redirect",
        }
      : {
          paging: { total },
          results: [
            {
              external_reference: attempt.key,
              collector_id: 123,
              currency_id: "BRL",
              live_mode: false,
              status: "approved",
              transaction_amount: 12.34,
            },
          ],
        },
  );
  const adapter = mercadoExecutionAdapter(
    {
      ...base,
      ...urls,
      adapter: "mercado-pago",
      accessTokenRef: "token",
      collectorId: "123",
      currency: "BRL",
    },
    h.deps,
  );
  const created = await adapter.create(attempt, intent("BRL"));
  assert.equal(body(h.calls[0].options).purpose, "wallet_purchase");
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: created.reference }))
      ?.amount,
    "12.34",
  );
  total = 2;
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: created.reference }),
    /MULTIPLE_RECEIPTS/,
  );
});

test("Coinbase JWT binds method/path/time and validates Base USDC identity on completed checkouts", async () => {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = pair.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
  const jwt = coinbaseJwt(
    "organizations/test/apiKeys/key",
    pem,
    "POST",
    "/sandbox/api/v1/checkouts",
    now,
  );
  const parts = jwt.split("."),
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  assert.equal(
    claims.uri,
    "POST business.coinbase.com/sandbox/api/v1/checkouts",
  );
  assert.equal(claims.exp - claims.nbf, 120);
  assert(
    verify(
      "sha256",
      Buffer.from(parts.slice(0, 2).join(".")),
      { key: pair.publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(parts[2], "base64url"),
    ),
  );
  let tokenAddress = tokenAssets[0].contractAddress;
  const h = transport(
    (o) =>
      o.method === "POST"
        ? { id: "cb1", url: "https://payments.coinbase.com/checkouts/one" }
        : {
            id: "cb1",
            metadata: { payrouta_attempt: attempt.key },
            currency: "USDC",
            network: "base",
            tokenAddress,
            status: "COMPLETED",
            amount: "12.340001",
          },
    { key: "organizations/test/apiKeys/key", pem },
  );
  const adapter = coinbaseExecutionAdapter(
    {
      ...base,
      ...urls,
      adapter: "coinbase-business",
      keyIdRef: "key",
      privateKeyRef: "pem",
    },
    h.deps,
  );
  const created = await adapter.create(attempt, {
    ...intent(),
    selectedMethod: "crypto-app",
    amount: "12.340001",
    precision: 6,
    asset: {
      kind: "blockchain",
      identifier: tokenAssets[0].identifier,
      network: tokenAssets[0].network,
    },
  });
  assert.equal(
    h.calls[0].options.headers?.["X-Idempotency-Key"],
    uuidId(attempt.key),
  );
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: created.reference }))
      ?.amount,
    "12.340001",
  );
  tokenAddress = "0x0000000000000000000000000000000000000000";
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: created.reference }),
    /SCOPE_MISMATCH/,
  );
});

test("Binance v3 preserves exact asset and amount, uses stable trade number, never hits live from sandbox", async () => {
  const h = transport((o) => ({
    status: "SUCCESS",
    code: "000000",
    data: o.path.endsWith("/v3/order")
      ? { checkoutUrl: "https://pay.binance.com/en/checkout/one" }
      : {
          merchantTradeNo: stableId(attempt.key),
          currency: "USDT",
          totalFee: "12.34000001",
          status: "PAID",
        },
  }));
  const config = {
    ...base,
    ...urls,
    adapter: "binance-pay",
    certificateRef: "cert",
    secretKeyRef: "secret",
    currency: "USDT",
    goodsType: "02",
    goodsCategory: "0000",
  };
  const payment = {
    ...intent(),
    selectedMethod: "crypto-app",
    amount: "12.34000001",
    precision: 8,
    asset: {
      kind: "blockchain",
      identifier: "binance:USDT",
      network: "binance:pay",
    },
  };
  await assert.rejects(
    binanceExecutionAdapter(config, h.deps).create(attempt, payment),
    /SANDBOX_UNAVAILABLE/,
  );
  assert.equal(h.calls.length, 0);
  const adapter = binanceExecutionAdapter(
    { ...config, environment: "production" },
    h.deps,
  );
  const created = await adapter.create(
    { ...attempt, environment: "production" },
    payment,
  );
  assert.equal(body(h.calls[0].options).orderAmount, "12.34000001");
  assert.equal(created.reference, stableId(attempt.key));
  assert.equal((await adapter.status(attempt))?.state, "Confirmed");
  const o = h.calls[0].options,
    headers = o.headers!;
  assert.equal(
    headers["BinancePay-Signature"],
    binanceSignature(
      "test-secret",
      headers["BinancePay-Timestamp"],
      headers["BinancePay-Nonce"],
      o.body!,
    ),
  );
});

test("external integrations can never simulate settlement or dispatch replay; money parsing rejects unsafe numbers", () => {
  assert.equal(new Set(nativeModules.map(m=>m.id)).size, nativeModules.length);
  assert.equal(
    simulatedIntegration({
      environment: "sandbox",
      config: { adapter: "simulator" },
    }),
    true,
  );
  for (const native of nativeModules)
    assert.equal(
      simulatedIntegration({
        environment: "sandbox",
        config: { adapter: native.id },
      }),
      false,
    );
  assert.equal(
    simulatedIntegration({
      environment: "production",
      config: { adapter: "simulator" },
    }),
    false,
  );
  assert.throws(() => amountField(9007199254740992));
  assert.equal(amountField("9007199254740993.01"), "9007199254740993.01");
});
