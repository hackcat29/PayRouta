import { test } from "node:test";
import assert from "node:assert/strict";
import { destinations, dryQuote, quote, resetTokenCache, type Http } from "../lib/intents/oneclick";
import { demoQuote } from "../lib/intents/demo";

const created = (body: unknown) => ({ status: 201, headers: {}, body: JSON.stringify(body), bytes: 0 });
const base = destinations[0];
const list = [
  { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 95 },
  { assetId: base.assetId, decimals: 6, blockchain: "base", symbol: "USDC", price: 1 },
  { assetId: "nep141:wrap.near", decimals: 24, blockchain: "near", symbol: "wNEAR", price: 4 },
];

test("1Click quotes answered with 201 Created are accepted", async () => {
  const r = await quote(
    { originAsset: list[0].assetId, destinationAsset: base.assetId, amountOut: "25000000", recipient: "0x" + "a".repeat(40), refundTo: "So1ana1111111111111111111111111111", deadline: new Date("2026-11-05T12:00:00Z") },
    async () => created({ quote: { depositAddress: "So1Deposit111111111111111", amountIn: "263000000", amountInFormatted: "0.263", amountOut: "25000000" } }),
  );
  assert.equal(r.quote.amountOut, "25000000");
});

test("dry quotes are dry and deliver nowhere a customer could pay", async () => {
  let body: Record<string, unknown> = {};
  await dryQuote({ originAsset: list[0].assetId, destinationAsset: base.assetId, amount: "25000000", deadline: new Date("2026-11-05T12:00:00Z") }, async (_b, o) => {
    body = JSON.parse(o.body!);
    return created({ quote: { amountIn: "1", amountInFormatted: "1", amountOut: "25000000", amountOutFormatted: "25.0" } });
  });
  assert.equal(body.dry, true);
  assert.equal(body.swapType, "EXACT_OUTPUT");
  assert.equal(body.recipientType, "INTENTS");
});

test("the demo prices the customer's token for an exact merchant amount, then the merchant's conversion", async () => {
  resetTokenCache();
  const quotes: Record<string, unknown>[] = [];
  const http: Http = async (_b, o) => {
    if (o.path === "/v0/tokens") return { status: 200, headers: {}, body: JSON.stringify(list), bytes: 0 };
    const q = JSON.parse(o.body!);
    quotes.push(q);
    return q.swapType === "EXACT_OUTPUT"
      ? created({ quote: { amountIn: "264000000", amountInFormatted: "0.264", amountInUsd: "25.08", amountOut: q.amount, amountOutFormatted: "25.0", minAmountOut: q.amount, timeEstimate: 20 } })
      : created({ quote: { amountIn: q.amount, amountInFormatted: "25.0", amountOut: "6", amountOutFormatted: "6.21", timeEstimate: 10 } });
  };
  const r = await demoQuote({ originAsset: list[0].assetId, receive: { kind: "token", assetId: "nep141:wrap.near" }, usd: 25 }, { http, now: new Date("2026-11-05T12:00:00Z") });
  assert.equal(r.route, "intents");
  assert.equal(r.pay.amount, "0.264");
  assert.equal(r.deliver.symbol, "USDC");
  assert.deepEqual(r.convert, { amount: "6.21", symbol: "wNEAR", chainName: "NEAR" });
  assert.ok(quotes.every((q) => q.dry === true), "only dry quotes");
  assert.equal(quotes.find((q) => q.swapType === "EXACT_OUTPUT")!.amount, "25000000");
  resetTokenCache();
});

test("paying in the merchant's own settlement stablecoin needs no swap", async () => {
  resetTokenCache();
  const http: Http = async (_b, o) => {
    assert.equal(o.path, "/v0/tokens", "no quote requested");
    return { status: 200, headers: {}, body: JSON.stringify(list), bytes: 0 };
  };
  const r = await demoQuote({ originAsset: base.assetId, receive: { kind: "stable", assetId: base.assetId }, usd: 25 }, { http });
  assert.equal(r.route, "direct");
  assert.equal(r.pay.amount, "25.00");
  resetTokenCache();
});
