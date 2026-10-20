// Cross-chain checkout against the local database with a fake 1Click: a
// production crypto checkout awaiting an exact USDC transfer on Base is paid
// from Tron USDT instead.
import "dotenv/config";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { hash } from "../../lib/payments/contracts";
import { crossChainOptions, crossChainQuote, crossChainStatus } from "../../lib/intents/checkout";
import { resetTokenCache, type Http } from "../../lib/intents/oneclick";

const usdcBase = { kind: "blockchain", network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
const tronUsdt = "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near";
const baseUsdc = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
let orgId: string;

before(async () => {
  if (process.env.PORTAL_MODE !== "local" || !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta"))
    throw new Error("Isolated local database required");
  orgId = `cross-chain-${randomUUID()}`;
  await db.organization.create({ data: { id: orgId, name: "Fictional cross-chain tests", fictional: true } });
  await db.merchantConfig.create({ data: { orgId, returnOrigin: "http://127.0.0.1:3000", environment: "production" } });
});
after(() => db.$disconnect());

async function awaitingTransfer(environment = "production", minutes = 30) {
  const receive = `0x${randomBytes(20).toString("hex")}`;
  const intent = await db.paymentIntent.create({
    data: {
      orgId,
      environment,
      reference: "order-cc",
      amount: "40.000000",
      asset: json(usdcBase),
      precision: 6,
      methods: json(["stablecoin"]),
      settlement: json(usdcBase),
      returnUrl: "http://127.0.0.1:3000/done",
      metadata: json({}),
      key: randomUUID(),
      fingerprint: randomUUID(),
      contextId: randomUUID(),
      state: "Processing",
      expiresAt: new Date(Date.now() + minutes * 60000),
    },
  });
  await db.paymentAttempt.create({
    data: {
      intentId: intent.id,
      number: 1,
      profileId: "deposit:fixture",
      providerOrgId: orgId,
      integrationId: randomUUID(),
      environment,
      routeId: randomUUID(),
      key: `attempt:${randomUUID()}`,
      fingerprint: intent.fingerprint,
      state: "Requires action",
      action: json({ kind: "deposit", address: receive, network: usdcBase.network, identifier: usdcBase.identifier, amount: "40.000000", symbol: "USDC", provider: "PayRouta", text: "Send USDC" }),
    },
  });
  const token = randomBytes(32).toString("base64url");
  const session = await db.checkoutSession.create({ data: { intentId: intent.id, verifier: hash(token), expiresAt: intent.expiresAt } });
  return { id: session.id, token, receive, intentId: intent.id };
}

function fakeOneClick(over: { amountOut?: string; status?: string } = {}) {
  const calls: { path: string; body?: string }[] = [];
  const http: Http = async (_base, o) => {
    calls.push(o);
    const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), bytes: 0 });
    if (o.path === "/v0/tokens")
      return reply([
        { assetId: baseUsdc, decimals: 6, blockchain: "base", symbol: "USDC", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
        { assetId: tronUsdt, decimals: 6, blockchain: "tron", symbol: "USDT", contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
      ]);
    if (o.path === "/v0/quote")
      return reply({ quote: { depositAddress: `T${randomBytes(16).toString("hex")}`, amountIn: "40180000", amountInFormatted: "40.18", amountOut: over.amountOut ?? JSON.parse(o.body!).amount, timeEstimate: 30 } });
    return reply({ status: over.status ?? "PROCESSING", swapDetails: {} });
  };
  return { http, calls };
}

test("cross-chain: a customer pays a Base USDC invoice with Tron USDT; the merchant receives the exact amount", async () => {
  resetTokenCache();
  const c = await awaitingTransfer();
  const { http, calls } = fakeOneClick();
  const options = await crossChainOptions(c.id, c.token, { http, enabled: true });
  assert.equal(options.available, true);
  assert.deepEqual(options.assets.map((a) => a.assetId), [tronUsdt], "the invoice token itself is not offered");
  const payment = await crossChainQuote(c.id, c.token, { originAsset: tronUsdt, refundTo: "TRefundAddress000000000000000000" }, { http, enabled: true });
  assert.equal(payment.send, "40.18");
  assert.equal(payment.chainName, "Tron");
  const sent = JSON.parse(calls.find((x) => x.path === "/v0/quote")!.body!);
  assert.equal(sent.recipient, c.receive, "delivered to the merchant's receive address for this attempt");
  assert.equal(sent.amount, "40000000");
  const stored = await db.crossChainPayment.findFirstOrThrow({ where: { intentId: c.intentId } });
  assert.equal(stored.amountOut, "40000000");
  assert.equal((await crossChainStatus(c.id, c.token, { http })).payment!.status, "PROCESSING");
});

test("cross-chain: refuses anything but an exact quote, sandbox, and checkouts about to expire", async () => {
  resetTokenCache();
  const c = await awaitingTransfer();
  await assert.rejects(
    crossChainQuote(c.id, c.token, { originAsset: tronUsdt, refundTo: "TRefundAddress000000000000000000" }, { http: fakeOneClick({ amountOut: "39990000" }).http, enabled: true }),
    /CROSS_CHAIN_QUOTE_MISMATCH/,
  );
  await assert.rejects(
    crossChainQuote(c.id, c.token, { originAsset: tronUsdt, refundTo: "0x123" }, { http: fakeOneClick().http, enabled: true }),
    /CROSS_CHAIN_REFUND_ADDRESS_INVALID/,
  );
  await assert.rejects(
    crossChainQuote(c.id, c.token, { originAsset: tronUsdt, refundTo: "TRefundAddress000000000000000000" }, { http: fakeOneClick().http, enabled: false }),
    /CROSS_CHAIN_OFF/,
  );
  const sandbox = await awaitingTransfer("sandbox");
  assert.equal((await crossChainOptions(sandbox.id, sandbox.token, { http: fakeOneClick().http, enabled: true })).reason, "CROSS_CHAIN_LIVE_ONLY");
  const late = await awaitingTransfer("production", 3);
  assert.equal((await crossChainOptions(late.id, late.token, { http: fakeOneClick().http, enabled: true })).reason, "CROSS_CHAIN_TOO_LATE");
});
