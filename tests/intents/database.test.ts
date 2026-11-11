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
import { crossChainOptions, crossChainQuote, crossChainStatus, intentsFundedQuote, submitFundedIntent } from "../../lib/intents/checkout";
import { swapSolanaTransaction } from "../../lib/intents/swap-wallet";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { dexEvmQuote, dexSolanaTransaction, lifiDiamond } from "../../lib/intents/dex";
import { getAssociatedTokenAddressSync } from "../../lib/blockchain/solana-token";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { resetTokenCache, type Http } from "../../lib/intents/oneclick";
import { logo, tokenLogo, warmLogos } from "../../lib/intents/token-logos";
import { databaseIntentsSwaps } from "../../lib/intents/swaps";
import { databaseDepositStore } from "../../lib/blockchain/deposit-store";
import { intentsDepositExecutionAdapter } from "../../lib/providers/adapters/native/near-intents-deposit";

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

// Settlement into the merchant's own NEAR Intents account: the checkout takes
// any token including the invoice token, the quote delivers into the account,
// and the adapter confirms from the swap's NEAR delivery, which can pay one
// checkout only.
async function settlingIntoIntents(account: string, integrationId: string) {
  const c = await awaitingTransfer();
  await db.paymentIntent.update({ where: { id: c.intentId }, data: { selectedMethod: "stablecoin" } });
  const attempt = await db.paymentAttempt.findFirstOrThrow({ where: { intentId: c.intentId } });
  await db.paymentAttempt.update({
    where: { id: attempt.id },
    data: {
      integrationId,
      action: json({ kind: "intents", address: account, network: usdcBase.network, identifier: usdcBase.identifier, amount: "40.000000", symbol: "USDC", provider: "NEAR Intents", text: "Pay" }),
    },
  });
  return { ...c, attempt: { id: attempt.id, key: attempt.key, environment: "production" } };
}

test("near intents: a checkout settles into the merchant's account and the delivery confirms it once", async () => {
  resetTokenCache();
  const account = `shop${randomBytes(6).toString("hex")}.near`;
  const owner = await db.intentsAccount.create({
    data: { orgId, environment: "production", accountId: account, standard: "nep413", proof: json({}), createdBy: "fixture" },
  });
  const config = { mode: "NATIVE", adapter: "near-intents-deposit", environment: "production", network: usdcBase.network, identifier: usdcBase.identifier, account, intentsAccountId: owner.id };
  const latest = await db.integration.findFirst({ where: { orgId, environment: "production" }, orderBy: { version: "desc" } });
  const integration = await db.integration.create({ data: { orgId, environment: "production", version: (latest?.version ?? 0) + 1, config: json(config) } });
  const c = await settlingIntoIntents(account, integration.id);

  const oneClick = fakeOneClick({ status: "SUCCESS" });
  const options = await crossChainOptions(c.id, c.token, { http: oneClick.http, enabled: true });
  assert.equal(options.intents, true);
  assert.ok(options.assets.some((a) => a.assetId === baseUsdc), "the invoice token itself can pay");
  await crossChainQuote(c.id, c.token, { originAsset: baseUsdc, refundTo: `0x${"b".repeat(40)}` }, { http: oneClick.http, enabled: true });
  const sent = JSON.parse(oneClick.calls.find((x) => x.path === "/v0/quote")!.body!);
  assert.equal(sent.recipientType, "INTENTS");
  assert.equal(sent.recipient, account);
  const swap = await db.crossChainPayment.findFirstOrThrow({ where: { intentId: c.intentId } });
  assert.equal(swap.recipientType, "INTENTS");
  // 1Click reports the swap done with its intents and NEAR transaction.
  await db.crossChainPayment.update({
    where: { id: swap.id },
    data: { status: "SUCCESS", details: json({ intentHashes: ["SwapIntentA"], nearTxHashes: ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"] }) },
  });

  const delivered = {
    final_execution_status: "FINAL",
    receipts_outcome: [
      {
        id: `Receipt${randomBytes(8).toString("hex")}`,
        block_hash: "BlockHash111111111111111111111111111111111",
        outcome: {
          executor_id: "intents.near",
          status: { SuccessValue: "" },
          logs: [
            `EVENT_JSON:${JSON.stringify({ standard: "dip4", version: "0.4.3", event: "transfer", data: [{ intent_hash: "SwapIntentA", account_id: "q".repeat(64), receiver_id: account, tokens: { [baseUsdc]: "40000000" } }] })}`,
            `EVENT_JSON:${JSON.stringify({ standard: "nep245", version: "1.0.0", event: "mt_transfer", data: [{ old_owner_id: "q".repeat(64), new_owner_id: account, token_ids: [baseUsdc], amounts: ["40000000"] }] })}`,
          ],
        },
      },
    ],
  };
  const near = async (_base: string, o: { body?: string }) => {
    const rpc = JSON.parse(o.body!);
    const result = rpc.method === "block" ? { header: { height: 222300000 } } : delivered;
    return { status: 200, headers: {}, body: JSON.stringify({ result }) };
  };
  const adapter = (id: string) =>
    intentsDepositExecutionAdapter(config, { http: near, credentials: { get: async () => "" }, deposits: databaseDepositStore(id), swaps: databaseIntentsSwaps });
  const intent = { reference: "order-cc", amount: "40.000000", asset: usdcBase, selectedMethod: "stablecoin", precision: 6 };
  await adapter(integration.id).create(c.attempt, intent);
  const binding = await db.depositBinding.findUniqueOrThrow({ where: { attemptId: c.attempt.id } });
  assert.ok(binding.address.startsWith(`${account}/`));
  assert.equal((await adapter(integration.id).status(c.attempt))!.state, "Confirmed");
  const claim = await db.depositClaim.findUniqueOrThrow({ where: { attemptId: c.attempt.id } });
  assert.equal(claim.txHash, "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
  // Re-reading the evidence (as settlement does) keeps the same claim.
  assert.equal((await adapter(integration.id).status(c.attempt))!.state, "Confirmed");

  // A second checkout pointing at the same delivery can't claim it.
  const other = await settlingIntoIntents(account, integration.id);
  await adapter(integration.id).create(other.attempt, intent);
  await db.crossChainPayment.create({
    data: {
      intentId: other.intentId,
      attemptId: other.attempt.id,
      environment: "production",
      provider: "near-intents",
      originAsset: baseUsdc,
      originChain: "base",
      originSymbol: "USDC",
      destinationAsset: baseUsdc,
      recipientType: "INTENTS",
      depositAddress: `dep${randomBytes(8).toString("hex")}`,
      amountIn: "40400000",
      amountInFormatted: "40.4",
      amountOut: "40000000",
      refundTo: `0x${"b".repeat(40)}`,
      deadline: new Date(Date.now() + 600000),
      quote: json({}),
      status: "SUCCESS",
      details: json({ intentHashes: ["SwapIntentA"], nearTxHashes: ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"] }),
    },
  });
  await assert.rejects(adapter(integration.id).status(other.attempt), /DEPOSIT_ALREADY_CLAIMED/);
});

// An AI agent pays from its NEAR Intents balance: one signed transfer
// intent, checked before it's handed out and verified before it's submitted.
test("near intents: an agent pays from its intents balance by signing one transfer", async () => {
  resetTokenCache();
  const c = await awaitingTransfer();
  const secret = secp256k1.utils.randomPrivateKey();
  const payer = `0x${Buffer.from(keccak_256(secp256k1.getPublicKey(secret, false).slice(1)).slice(-20)).toString("hex")}`;
  const deposit = randomBytes(32).toString("hex");
  const sent: { path: string; body?: string }[] = [];
  let payload = "";
  const http: Http = async (_base, o) => {
    sent.push(o);
    const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), bytes: 0 });
    if (o.path === "/v0/tokens")
      return reply([{ assetId: baseUsdc, decimals: 6, blockchain: "base", symbol: "USDC", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }]);
    if (o.path === "/v0/quote")
      return reply({ quote: { depositAddress: deposit, amountIn: "40004000", amountInFormatted: "40.004", amountOut: "40000000", timeEstimate: 10 } });
    if (o.path === "/v0/generate-intent") {
      payload = JSON.stringify({
        verifying_contract: "intents.near",
        signer_id: payer,
        deadline: "2026-11-02T16:20:36.000Z",
        nonce: randomBytes(32).toString("base64"),
        intents: [{ intent: "transfer", receiver_id: deposit, tokens: { [baseUsdc]: "40004000" } }],
      });
      return reply({ intent: { standard: "erc191", payload }, correlationId: "c" });
    }
    if (o.path === "/v0/submit-intent") return reply({ intentHash: "IntentHash1", correlationId: "c" });
    return reply({ status: "PENDING_DEPOSIT", swapDetails: {} });
  };
  const q = await intentsFundedQuote(c.id, c.token, { originAsset: baseUsdc, payer }, { http, enabled: true });
  const body = JSON.parse(sent.find((x) => x.path === "/v0/quote")!.body!);
  assert.deepEqual([body.depositType, body.refundType, body.refundTo, body.recipient], ["INTENTS", "INTENTS", payer, c.receive]);
  assert.equal(q.sign.standard, "erc191");
  const record = await db.crossChainPayment.findUniqueOrThrow({ where: { id: q.payment } });
  assert.deepEqual([record.fundedBy, record.payer, record.status], ["INTENTS", payer, "AWAITING_SIGNATURE"]);

  const sign = (text: string) => {
    const bytes = new TextEncoder().encode(text);
    const s = secp256k1.sign(keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${bytes.length}`), bytes])), secret);
    return `0x${s.toCompactHex()}${(27 + s.recovery).toString(16)}`;
  };
  await assert.rejects(submitFundedIntent(c.id, c.token, { payment: q.payment, signature: sign("something else") }, { http }), /INTENTS_SIGNATURE_INVALID/);
  const done = await submitFundedIntent(c.id, c.token, { payment: q.payment, signature: sign(payload) }, { http });
  assert.equal(done.intentHash, "IntentHash1");
  const submitted = JSON.parse(sent.find((x) => x.path === "/v0/submit-intent")!.body!);
  assert.equal(submitted.signedData.standard, "erc191");
  assert.match(submitted.signedData.signature, /^secp256k1:/);
  // A signed intent can't be submitted twice.
  await assert.rejects(submitFundedIntent(c.id, c.token, { payment: q.payment, signature: sign(payload) }, { http }), /INTENTS_QUOTE_EXPIRED/);
});

test("cross-chain: a swap is paid from the customer's wallet; Solana gets a prepared transfer", async () => {
  resetTokenCache();
  const c = await awaitingTransfer();
  const solUsdc = "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near";
  const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const deposit = Keypair.generate().publicKey.toBase58();
  const payer = Keypair.generate().publicKey.toBase58();
  const rpc: string[] = [];
  const http: Http = async (base, o) => {
    const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), bytes: 0 });
    if (o.path === "/v0/tokens")
      return reply([
        { assetId: baseUsdc, decimals: 6, blockchain: "base", symbol: "USDC", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
        { assetId: solUsdc, decimals: 6, blockchain: "sol", symbol: "USDC", contractAddress: mint },
      ]);
    if (o.path === "/v0/quote")
      return reply({ quote: { depositAddress: deposit, amountIn: "40180000", amountInFormatted: "40.18", amountOut: JSON.parse(o.body!).amount, timeEstimate: 45 } });
    if (o.path === "/") {
      const { method } = JSON.parse(o.body!);
      rpc.push(`${base} ${method}`);
      return reply({
        jsonrpc: "2.0",
        id: 1,
        result:
          method === "getLatestBlockhash"
            ? { value: { blockhash: Keypair.generate().publicKey.toBase58() } }
            : { value: { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" } },
      });
    }
    return reply({ status: "PENDING_DEPOSIT", swapDetails: {} });
  };
  const quote = await crossChainQuote(c.id, c.token, { originAsset: solUsdc, refundTo: payer }, { http, enabled: true });
  assert.equal(quote.timeEstimate, 45);
  assert.deepEqual(quote.transfer, { amount: "40180000", decimals: 6, to: deposit, token: mint, family: "solana" });
  // A status read before the deposit lands still lets the wallet pay.
  assert.equal((await crossChainStatus(c.id, c.token, { http })).payment!.transfer?.family, "solana");
  const prepared = await swapSolanaTransaction(c.id, c.token, payer, { http });
  assert.equal(prepared.payer, payer);
  const tx = Transaction.from(Buffer.from(prepared.unsigned, "base64"));
  assert.equal(tx.feePayer!.toBase58(), payer);
  assert.equal(tx.instructions.length, 2, "create the deposit's token account if needed, then transfer");
  const transfer = tx.instructions[1];
  assert.equal(transfer.keys[2].pubkey.toBase58(), getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(deposit)).toBase58());
  assert.equal(transfer.data.readBigUInt64LE(1), 40180000n);
  assert.deepEqual(rpc.map((r) => r.split(" ")[1]), ["getLatestBlockhash", "getAccountInfo"]);
  await assert.rejects(swapSolanaTransaction(c.id, c.token, "not-an-address", { http }), /WALLET_ADDRESS_INVALID/);
});

// Paying with a token found by its address (lib/intents/dex.ts).
const usdcSol = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
async function awaitingSolanaUsdc() {
  const c = await awaitingTransfer();
  const receive = Keypair.generate().publicKey.toBase58();
  await db.paymentAttempt.updateMany({
    where: { intentId: c.intentId },
    data: { action: json({ kind: "deposit", address: receive, network: "solana:mainnet", identifier: `spl:${usdcSol}`, amount: "40.000000", symbol: "USDC", provider: "PayRouta", text: "Send USDC" }) },
  });
  return { ...c, receive };
}
function fakeJupiter(over: { liquidity?: number; impact?: string; shortfall?: boolean; simulationError?: unknown } = {}) {
  const quotes: string[] = [];
  const mint = Keypair.generate().publicKey.toBase58();
  const http: Http = async (base, o) => {
    const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), bytes: 0 });
    if (o.path.startsWith("/tokens/v2/search"))
      return reply([{ id: mint, name: "Fictional Pump Coin", symbol: "FPC", decimals: 6, usdPrice: 0.0001, liquidity: over.liquidity ?? 1_000_000, tokenProgram: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" }]);
    if (o.path.startsWith("/swap/v1/quote")) {
      const amount = BigInt(new URLSearchParams(o.path.split("?")[1]).get("amount")!);
      quotes.push(amount.toString());
      // About 1 USDC per 10,000 FPC, a little less than the token's price says.
      const out = (amount * 98n) / 1_000_000n;
      return reply({ inAmount: amount.toString(), outAmount: out.toString(), otherAmountThreshold: over.shortfall ? "1" : ((out * 99n) / 100n).toString(), swapMode: "ExactIn", priceImpactPct: over.impact ?? "0.004" });
    }
    if (o.path === "/swap/v1/swap-instructions") {
      const payer = JSON.parse(o.body!).userPublicKey;
      const ix = (programId: string, data: number[]) => ({ programId, accounts: [{ pubkey: payer, isSigner: true, isWritable: true }], data: Buffer.from(data).toString("base64") });
      return reply({
        computeBudgetInstructions: [ix("ComputeBudget111111111111111111111111111111", [2, 0, 0, 1, 0])],
        setupInstructions: [],
        swapInstruction: ix("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4", [1, 2, 3]),
        cleanupInstruction: null,
        otherInstructions: [],
        addressLookupTableAddresses: [],
        computeUnitLimit: 300000,
        ...(over.simulationError ? { simulationError: over.simulationError } : {}),
      });
    }
    if (o.path === "/") return reply({ jsonrpc: "2.0", id: 1, result: { value: { blockhash: Keypair.generate().publicKey.toBase58() } } });
    return reply([]);
  };
  return { http, mint, quotes };
}

test("dex: a Solana token pays in one transaction: swap into the payer's USDC, then exactly the payment", async () => {
  const c = await awaitingSolanaUsdc();
  const payer = Keypair.generate().publicKey.toBase58();
  const { http, mint, quotes } = fakeJupiter();
  const r = await dexSolanaTransaction(c.id, c.token, { payer, mint }, { http });
  // The first quote's minimum fell short of 40 USDC, so it sold more.
  assert.equal(quotes.length, 2);
  assert.ok(BigInt(quotes[1]) > BigInt(quotes[0]));
  assert.equal(r.pay.amount, "40000000");
  const tx = VersionedTransaction.deserialize(Buffer.from(r.unsigned, "base64"));
  const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
  const ixs = tx.message.compiledInstructions;
  const last = ixs[ixs.length - 1];
  // Exactly 40 USDC from the payer's USDC account to the merchant's.
  assert.equal(keys[last.programIdIndex], "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  assert.equal(Buffer.from(last.data)[0], 12);
  assert.equal(Buffer.from(last.data).readBigUInt64LE(1), 40000000n);
  assert.equal(keys[last.accountKeyIndexes[2]], getAssociatedTokenAddressSync(new PublicKey(usdcSol), new PublicKey(c.receive)).toBase58());
  assert.equal(keys[last.accountKeyIndexes[0]], getAssociatedTokenAddressSync(new PublicKey(usdcSol), new PublicKey(payer)).toBase58());
  // The swap comes before the payment, in the same transaction.
  assert.ok(ixs.findIndex((i) => keys[i.programIdIndex] === "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4") < ixs.length - 1);
  // Jupiter's compute limit is replaced by one with room for the payment.
  const budget = ixs.filter((i) => keys[i.programIdIndex] === "ComputeBudget111111111111111111111111111111");
  assert.equal(budget.length, 1);
  assert.equal(Buffer.from(budget[0].data).readUInt32LE(1), 380000);
});

test("dex: the swap's minimum must cover the payment, and thin or failing swaps are refused", async () => {
  const c = await awaitingSolanaUsdc();
  const payer = Keypair.generate().publicKey.toBase58();
  const run = (over: Parameters<typeof fakeJupiter>[0]) => {
    const f = fakeJupiter(over);
    return dexSolanaTransaction(c.id, c.token, { payer, mint: f.mint }, { http: f.http });
  };
  await assert.rejects(run({ shortfall: true }), /DEX_NO_ROUTE/);
  await assert.rejects(run({ liquidity: 50 }), /DEX_LIQUIDITY_TOO_LOW/);
  await assert.rejects(run({ impact: "0.4" }), /DEX_PRICE_IMPACT_TOO_HIGH/);
  await assert.rejects(run({ simulationError: { errorCode: "TRANSACTION_ERROR" } }), /DEX_SWAP_WOULD_FAIL/);
  // Base USDC is this checkout's USDC route; Solana has none.
  const base = await awaitingTransfer();
  const f = fakeJupiter();
  await assert.rejects(dexSolanaTransaction(base.id, base.token, { payer, mint: f.mint }, { http: f.http }), /DEX_NO_USDC_ROUTE/);
});

function fakeLifi(over: { to?: string } = {}) {
  const degen = `0x${"4e".repeat(20)}`;
  const deposit = `0x${randomBytes(20).toString("hex")}`;
  const http: Http = async (base, o) => {
    const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body), bytes: 0 });
    if (o.path === "/v0/tokens")
      return reply([
        { assetId: baseUsdc, decimals: 6, blockchain: "base", symbol: "USDC", contractAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" },
        { assetId: "nep141:arb-usdc", decimals: 6, blockchain: "arb", symbol: "USDC", contractAddress: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" },
      ]);
    if (o.path === "/v0/quote")
      return reply({ quote: { depositAddress: deposit, amountIn: "40120000", amountInFormatted: "40.12", amountOut: JSON.parse(o.body!).amount } });
    if (o.path.startsWith("/v1/token")) return reply({ address: degen, symbol: "DEGEN", name: "Degen", decimals: 18, priceUSD: "0.001" });
    if (o.path.startsWith("/v1/quote")) {
      const q = new URLSearchParams(o.path.split("?")[1]);
      const fromAmount = BigInt(q.get("fromAmount")!);
      const toAmount = fromAmount / 1_000_000_000_000_000n;
      return reply({
        action: { fromAddress: q.get("fromAddress"), toAddress: q.get("toAddress"), fromChainId: Number(q.get("fromChain")), toChainId: Number(q.get("toChain")), toToken: q.get("toToken") },
        estimate: { fromAmount: fromAmount.toString(), toAmountMin: ((toAmount * 99n) / 100n).toString(), approvalAddress: over.to ?? lifiDiamond, fromAmountUSD: "41.5", toAmountUSD: "41.2" },
        transactionRequest: { to: over.to ?? "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", data: "0xabcdef", value: "0x0", chainId: Number(q.get("fromChain")) },
      });
    }
    return reply({ status: "PENDING_DEPOSIT", swapDetails: {} });
  };
  return { http, degen, deposit };
}

test("dex: an EVM token swaps into the payer's USDC, then pays exactly the checkout's USDC", async () => {
  resetTokenCache();
  const payer = `0x${"c".repeat(40)}`;
  // Merchant takes USDC on Base: the USDC goes to their receive address.
  const direct = await awaitingTransfer();
  const { http, degen, deposit } = fakeLifi();
  const q = await dexEvmQuote(direct.id, direct.token, { payer, chain: "base", address: degen }, { http });
  assert.deepEqual(q.pay, { token: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "40000000", to: direct.receive, decimals: 6 });
  assert.equal(q.swap.to.toLowerCase(), lifiDiamond);
  assert.equal(q.chainId, 8453);
  // Paying from Arbitrum: USDC there goes to a NEAR Intents swap to the merchant.
  resetTokenCache();
  const viaSwap = await awaitingTransfer();
  await crossChainQuote(viaSwap.id, viaSwap.token, { originAsset: "nep141:arb-usdc", refundTo: payer }, { http, enabled: true });
  const arb = await dexEvmQuote(viaSwap.id, viaSwap.token, { payer, chain: "arb", address: degen }, { http });
  assert.deepEqual(arb.pay, { token: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", amount: "40120000", to: deposit, decimals: 6 });
  // Only LI.FI's own contract is ever approved or called.
  await assert.rejects(dexEvmQuote(direct.id, direct.token, { payer, chain: "base", address: degen }, { http: fakeLifi({ to: `0x${"9".repeat(40)}` }).http }), /DEX_ROUTE_UNEXPECTED/);
  await assert.rejects(dexEvmQuote(direct.id, direct.token, { payer, chain: "op", address: degen }, { http }), /DEX_NO_USDC_ROUTE/);
});

test("logos: fetched once from CoinGecko's image hosts, real images only, a missing one remembered", async () => {
  resetTokenCache();
  const tag = randomBytes(4).toString("hex");
  const chain = `zz${tag}`;
  const [good, none, fake] = [`good-${tag}`, `none-${tag}`, `fake-${tag}`];
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(40)]);
  const asked: string[] = [];
  const http: Http = async (base, o) => {
    asked.push(`${base}${o.path}`);
    const reply = (status: number, body: unknown, buffer?: Buffer) => ({ status, headers: {}, body: typeof body === "string" ? body : JSON.stringify(body), buffer });
    if (o.path === "/v0/tokens")
      return reply(200, [
        { assetId: `nep141:${tag}-a`, decimals: 6, blockchain: chain, symbol: "AAA", contractAddress: "0xa", coingeckoId: good },
        { assetId: `nep141:${tag}-b`, decimals: 6, blockchain: chain, symbol: "BBB", contractAddress: "0xb", coingeckoId: none },
        // The chain's own coin, whose "image" isn't one.
        { assetId: `nep141:${tag}-n`, decimals: 18, blockchain: chain, symbol: "ZZ", coingeckoId: fake },
        { assetId: `nep141:${tag}-c`, decimals: 6, blockchain: chain, symbol: "CCC", coingeckoId: "custom:not-listed" },
      ]);
    if (o.path.startsWith(`/api/v3/coins/${good}?`)) return reply(200, { image: { small: `https://coin-images.coingecko.com/coins/images/1/small/${good}.png` } });
    if (o.path.startsWith(`/api/v3/coins/${none}?`)) return reply(404, {});
    if (o.path.startsWith(`/api/v3/coins/${fake}?`)) return reply(200, { image: { small: `https://assets.coingecko.com/coins/images/2/small/${fake}.png` } });
    if (base === "https://coin-images.coingecko.com") return reply(200, "", png);
    if (base === "https://assets.coingecko.com") return reply(200, "", Buffer.from("<html>not an image</html>"));
    throw new Error(`unexpected ${base}${o.path}`);
  };
  try {
    const first = await warmLogos(20, http, 0);
    assert.equal(first.found, 1);
    assert.equal(first.remaining, 0);
    const stored = await logo(`coin:${good}`);
    assert.equal(stored?.mime, "image/png");
    assert.deepEqual(Buffer.from(stored!.bytes), png);
    // No image, or one that isn't an image: the checkout draws the mark.
    for (const k of [`coin:${none}`, `coin:${fake}`, `chain:${chain}`]) assert.equal(await logo(k), null, k);
    assert.equal((await db.tokenLogo.findUnique({ where: { key: `coin:${none}` } }))?.missing, true);
    // Each is asked for once, then remembered; ids CoinGecko doesn't have aren't asked for.
    assert.ok(!asked.some((u) => u.includes("custom")));
    const before = asked.length;
    assert.equal((await warmLogos(20, http, 0)).checked, 0);
    assert.equal(asked.length, before);
    // Rate limited: stops, and tries again next time.
    await db.tokenLogo.deleteMany({ where: { key: `coin:${none}` } });
    const limited: Http = async (base, o) => (base.includes("coingecko") ? { status: 429, headers: {}, body: "{}" } : http(base, o));
    assert.deepEqual(await warmLogos(20, limited, 0), { checked: 0, found: 0, remaining: 1 });
  } finally {
    await db.tokenLogo.deleteMany({ where: { key: { in: [`coin:${good}`, `coin:${none}`, `coin:${fake}`, `chain:${chain}`] } } });
    resetTokenCache();
  }
});

test("logos: a pasted token's logo is fetched the first time it's shown, through redirects, then kept", async () => {
  const address = `0x${randomBytes(20).toString("hex")}`;
  const key = tokenLogo("base", address)!.replace("/api/logos/", "").replace("/", ":");
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(60)]);
  const asked: string[] = [];
  const http: Http = async (base, o): Promise<{ status: number; headers: Record<string, string>; body: string; buffer?: Buffer }> => {
    asked.push(`${base}${o.path}`);
    if (base === "https://li.quest")
      return { status: 200, headers: {}, body: JSON.stringify({ address, symbol: "DEGEN", name: "Degen", decimals: 18, priceUSD: "0.01", logoURI: "https://arweave.net/abc" }) };
    // Arweave sends the browser to a per-file subdomain.
    if (base === "https://arweave.net") {
      assert.equal(o.redirects, "return");
      return { status: 302, headers: { location: "//file.arweave.net/abc" }, body: "" };
    }
    if (base === "https://file.arweave.net") return { status: 200, headers: {}, body: "", buffer: jpeg };
    throw new Error(`unexpected ${base}${o.path}`);
  };
  try {
    const found = await logo(key, http);
    assert.equal(found?.mime, "image/jpeg");
    assert.deepEqual(asked, [`https://li.quest/v1/token?chain=8453&token=${address}`, "https://arweave.net/abc", "https://file.arweave.net/abc"]);
    // Kept: never fetched again.
    assert.deepEqual(Buffer.from((await logo(key, http))!.bytes), jpeg);
    assert.equal(asked.length, 3);
    assert.ok((await db.tokenLogo.findUnique({ where: { key } }))?.bytes);
  } finally {
    await db.tokenLogo.deleteMany({ where: { key } });
  }

  // Only https, at most three redirects, and a missing logo is remembered.
  for (const [i, logoURI] of ["http://example.com/a.png", "https://loop.example/a.png", "data:image/png;base64,AAAA"].entries()) {
    const a = `0x${randomBytes(20).toString("hex")}`;
    const k = tokenLogo("base", a)!.replace("/api/logos/", "").replace("/", ":");
    let calls = 0;
    const h: Http = async (base) => {
      calls++;
      if (base === "https://li.quest") return { status: 200, headers: {} as Record<string, string>, body: JSON.stringify({ address: a, symbol: "X", name: "X", decimals: 18, priceUSD: "1", logoURI }) };
      if (base === "https://loop.example") return { status: 302, headers: { location: "https://loop.example/a.png" }, body: "" };
      throw new Error(`unexpected ${base}`);
    };
    try {
      assert.equal(await logo(k, h), null, logoURI);
      assert.equal(calls, i === 1 ? 5 : 1, logoURI);
      assert.equal(await logo(k, h), null);
      assert.equal(calls, i === 1 ? 5 : 1, "remembered as missing");
    } finally {
      await db.tokenLogo.deleteMany({ where: { key: k } });
    }
  }
});
