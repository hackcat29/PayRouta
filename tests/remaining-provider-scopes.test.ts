import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  depositExecutionAdapter,
  depositConfigSchema,
} from "../lib/providers/adapters/native/erc20-deposit";
import { opayExecutionAdapter } from "../lib/providers/adapters/native/opay";
import { venmoExecutionAdapter } from "../lib/providers/adapters/native/paypal-venmo";
import { monnifyExecutionAdapter } from "../lib/providers/adapters/native/monnify";
import { stripeExecutionAdapter } from "../lib/providers/adapters/native/stripe";
import { selectStripeTypes } from "../lib/providers/adapters/native/stripe-methods";
import { tokenAssets } from "../lib/blockchain/assets";
import { factAction } from "../lib/payments/contracts";
import type {
  DepositStore,
  DepositBinding,
} from "../lib/blockchain/deposit-types";
import type { NativeDeps } from "../lib/providers/adapters/native/common";

const attempt = { id: "attempt1", key: "attempt:key1", environment: "sandbox" };
const address = `0x${"a".repeat(40)}`,
  contract = "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  txHash = `0x${"b".repeat(64)}`,
  blockHash = `0x${"c".repeat(64)}`;
const config = {
  adapter: "erc20-deposit",
  environment: "sandbox",
  network: "eip155:11155111",
  identifier: `erc20:${contract}`,
  rpcKeyRef: "rpc",
  addresses: [address],
};
const payment = {
  reference: "Invoice",
  amount: "1.50",
  precision: 6,
  selectedMethod: "stablecoin",
  asset: {
    kind: "blockchain",
    network: config.network,
    identifier: config.identifier,
  },
};
const transfer = {
  address: contract,
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    `0x${"0".repeat(24)}${"d".repeat(40)}`,
    `0x${"0".repeat(24)}${"a".repeat(40)}`,
  ],
  data: `0x${(1500000).toString(16).padStart(64, "0")}`,
  blockNumber: "0x66",
  blockHash,
  transactionHash: txHash,
  logIndex: "0x0",
  removed: false,
};
function depositHarness(overrides: Record<string, unknown> = {}) {
  let binding: DepositBinding | null = null,
    allocations = 0,
    claims = 0;
  const store: DepositStore = {
    async find() {
      return binding;
    },
    async allocate(i) {
      allocations++;
      const { addresses, ...b } = i;
      binding = { ...b, address: addresses[0], integrationId: "integration1" };
      return binding;
    },
    async claim() {
      claims++;
    },
  };
  const calls: string[] = [];
  const deps: NativeDeps = {
    deposits: store,
    credentials: { get: async () => "fictional-rpc-key" },
    http: async (_base, o) => {
      assert.equal(
        new URL(o.path, _base).href,
        "https://eth-sepolia.g.alchemy.com/v2/fictional-rpc-key",
      );
      const q = JSON.parse(o.body!);
      calls.push(q.method);
      let result: unknown;
      if (q.method === "eth_chainId") result = "0xaa36a7";
      if (q.method === "eth_blockNumber") result = "0x64";
      if (q.method === "eth_getLogs") result = [transfer];
      if (q.method === "eth_getTransactionReceipt")
        result = {
          transactionHash: txHash,
          blockHash,
          blockNumber: "0x66",
          status: "0x1",
          logs: [transfer],
        };
      if (q.method === "eth_getBlockByNumber")
        result = { number: "0x66", hash: blockHash };
      if (q.method in overrides)
        result =
          typeof overrides[q.method] === "function"
            ? (overrides[q.method] as (q: typeof overrides) => unknown)(q)
            : overrides[q.method];
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }),
      };
    },
  };
  return {
    adapter: depositExecutionAdapter(config, deps),
    calls,
    counts: () => ({ allocations, claims }),
    setBinding: (b: DepositBinding) => {
      binding = b;
    },
  };
}
test("direct deposits reserve once and confirm only exact finalized ERC20 transfer receipts", async () => {
  const h = depositHarness({ eth_blockNumber: "0x68" });
  // Reserve at height 100; subsequent polls observe height 104.
  let first = true;
  const h2 = depositHarness({
    eth_blockNumber: () => {
      if (first) {
        first = false;
        return "0x64";
      }
      return "0x68";
    },
  });
  const created = await h2.adapter.create(attempt, payment);
  assert.equal(created.state, "Requires action");
  assert.equal(factAction.parse(created.action).address, address);
  await h2.adapter.create(attempt, payment);
  assert.equal(h2.counts().allocations, 1);
  assert.equal(
    (
      await h2.adapter.status({
        ...attempt,
        providerReference: created.reference,
      })
    )?.state,
    "Confirmed",
  );
  assert.equal(h2.counts().claims, 1);
  await assert.rejects(
    h.adapter.create(attempt, { ...payment, precision: 18 }),
    /UNSUPPORTED_PAYMENT_ASSET/,
  );
});
test("stablecoin registry pins issuer contracts and keeps USDT out of sandbox and unsupported networks", () => {
  assert(
    tokenAssets.some((t) => t.symbol === "USDT" && t.network === "eip155:1"),
  );
  assert(
    tokenAssets.filter(t=>t.symbol === "USDT").every(t=>["eip155:1","eip155:43114","solana:mainnet"].includes(t.network)),
  );
  assert.equal(
    depositConfigSchema.safeParse({ ...config, network: "eip155:1" }).success,
    false,
  );
  assert.equal(
    depositConfigSchema.safeParse({ ...config, identifier: `erc20:${address}` })
      .success,
    false,
  );
  assert.equal(
    depositConfigSchema.safeParse({
      ...config,
      addresses: [address, address.toUpperCase().replace("0X", "0x")],
    }).success,
    false,
  );
});
async function createdHarness(overrides: Record<string, unknown>) {
  let first = true;
  const h = depositHarness({
    ...overrides,
    eth_blockNumber: () => {
      if (first) {
        first = false;
        return "0x64";
      }
      return "0x68";
    },
  });
  const c = await h.adapter.create(attempt, payment);
  return { h, a: { ...attempt, providerReference: c.reference } };
}
test("unfinalized, removed and disappearing receipts never confirm deposits", async () => {
  for (const overrides of [
    {
      eth_getBlockByNumber: (q: { params: unknown[] }) => ({
        number: q.params[0] === "finalized" ? "0x65" : "0x66",
        hash: blockHash,
      }),
    },
    { eth_getLogs: [{ ...transfer, removed: true }] },
    { eth_getTransactionReceipt: null },
  ]) {
    const { h, a } = await createdHarness(overrides);
    assert.equal(
      (await h.adapter.status(a))?.state,
      "eth_getBlockByNumber" in overrides ? "Pending" : "Requires action",
    );
    assert.equal(h.counts().claims, 0);
  }
});
test("token, recipient, transaction and reverted receipt tampering fail closed", async () => {
  for (const overrides of [
    { eth_getLogs: [{ ...transfer, address }] },
    {
      eth_getLogs: [
        {
          ...transfer,
          topics: [...transfer.topics.slice(0, 2), `0x${"0".repeat(64)}`],
        },
      ],
    },
    {
      eth_getTransactionReceipt: {
        transactionHash: txHash,
        blockHash,
        blockNumber: "0x66",
        status: "0x0",
        logs: [transfer],
      },
    },
    { eth_chainId: "0x1" },
  ]) {
    if (overrides.eth_chainId) {
      const h = depositHarness(overrides);
      await assert.rejects(
        h.adapter.create(attempt, payment),
        /RPC_CHAIN_MISMATCH/,
      );
      continue;
    }
    const { h, a } = await createdHarness(overrides);
    await assert.rejects(h.adapter.status(a));
    assert.equal(h.counts().claims, 0);
  }
});
test("underpayment and multiple transfers are inspected and never consumed as matching invoices", async () => {
  const under = {
    ...transfer,
    data: `0x${(1000000).toString(16).padStart(64, "0")}`,
  };
  for (const overrides of [
    {
      eth_getLogs: [under],
      eth_getTransactionReceipt: {
        transactionHash: txHash,
        blockHash,
        blockNumber: "0x66",
        status: "0x1",
        logs: [under],
      },
    },
    { eth_getLogs: [transfer, { ...transfer, logIndex: "0x1" }] },
  ]) {
    const { h, a } = await createdHarness(overrides);
    await assert.rejects(
      h.adapter.status(a),
      /DEPOSIT_AMOUNT_MISMATCH|DEPOSIT_MULTIPLE_TRANSFERS/,
    );
    assert.equal(h.counts().claims, 0);
  }
});
test("deposit scans do not silently truncate old history", async () => {
  let first = true;
  const h = depositHarness({
    eth_blockNumber: () => {
      if (first) {
        first = false;
        return "0x64";
      }
      return "0xffff";
    },
  });
  const c = await h.adapter.create(attempt, payment);
  await assert.rejects(
    h.adapter.status({ ...attempt, providerReference: c.reference }),
    /SCAN_REQUIRES_INSPECTION/,
  );
});
test("OPay signs exact bytes, restricts NGN wallet QR, checks receipt identity and renders local PNG", async () => {
  let reference = "",
    orderNo = "OPAY-ORDER",
    total = 1234;
  const calls: string[] = [];
  const adapter = opayExecutionAdapter(
    {
      adapter: "opay",
      environment: "sandbox",
      merchantId: "1234567890",
      secretKeyRef: "opay",
    },
    {
      credentials: { get: async () => "fictional-opay-secret" },
      http: async (base, o) => {
        assert.equal(base, "https://testapi.opaycheckout.com");
        assert.equal(
          o.headers?.Authorization,
          `Bearer ${createHmac("sha512", "fictional-opay-secret").update(o.body!).digest("hex")}`,
        );
        const b = JSON.parse(o.body!);
        calls.push(o.path);
        if (o.path.endsWith("/create")) {
          reference = b.reference;
          assert.equal(b.payMethod, "OpayWalletNgQR");
          assert.equal(b.amount.total, 1234);
        }
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            code: "00000",
            data: {
              reference,
              orderNo,
              status: o.path.endsWith("/create") ? "PENDING" : "SUCCESS",
              amount: { total, currency: "NGN" },
              nextAction: {
                actionType: "SCAN_QR_CODE",
                qrCode: "https://qrm.operapay.com/pay/one",
              },
            },
          }),
        };
      },
    },
  );
  const c = await adapter.create(attempt, {
    reference: "one",
    selectedMethod: "digital-wallet",
    precision: 2,
    amount: "12.34",
    metadata: { preferred_wallet: "opay" },
    asset: { kind: "fiat", identifier: "NGN", network: "" },
  });
  const action = factAction.parse(c.action);
  assert(action.image?.startsWith("data:image/png;base64,"));
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: c.reference }))
      ?.amount,
    "12.34",
  );
  orderNo = "OTHER";
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: c.reference }),
    /RECEIPT_MISMATCH/,
  );
  orderNo = c.reference;
  total = 12.5;
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: c.reference }),
  );
  assert.equal(calls.filter((p) => p.endsWith("/create")).length, 1);
});
test("Venmo requires approval, USD and buyer SDK approval before idempotent server capture", async () => {
  let custom = "",
    state = "CREATED",
    captures = 0,
    funding = "venmo",
    amount = "12.34";
  const adapter = venmoExecutionAdapter(
    {
      adapter: "paypal-venmo",
      environment: "sandbox",
      clientIdRef: "id",
      clientSecretRef: "secret",
      merchantId: "MERCHANT123",
      merchantCountry: "US",
      venmoApproved: true,
    },
    {
      credentials: {
        get: async (ref) =>
          ref === "id" ? "fictional-client-id" : "fictional-client-secret",
      },
      http: async (base, o) => {
        assert.equal(base, "https://api-m.sandbox.paypal.com");
        if (o.path === "/v1/oauth2/token")
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({ access_token: "token" }),
          };
        if (o.path === "/v2/checkout/orders") {
          const b = JSON.parse(o.body!);
          custom = b.purchase_units[0].custom_id;
          assert(b.payment_source.venmo);
        }
        if (o.path.endsWith("/capture")) {
          captures++;
          assert.equal(
            o.headers?.["PayPal-Request-Id"],
            "capture-ORDER123456789",
          );
          state = "COMPLETED";
        }
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: "ORDER123456789",
            status: state,
            payment_source: { [funding]: {} },
            purchase_units: [
              {
                custom_id: custom,
                payee: { merchant_id: "MERCHANT123" },
                amount: { currency_code: "USD", value: "12.34" },
                payments: {
                  captures: [
                    {
                      status: "COMPLETED",
                      final_capture: true,
                      amount: { currency_code: "USD", value: amount },
                    },
                  ],
                },
              },
            ],
          }),
        };
      },
    },
  );
  const invoice = {
    reference: "one",
    amount: "12.34",
    precision: 2,
    selectedMethod: "digital-wallet",
    metadata: { preferred_wallet: "venmo" },
    asset: { kind: "fiat", identifier: "USD", network: "" },
  };
  const c = await adapter.create(attempt, invoice);
  assert.equal(factAction.parse(c.action).kind, "paypal-venmo");
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: c.reference }))
      ?.state,
    "Pending",
  );
  assert.equal(captures, 0);
  state = "APPROVED";
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: c.reference }),
    /INVOICE_REQUIRED/,
  );
  await assert.rejects(
    adapter.status(
      { ...attempt, providerReference: c.reference },
      { ...invoice, amount: "12.35" },
    ),
    /RECEIPT_MISMATCH/,
  );
  assert.equal(captures, 0);
  assert.equal(
    (
      await adapter.status(
        { ...attempt, providerReference: c.reference },
        invoice,
      )
    )?.state,
    "Confirmed",
  );
  assert.equal(captures, 1);
  assert.equal(
    (await adapter.status({ ...attempt, providerReference: c.reference }))
      ?.state,
    "Confirmed",
  );
  assert.equal(captures, 1);
  funding = "paypal";
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: c.reference }),
    /FUNDING_MISMATCH/,
  );
  funding = "venmo";
  amount = "12.33";
  await assert.rejects(
    adapter.status({ ...attempt, providerReference: c.reference }),
    /CAPTURE_MISMATCH/,
  );
});
test("Monnify refuses invented identity, wrong currency and arbitrary checkout hosts", async () => {
  const config = {
    adapter: "monnify",
    environment: "sandbox",
    contractCode: "contract",
    apiKeyRef: "api",
    secretKeyRef: "secret",
    returnUrl: "https://merchant.example/return",
  };
  const i = {
    reference: "one",
    amount: "12.34",
    precision: 2,
    selectedMethod: "bank-transfer",
    asset: { kind: "fiat", identifier: "NGN", network: "" },
  };
  const adapter = monnifyExecutionAdapter(config, {
    credentials: { get: async () => "fictional-secret" },
    http: async (_base, o) => ({
      status: 200,
      headers: {},
      body: JSON.stringify({
        requestSuccessful: true,
        responseBody: o.path.endsWith("login")
          ? { accessToken: "token" }
          : {
              transactionReference: "mnfy-one",
              paymentReference: attempt.key,
              amount: "12.34",
              currencyCode: "NGN",
              enabledPaymentMethod: ["ACCOUNT_TRANSFER"],
              checkoutUrl: "https://attacker.example/pay",
            },
      }),
    }),
  });
  await assert.rejects(adapter.create(attempt, i), /CUSTOMER_REQUIRED/);
  await assert.rejects(
    adapter.create(attempt, {
      ...i,
      metadata: {
        payer_name: "Fictional payer",
        payer_email: "payer@example.com",
      },
    }),
    /HOST|LINK/,
  );
  await assert.rejects(
    adapter.create(attempt, {
      ...i,
      asset: { kind: "fiat", identifier: "USD", network: "" },
    }),
    /METHOD_UNAVAILABLE/,
  );
});
test("Stripe credit transfer selects customer_balance with real customer and explicit country/currency options", async () => {
  assert.deepEqual(
    selectStripeTypes(
      "bank-transfer",
      "EUR",
      ["customer_balance", "pix"],
      "sepa",
    ),
    ["customer_balance"],
  );
  assert.deepEqual(
    selectStripeTypes(
      "direct-debit",
      "USD",
      ["customer_balance", "us_bank_account"],
      "ach",
    ),
    ["us_bank_account"],
  );
  let calls = 0;
  const adapter = stripeExecutionAdapter(
    {
      adapter: "stripe",
      environment: "sandbox",
      secretKeyRef: "stripe",
      returnUrl: "https://merchant.example/return",
      cancelUrl: "https://merchant.example/cancel",
      enabledPaymentTypes: ["customer_balance"],
      euBankTransferCountry: "FR",
    },
    {
      credentials: { get: async () => "sk_test_fictional" },
      http: async (_base, o) => {
        calls++;
        const f = new URLSearchParams(o.body!);
        assert.equal(f.get("customer"), "cus_ExistingCustomer");
        assert.equal(f.get("payment_method_types[0]"), "customer_balance");
        assert.equal(
          f.get(
            "payment_method_options[customer_balance][bank_transfer][type]",
          ),
          "eu_bank_transfer",
        );
        assert.equal(
          f.get(
            "payment_method_options[customer_balance][bank_transfer][eu_bank_transfer][country]",
          ),
          "FR",
        );
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: "cs_test_one",
            url: "https://checkout.stripe.com/one",
          }),
        };
      },
    },
  );
  const i = {
    reference: "one",
    amount: "12.34",
    precision: 2,
    selectedMethod: "bank-transfer",
    asset: { kind: "fiat", identifier: "EUR", network: "" },
    metadata: { payment_rail: "sepa" },
  };
  await assert.rejects(adapter.create(attempt, i), /CUSTOMER_REQUIRED/);
  assert.equal(calls, 0);
  await adapter.create(attempt, {
    ...i,
    metadata: { ...i.metadata, stripe_customer_id: "cus_ExistingCustomer" },
  });
  assert.equal(calls, 1);
});
