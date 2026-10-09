import "dotenv/config";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { cryptoAssets } from "../../lib/blockchain/crypto-assets";
import { tokenAsset } from "../../lib/blockchain/assets";
import { createCryptoCheckout } from "../../lib/payments/crypto-checkout";
import {
  createIntent,
  methods,
  selectMethod,
  confirm,
  progress,
  choosePaymentOption,
  handoffSession,
  authorizeSession,
} from "../../lib/payments/service";
import {
  applyFact,
  dispatch,
  settle,
  reconcile,
} from "../../lib/payments/processing";
import { nativeModules } from "../../lib/providers/adapters/native/registry";
import { nativeDepositExecutionAdapter } from "../../lib/providers/adapters/native/evm-native-deposit";
import { tokenMinor } from "../../lib/blockchain/assets";
import { hash } from "../../lib/payments/contracts";
import { POST } from "../../app/api/v1/[...path]/route";
import {
  POST as checkoutPost,
  GET as checkoutGet,
} from "../../app/api/checkout/[id]/route";
import { NextRequest } from "next/server";
let orgId: string, apiSecret: string;
const assets = cryptoAssets.filter((a) =>
  [
    "eip155:11155111",
    "eip155:84532",
    "eip155:421614",
    "eip155:43113",
    "eip155:80002",
  ].includes(a.network),
);
const input = {
  reference: "Fictional crypto invoice",
  payerCountry: "NG",
  usdAmount: "10.00",
  options: assets.map((a) => ({
    network: a.network,
    identifier: a.identifier,
  })),
};
const market = async () =>
  Object.fromEntries(
    assets.map((a) => [
      a.coinGeckoId,
      {
        usd: a.symbol === "ETH" ? "2500" : a.symbol === "AVAX" ? "10" : "0.10",
        source: "CoinGecko" as const,
        updatedAt: new Date().toISOString(),
      },
    ]),
  );
before(async () => {
  if (
    process.env.PORTAL_MODE !== "local" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")
  )
    throw new Error("Isolated local database required");
  orgId = `crypto-test-${randomUUID()}`;
  await db.organization.create({
    data: { id: orgId, name: "Fictional crypto tests", fictional: true },
  });
  await db.merchantConfig.create({
    data: { orgId, returnOrigin: "http://127.0.0.1:3000" },
  });
  for (const [index, a] of assets.entries())
    await db.integration.create({
      data: {
        orgId,
        environment: "sandbox",
        version: index + 1,
        config: json({
          mode: "NATIVE",
          adapter: "evm-native-deposit",
          environment: "sandbox",
          network: a.network,
          identifier: a.identifier,
          addresses: Array.from(
            { length: 10 },
            () => `0x${randomBytes(20).toString("hex")}`,
          ),
          publicRpc: true,
          accountId: `fictional-native-${index}`,
        }),
      },
    });
  const stable = tokenAsset(
    "eip155:84532",
    "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  )!;
  await db.integration.create({
    data: {
      orgId,
      environment: "sandbox",
      version: assets.length + 1,
      config: json({
        mode: "NATIVE",
        adapter: "erc20-deposit",
        environment: "sandbox",
        network: stable.network,
        identifier: stable.identifier,
        publicRpc: true,
        addresses: Array.from(
          { length: 10 },
          () => `0x${randomBytes(20).toString("hex")}`,
        ),
        accountId: "fictional-mixed-stable",
      }),
    },
  });
  apiSecret = `pr_sandbox_${randomBytes(32).toString("base64url")}`;
  await db.merchantApiKey.create({
    data: {
      orgId,
      environment: "sandbox",
      prefix: apiSecret.slice(0, 22),
      verifier: hash(apiSecret),
      permissions: ["payments:write", "payments:read"],
    },
  });
});
after(() => db.$disconnect());
test("mixed wallet quote offers stablecoins and crypto with immutable distinct prices and locks the chosen asset", async () => {
  const options = [
    { network: "eip155:84532", identifier: "native:ETH" },
    {
      network: "eip155:84532",
      identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    },
  ];
  const checkout = await createCryptoCheckout(
    orgId,
    "sandbox",
    randomUUID(),
    { ...input, options },
    async () => ({
      ethereum: {
        usd: "2500",
        source: "CoinGecko",
        updatedAt: new Date().toISOString(),
      },
      "usd-coin": {
        usd: "0.80",
        source: "CoinGecko",
        updatedAt: new Date().toISOString(),
      },
    }),
  );
  const token = checkout.checkoutPath.split("#")[1];
  const first = await progress(checkout.id, token);
  assert.equal(first.paymentOptions[0].amount, "0.004000000000000000");
  const usdc = first.paymentOptions.find((o) => o.method === "stablecoin")!;
  assert.equal(usdc.amount, "12.500000");
  assert.deepEqual(
    (await methods(checkout.id, token)).methods
      .filter((m) => m.status === "AVAILABLE")
      .map((m) => m.method)
      .sort(),
    ["crypto-app", "stablecoin"],
  );
  await assert.rejects(selectMethod(checkout.id, token, "stablecoin"));
  await choosePaymentOption(checkout.id, token, usdc.id);
  assert.equal((await progress(checkout.id, token)).method, "stablecoin");
  await methods(checkout.id, token);
  await choosePaymentOption(checkout.id, token, first.paymentOptions[0].id);
  assert.equal((await progress(checkout.id, token)).amount, first.amount);
  await choosePaymentOption(checkout.id, token, usdc.id);
  await methods(checkout.id, token);
  const route = await selectMethod(checkout.id, token, "stablecoin");
  await confirm(checkout.id, token, route.routeId);
  await assert.rejects(
    choosePaymentOption(checkout.id, token, first.paymentOptions[0].id),
    /PAYMENT_CHAIN_LOCKED/,
  );
  await assert.rejects(
    createCryptoCheckout(orgId, "sandbox", randomUUID(), {
      ...input,
      options: [
        {
          network: "eip155:84532",
          identifier: "erc20:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        },
      ],
    }),
    /UNSUPPORTED_PAYMENT_ASSET/,
  );
});
test("external wallet handoff preserves the intent, active attempt and immutable quote deadline", async () => {
  const checkout = await createCryptoCheckout(
    orgId,
    "sandbox",
    randomUUID(),
    input,
    market,
  );
  const token = checkout.checkoutPath.split("#")[1];
  const origin = new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000")
    .origin;
  const request = (cookie?: string) =>
    new NextRequest(`${origin}/api/checkout/${checkout.id}`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify({ action: "wallet-link" }),
    });
  const params = { params: Promise.resolve({ id: checkout.id }) };
  assert.equal((await checkoutPost(request(), params)).status, 401);
  const apiHandoff = await checkoutPost(
    request(`checkout_${checkout.id}=${token}`),
    params,
  );
  assert.equal(apiHandoff.status, 200);
  assert.equal(apiHandoff.headers.get("cache-control"), "no-store");
  const apiLink = (await apiHandoff.json()).checkoutPath as string;
  const [apiPath, apiToken] = apiLink.split("#");
  const apiId = apiPath.split("/").at(-1)!;
  const exchange = await checkoutPost(
    new NextRequest(`${origin}/api/checkout/${apiId}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ action: "exchange", token: apiToken }),
    }),
    { params: Promise.resolve({ id: apiId }) },
  );
  assert.equal(exchange.status, 200);
  assert.ok(exchange.headers.get("set-cookie")?.includes(`checkout_${apiId}=`));
  const externalProgress = await checkoutGet(
    new NextRequest(`${origin}/api/checkout/${apiId}`, {
      headers: { cookie: `checkout_${apiId}=${apiToken}` },
    }),
    { params: Promise.resolve({ id: apiId }) },
  );
  assert.equal(externalProgress.status, 200);
  assert.equal(
    (await externalProgress.json()).expiresAt,
    new Date(checkout.expiresAt).toISOString(),
  );
  await assert.rejects(
    handoffSession(checkout.id, "invalid"),
    /CHECKOUT_EXPIRED_OR_UNAUTHORIZED/,
  );
  await methods(checkout.id, token);
  const route = await selectMethod(checkout.id, token, "crypto-app");
  const attempt = await confirm(checkout.id, token, route.routeId);
  const handoff = await handoffSession(checkout.id, token);
  const [path, credential] = handoff.checkoutPath.split("#");
  const id = path.split("/").at(-1)!;
  assert.notEqual(id, checkout.id);
  assert.notEqual(credential, token);
  const session = await authorizeSession(id, credential);
  assert.equal(session.intentId, checkout.intentId);
  assert.equal(
    session.expiresAt.toISOString(),
    new Date(checkout.expiresAt).toISOString(),
  );
  assert.equal((await progress(id, credential)).attemptId, attempt.attemptId);
  assert.equal(
    (await progress(checkout.id, token)).attemptId,
    attempt.attemptId,
  );
  assert.equal(
    await db.paymentAttempt.count({ where: { intentId: checkout.intentId } }),
    1,
  );
  const later = new Date(session.expiresAt.getTime() + 1);
  await assert.rejects(
    handoffSession(checkout.id, token, later),
    /CHECKOUT_EXPIRED$/,
  );
  assert.equal(
    (await progress(id, credential, later)).attemptId,
    attempt.attemptId,
  );
  await db.checkoutSession.update({
    where: { id: checkout.id },
    data: { revokedAt: new Date() },
  });
  await assert.rejects(
    handoffSession(checkout.id, token),
    /CHECKOUT_EXPIRED_OR_UNAUTHORIZED/,
  );
});
test("crypto quote retries preserve prices, amount, expiry and one checkout credential; API owns its scope", async () => {
  const key = randomUUID();
  let calls = 0;
  const prices = async () => {
    calls++;
    return market();
  };
  const results = await Promise.all([
    createCryptoCheckout(orgId, "sandbox", key, input, prices),
    createCryptoCheckout(orgId, "sandbox", key, input, prices),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(calls, 1);
  const intent = await db.paymentIntent.findUniqueOrThrow({
    where: { id: results[0].intentId },
  });
  assert.equal(intent.amount, "0.004000000000000000");
  assert.ok(intent.cryptoQuoteId);
  assert.ok(intent.expiresAt.getTime() - intent.createdAt.getTime() <= 120000);
  const response = await POST(
    new Request("http://127.0.0.1:3000/api/v1/crypto-checkouts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiSecret}`,
        "payrouta-environment": "sandbox",
        "idempotency-key": key,
      },
      body: JSON.stringify(input),
    }),
    { params: Promise.resolve({ path: ["crypto-checkouts"] }) },
  );
  assert.equal(response.status, 201, await response.clone().text());
  assert.equal((await response.json()).checkoutPath, results[0].checkoutPath);
  await assert.rejects(
    createCryptoCheckout(
      orgId,
      "sandbox",
      key,
      { ...input, usdAmount: "11.00" },
      prices,
    ),
    /IDEMPOTENCY_CONFLICT/,
  );
  await assert.rejects(
    db.cryptoQuote.update({
      where: { id: intent.cryptoQuoteId! },
      data: { expiresAt: new Date(Date.now() + 999999) },
    }),
    /immutable/,
  );
  await assert.rejects(
    db.paymentIntent.update({
      where: { id: intent.id },
      data: { expiresAt: new Date(Date.now() + 999999) },
    }),
    /immutable/,
  );
  await assert.rejects(
    createIntent(orgId, randomUUID(), {
      reference: "Bypass",
      payerCountry: "NG",
      amount: "0.004",
      precision: 18,
      asset: {
        kind: "blockchain",
        network: assets[0].network,
        identifier: assets[0].identifier,
      },
      settlement: {
        kind: "blockchain",
        network: assets[0].network,
        identifier: assets[0].identifier,
      },
      methods: ["crypto-app"],
      returnUrl: "http://127.0.0.1:3000/",
    }),
    /CRYPTO_QUOTE_REQUIRED/,
  );
});
for (const asset of assets)
  test(`${asset.symbol} ${asset.network}: quote, wallet action, durable receipt, fee, settlement and reconciliation`, async () => {
    const checkout = await createCryptoCheckout(
        orgId,
        "sandbox",
        randomUUID(),
        input,
        market,
      ),
      token = checkout.checkoutPath.split("#")[1];
    const initial = await progress(checkout.id, token);
    assert.equal(initial.method, "crypto-app");
    assert.equal(initial.cryptoQuote?.usdAmount, "10.00");
    const option = initial.paymentOptions.find(
      (o) => o.network === asset.network,
    )!;
    await choosePaymentOption(checkout.id, token, option.id);
    await methods(checkout.id, token);
    const route = await selectMethod(checkout.id, token, "crypto-app");
    const created = await confirm(checkout.id, token, route.routeId);
    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: created.attemptId },
      include: { intent: true },
    });
    const adapterModule = nativeModules.find(
        (m) => m.id === "evm-native-deposit",
      )!,
      original = adapterModule.create;
    const txHash = `0x${randomBytes(32).toString("hex")}`,
      blockHash = `0x${randomBytes(32).toString("hex")}`,
      sender = `0x${"b".repeat(40)}`;
    let head = 100n;
    try {
      adapterModule.create = (config, deps) =>
        nativeDepositExecutionAdapter(config, {
          ...deps,
          http: async (_base, options) => {
            const request = JSON.parse(options.body!),
              binding = await db.depositBinding.findUnique({
                where: { attemptId: attempt.id },
              });
            const tx = {
              hash: txHash,
              blockHash,
              blockNumber: "0x65",
              to: binding?.address,
              from: sender,
              input: "0x",
              value: `0x${tokenMinor(attempt.intent.amount, 18).toString(16)}`,
            };
            const block = {
              number: "0x65",
              hash: blockHash,
              timestamp: `0x${BigInt(Math.floor((attempt.intent.expiresAt.getTime() - 1000) / 1000)).toString(16)}`,
              transactions: binding ? [tx] : [],
            };
            const result =
              request.method === "eth_chainId"
                ? `0x${BigInt(asset.network.split(":")[1]).toString(16)}`
                : request.method === "eth_blockNumber"
                  ? `0x${head.toString(16)}`
                  : request.method === "eth_getBlockByNumber"
                    ? block
                    : request.method === "eth_getTransactionByHash"
                      ? tx
                      : request.method === "eth_getTransactionReceipt"
                        ? {
                            transactionHash: txHash,
                            blockHash,
                            blockNumber: "0x65",
                            status: "0x1",
                            to: binding?.address,
                            from: sender,
                          }
                        : null;
            return {
              status: 200,
              headers: {},
              body: JSON.stringify({ id: request.id, jsonrpc: "2.0", result }),
            };
          },
        });
      const integration = await db.integration.findUniqueOrThrow({
        where: { id: attempt.integrationId },
      });
      const { resolveExecutionAdapter } =
        await import("../../lib/payments/execution");
      const adapter = resolveExecutionAdapter(integration);
      await dispatch(attempt.id);
      const instructions = await progress(checkout.id, token);
      assert.equal(instructions.attemptState, "Requires action");
      const action = instructions.action as {
        kind: string;
        address: string;
        symbol: string;
        network: string;
        identifier: string;
        amount: string;
      };
      assert.equal(action.kind, "deposit");
      assert.equal(action.symbol, asset.symbol);
      assert.equal(action.network, asset.network);
      assert.equal(action.identifier, asset.identifier);
      assert.equal(action.amount, attempt.intent.amount);
      assert.match(action.address, /^0x[0-9a-f]{40}$/);
      head = 101n;
      const fact = await adapter.status(attempt, attempt.intent);
      assert.equal(fact?.state, "Confirmed");
      const binding = await db.depositBinding.findUniqueOrThrow({
        where: { attemptId: attempt.id },
      });
      assert.equal(
        binding.acceptBefore!.getTime(),
        attempt.intent.expiresAt.getTime(),
      );
      const afterExpiry = new Date(attempt.intent.expiresAt.getTime() + 60000);
      await db.paymentException.create({
        data: {
          intentId: attempt.intentId,
          code: "AGED_PENDING",
          evidence: json({ attemptId: attempt.id, state: "Pending" }),
          timeline: json([
            { at: new Date().toISOString(), action: "Detected" },
          ]),
        },
      });
      await applyFact(attempt.id, fact!, afterExpiry);
      await applyFact(attempt.id, fact!, afterExpiry);
      await settle(attempt.id, afterExpiry);
      await settle(attempt.id, afterExpiry);
      assert.equal(
        (await reconcile(attempt.id, afterExpiry)).result,
        "Exact match",
      );
      assert.equal(
        (
          await db.paymentException.findUniqueOrThrow({
            where: {
              intentId_code: {
                intentId: attempt.intentId,
                code: "AGED_PENDING",
              },
            },
          })
        ).state,
        "Resolved",
      );
      await db.paymentException.create({
        data: {
          intentId: attempt.intentId,
          code: "MANUAL_REVIEW_REQUIRED",
          evidence: json({ test: "Fictional unrelated exception" }),
        },
      });
      assert.equal(
        (await reconcile(attempt.id, afterExpiry)).result,
        "Unresolved exception",
      );
      assert.equal(
        (
          await db.paymentException.findUniqueOrThrow({
            where: {
              intentId_code: {
                intentId: attempt.intentId,
                code: "MANUAL_REVIEW_REQUIRED",
              },
            },
          })
        ).state,
        "Unresolved",
      );
      assert.equal(
        await db.depositClaim.count({ where: { attemptId: attempt.id } }),
        1,
      );
      assert.equal(
        await db.paymentException.count({
          where: { intentId: attempt.intentId, code: "LATE_PAYMENT" },
        }),
        0,
      );
      const settled = await progress(checkout.id, token);
      assert.equal(settled.state, "Confirmed");
      assert.deepEqual(settled.settlement, ["Completed"]);
      const fee = await db.paymentFee.findUniqueOrThrow({
        where: { intentId: attempt.intentId },
      });
      assert.equal(fee.amountMinor.toString(), "0");
    } finally {
      adapterModule.create = original;
    }
  });
