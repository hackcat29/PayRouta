// The demo checkout (/checkout/demo): the real checkout pages against a
// fictional order. Live data where it can be, a dry 1Click quote, a
// simulated payment, and nothing payable.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { demoAction, demoProgress, readDemoState, writeDemoState, type DemoState } from "../lib/payments/demo-checkout";
import { destinations, resetTokenCache, type Http } from "../lib/intents/oneclick";

const ok = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), bytes: 0 });
const usdcBase = destinations.find((d) => d.network === "eip155:8453" && d.symbol === "USDC")!;
const ethArb = "nep141:arb.omft.near";
const list = [
  { assetId: ethArb, decimals: 18, blockchain: "arb", symbol: "ETH", price: 2000, coingeckoId: "ethereum" },
  { assetId: usdcBase.assetId, decimals: 6, blockchain: "base", symbol: "USDC", price: 1, contractAddress: usdcBase.contract, coingeckoId: "usd-coin" },
  { assetId: "nep141:sol.omft.near", decimals: 9, blockchain: "sol", symbol: "SOL", price: 80, coingeckoId: "solana" },
];
let quoted: Record<string, unknown> | undefined;
const http: Http = async (_base, o) => {
  if (o.path === "/v0/tokens") return ok(list);
  if (o.path === "/v0/quote") {
    quoted = JSON.parse(o.body!);
    // A dry quote: amounts, no deposit address.
    return ok({ quote: { amountIn: "12523572998738231", amountInFormatted: "0.012523572998738231", amountOut: quoted!.amount, timeEstimate: 27 } });
  }
  throw new Error(`unexpected ${o.path}`);
};
const t0 = Date.parse("2026-11-12T12:00:00Z");
const start = (): DemoState => ({ v: 1, kind: "crypto", startedAt: t0 });
async function run(s: DemoState, action: string, extra: Record<string, unknown> = {}, now = t0 + 1000) {
  return demoAction(s, { action, ...extra }, { http, now });
}

beforeEach(() => {
  resetTokenCache();
  quoted = undefined;
  process.env.PAYROUTA_INTENTS_FEE_ACCOUNT = "payrouta-fees.near";
});

test("demo: the order is $25.00 in USDC on Base, nothing chosen yet", () => {
  const p = demoProgress(start(), t0) as Record<string, unknown>;
  assert.equal(p.demo, true);
  assert.equal(p.amount, "25.00");
  assert.equal(p.symbol, "USDC");
  assert.equal(p.network, "eip155:8453");
  assert.equal(p.state, "Created");
  assert.equal(p.attemptId, undefined);
  assert.deepEqual(p.alternatives, [{ kind: "fiat", available: true }]);
});

test("demo: every NEAR Intents token is offered, each swapped into the merchant's USDC", async () => {
  const { body } = await run(start(), "pay-options");
  const o = body as { settle: { symbol: string; amount: string }; chains: { id: string; tokens: { route: string; assetId?: string; approx?: string }[] }[] };
  assert.deepEqual(o.settle, { symbol: "USDC", amount: "25.00" });
  const all = o.chains.flatMap((c) => c.tokens);
  assert.equal(all.length, list.length);
  assert.ok(all.every((t) => t.route === "swap"));
  assert.equal(all.find((t) => t.assetId === ethArb)?.approx, "0.0125");
});

test("demo: a token's quote is a real 1Click quote, made dry, for the invoice less PayRouta's fee", async () => {
  let s = (await run(start(), "confirm")).state;
  assert.equal(s.chosen, true);
  const action = (demoProgress(s, t0) as { action?: { kind: string; amount: string } }).action;
  assert.equal(action?.kind, "intents");
  const r = await run(s, "cross-chain-quote", { originAsset: ethArb, refundTo: "demo" });
  s = r.state;
  assert.equal(quoted!.dry, true, "nothing is reserved");
  assert.equal(quoted!.swapType, "EXACT_OUTPUT");
  assert.equal(quoted!.destinationAsset, usdcBase.assetId);
  assert.equal(quoted!.amount, "24625000", "25.00 USDC less 1.5%");
  assert.equal(quoted!.recipientType, "INTENTS");
  assert.equal(quoted!.refundType, "INTENTS");
  assert.deepEqual(quoted!.appFees, [{ recipient: "payrouta-fees.near", fee: 150 }]);
  const pay = r.body as { demo: boolean; send: string; depositAddress: string; status: string; receive: { amount: string }; fee: { amount: string } };
  assert.equal(pay.demo, true);
  assert.equal(pay.send, "0.012523572998738231");
  assert.equal(pay.depositAddress, "", "no deposit address exists");
  assert.equal(pay.status, "PENDING_DEPOSIT");
  assert.equal(pay.receive.amount, "24.625");
  assert.equal(pay.fee.amount, "0.375");
});

test("demo: a simulated payment is seen, swapped, then confirmed", async () => {
  let s = (await run(start(), "confirm")).state;
  s = (await run(s, "cross-chain-quote", { originAsset: ethArb, refundTo: "demo" })).state;
  s = (await run(s, "demo-pay", {}, t0 + 10000)).state;
  const status = async (at: number) => ((await run(s, "cross-chain-status", {}, at)).body as { payment: { status: string } }).payment.status;
  assert.equal(await status(t0 + 11000), "KNOWN_DEPOSIT_TX");
  assert.equal(await status(t0 + 15000), "PROCESSING");
  assert.equal(await status(t0 + 20000), "SUCCESS");
  assert.equal((demoProgress(s, t0 + 15000) as { state: string }).state, "Created");
  assert.equal((demoProgress(s, t0 + 20000) as { state: string }).state, "Confirmed");
});

test("demo: signing, sending and wallet transactions are refused", async () => {
  for (const action of ["dex-solana", "dex-evm", "swap-wallet-transaction", "prepare-wallet", "submit-wallet", "exchange"])
    await assert.rejects(run(start(), action), /DEMO_NOT_PAYABLE/, action);
});

test("demo: card, wallet, bank and credit run the sandbox flow with the fictional lender", async () => {
  let s = (await run(start(), "switch", { to: "fiat" })).state;
  assert.equal(s.kind, "fiat");
  const p = demoProgress(s, t0) as { asset: { kind: string; identifier: string } };
  assert.deepEqual(p.asset, { kind: "fiat", identifier: "USD" });
  const methods = (await run(s, "methods")).body as { methods: { method: string; status: string }[] };
  assert.deepEqual(methods.methods.map((m) => m.method), ["card", "digital-wallet", "bank-transfer", "bnpl"]);
  const offers = ((await run(s, "credit-offers")).body as { offers: { key: string; lender: string; totalMinor: string }[] }).offers;
  assert.ok(offers.length >= 3);
  assert.ok(offers.every((o) => o.lender.includes("fictional")));
  await assert.rejects(run(s, "select", { method: "bnpl" }), /CREDIT_PLAN_REQUIRED/);
  s = (await run(s, "select", { method: "card" })).state;
  await run(s, "confirm");
  assert.equal((demoProgress(s, t0) as { action: { kind: string } }).action.kind, "sandbox");
  s = (await run(s, "complete", {}, t0 + 5000)).state;
  assert.equal((demoProgress(s, t0 + 5000) as { state: string }).state, "Confirmed");
  await assert.rejects(run(s, "switch", { to: "crypto" }), /PAYMENT_ALREADY_IN_PROGRESS/);
});

test("demo: the state cookie round-trips; a tampered or expired one starts over", () => {
  const s: DemoState = { v: 1, kind: "fiat", startedAt: t0, method: "card" };
  assert.deepEqual(readDemoState(writeDemoState(s), t0 + 1000), s);
  assert.deepEqual(readDemoState("not-json", t0), { v: 1, kind: "crypto", startedAt: t0 });
  const tampered = Buffer.from(JSON.stringify({ ...s, method: "cash" })).toString("base64url");
  assert.deepEqual(readDemoState(tampered, t0), { v: 1, kind: "crypto", startedAt: t0 });
  assert.equal(readDemoState(writeDemoState(s), t0 + 31 * 60000).kind, "crypto", "a demo older than its window starts over");
});
