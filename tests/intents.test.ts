import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenAsset } from "../lib/blockchain/assets";
import { destinationFor, destinations, oneClickKey, oneClickRequest, quote, resetTokenCache, status, tokens, type Http } from "../lib/intents/oneclick";

const ok = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), bytes: 0 });

test("every 1Click destination is a registered PayRouta mainnet stablecoin with the same decimals", () => {
  assert.ok(destinations.length >= 10);
  for (const d of destinations) {
    const registered = tokenAsset(d.network, d.identifier);
    assert.ok(registered, `${d.network} ${d.identifier} is registered`);
    assert.equal(registered!.symbol, d.symbol);
    assert.equal(registered!.decimals, d.decimals);
    assert.equal(registered!.contractAddress!.toLowerCase(), d.contract.toLowerCase());
  }
  assert.equal(destinationFor("eip155:84532", "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e"), undefined, "no testnet destinations");
});

test("quotes ask for an exact-output swap to the merchant's receive address, refunded on the origin chain", async () => {
  let sent: { path: string; body?: string } | undefined;
  const http: Http = async (_base, o) => {
    sent = o;
    return ok({ quote: { depositAddress: "TXyz1234567890abcdefghij", amountIn: "40210000", amountInFormatted: "40.21", amountOut: "40000000", timeEstimate: 20 } });
  };
  const deadline = new Date("2026-10-20T12:00:00Z");
  const r = await quote(
    { originAsset: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", destinationAsset: destinations[0].assetId, amountOut: "40000000", recipient: "0x" + "a".repeat(40), refundTo: "TRefund000000000000000000000", deadline },
    http,
  );
  assert.equal(sent!.path, "/v0/quote");
  const body = JSON.parse(sent!.body!);
  assert.equal(body.swapType, "EXACT_OUTPUT");
  assert.equal(body.amount, "40000000");
  assert.equal(body.recipientType, "DESTINATION_CHAIN");
  assert.equal(body.depositType, "ORIGIN_CHAIN");
  assert.equal(body.refundType, "ORIGIN_CHAIN");
  assert.equal(body.dry, false);
  assert.equal(body.deadline, deadline.toISOString());
  assert.equal(r.quote.depositAddress, "TXyz1234567890abcdefghij");
});

test("1Click errors and malformed answers fail closed", async () => {
  const input = { originAsset: "a", destinationAsset: "b", amountOut: "1", recipient: "r".repeat(20), refundTo: "f".repeat(20), deadline: new Date() };
  await assert.rejects(quote(input, async () => ({ status: 400, headers: {}, body: '{"message":"bad"}', bytes: 0 })), /CROSS_CHAIN_QUOTE_REFUSED/);
  // The live API's answer below its minimum (20 October 2026).
  await assert.rejects(
    quote(input, async () => ({ status: 400, headers: {}, body: '{"message":"Temporary swap limits: minimum swap amount is $100"}', bytes: 0 })),
    /CROSS_CHAIN_AMOUNT_TOO_SMALL/,
  );
  // Minimums vary by asset and network; other wordings mean the same.
  await assert.rejects(
    quote(input, async () => ({ status: 400, headers: {}, body: '{"message":"Amount below minimum"}', bytes: 0 })),
    /CROSS_CHAIN_AMOUNT_TOO_SMALL/,
  );
  await assert.rejects(quote(input, async () => ({ status: 429, headers: {}, body: "{}", bytes: 0 })), /CROSS_CHAIN_RATE_LIMITED/);
  await assert.rejects(quote(input, async () => ok({ quote: { amountIn: "x" } })), /CROSS_CHAIN_UNAVAILABLE/);
  await assert.rejects(status("dep", null, async () => ok({ status: "MAYBE" })), /CROSS_CHAIN_UNAVAILABLE/);
  assert.equal(await status("dep", null, async () => ({ status: 404, headers: {}, body: "", bytes: 0 })), null);
  assert.equal((await status("dep", "m1", async (_b, o) => {
    assert.match(o.path, /depositAddress=dep&depositMemo=m1/);
    return ok({ status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: "0x1" }] } });
  }))!.status, "SUCCESS");
});

test("the token list is cached for ten minutes", async () => {
  resetTokenCache();
  let calls = 0;
  const http: Http = async () => {
    calls++;
    return ok([{ assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 150 }]);
  };
  await tokens(http, 1_000_000);
  await tokens(http, 1_000_000 + 599_000);
  assert.equal(calls, 1);
  await tokens(http, 1_000_000 + 601_000);
  assert.equal(calls, 2);
  resetTokenCache();
});

test("1Click answers quotes with 201 Created, and that is a success", async () => {
  const created: Http = async () => ({
    status: 201,
    headers: {},
    body: JSON.stringify({ quote: { depositAddress: "0x" + "b".repeat(40), amountIn: "12471305782322854", amountInFormatted: "0.012471305782322854", amountOut: "24625000", timeEstimate: 25 } }),
    bytes: 0,
  });
  const r = await quote(
    { originAsset: "nep141:arb.omft.near", destinationAsset: destinations[0].assetId, amountOut: "24625000", recipient: "0x" + "a".repeat(40), refundTo: "0x" + "c".repeat(40), deadline: new Date("2026-11-12T12:30:00Z") },
    created,
  );
  assert.equal(r.quote.amountOut, "24625000");
  const failed: Http = async () => ({ status: 502, headers: {}, body: "{}", bytes: 0 });
  await assert.rejects(quote({ originAsset: "nep141:arb.omft.near", destinationAsset: destinations[0].assetId, amountOut: "1", recipient: "0x" + "a".repeat(40), refundTo: "0x" + "c".repeat(40), deadline: new Date() }, failed), /CROSS_CHAIN_UNAVAILABLE/);
});

test("1Click partner key: sent as X-API-Key when stored, left out when missing, malformed or unreadable", async () => {
  const old = process.env.ONECLICK_API_KEY_REF;
  const quiet = console.error;
  console.error = () => {};
  try {
    delete process.env.ONECLICK_API_KEY_REF;
    assert.equal(await oneClickKey(async () => assert.fail("not read")), undefined);
    process.env.ONECLICK_API_KEY_REF = "00000000-0000-0000-0000-0000000000a1";
    assert.equal(await oneClickKey(async () => "  header.payload.signature\n"), "header.payload.signature");
    assert.equal(await oneClickKey(async () => "header.payload\nsecond-line"), undefined);
    assert.equal(await oneClickKey(async () => { throw new Error("Secret is unavailable or revoked"); }), undefined);
  } finally {
    console.error = quiet;
    if (old === undefined) delete process.env.ONECLICK_API_KEY_REF;
    else process.env.ONECLICK_API_KEY_REF = old;
  }
});

test("1Click requests carry the partner key, and a refused key (401) is retried without it", async () => {
  const sent: (string | undefined)[] = [];
  const answer = (status: number): Http => async (_base, o) => {
    sent.push((o.headers as Record<string, string> | undefined)?.["X-API-Key"]);
    return { status: sent.length === 1 ? status : 201, headers: {}, body: "{}", bytes: 0 };
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    let r = await oneClickRequest(answer(201), { method: "POST", path: "/v0/quote", body: "{}" }, async () => "jwt");
    assert.equal(r.status, 201);
    assert.deepEqual(sent, ["jwt"], "one request, with the key");
    sent.length = 0;
    r = await oneClickRequest(answer(401), { method: "POST", path: "/v0/quote", body: "{}" }, async () => "revoked-jwt");
    assert.equal(r.status, 201);
    assert.deepEqual(sent, ["revoked-jwt", undefined], "refused with the key, then answered without it");
    sent.length = 0;
    await oneClickRequest(answer(201), { method: "GET", path: "/v0/tokens" }, async () => undefined);
    assert.deepEqual(sent, [undefined], "no key, no header");
  } finally {
    console.error = quiet;
  }
});
