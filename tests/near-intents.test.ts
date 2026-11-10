// NEAR Intents settlement (docs/near-intents.md): account ids, ownership
// signatures, on-chain delivery matching, payout intent checks and the
// near-intents-deposit adapter, with fake 1Click and NEAR RPC answers shaped
// like the live ones (30 October 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import bs58 from "bs58";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { deliveries, intentsAccount, solanaOwner } from "../lib/intents/near";
import { ed25519Signature, secp256k1Signature } from "../lib/intents/signing";
import { erc191Signer, nep413Hash, verifyNep413, verifyRawEd25519 } from "../lib/intents/verify";
import { checkFundingIntent } from "../lib/intents/payouts";
import { quote, oneClickBase, type Http } from "../lib/intents/oneclick";
import { approximate, payTokens, walletTransfer } from "../lib/intents/checkout";
import { evmTransfer } from "../lib/blockchain/wallet-payment";
import { intentsDepositConfigSchema, intentsDepositExecutionAdapter, type IntentsSwap } from "../lib/providers/adapters/native/near-intents-deposit";
import { factAction } from "../lib/payments/contracts";
import { isDepositAdapter, stablecoinDepositConfig } from "../lib/blockchain/deposit-config";
import type { DepositBinding } from "../lib/blockchain/deposit-types";
import { directFeeInAsset } from "../lib/payments/pricing";
import { offrampConfigSchema, offrampExecutionAdapter } from "../lib/providers/adapters/native/near-intents-offramp";

const ok = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body) });
const baseUsdc = { network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" };
const baseUsdcAsset = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

test("intents account ids: NEAR accounts sign NEP-413, EVM addresses ERC-191", () => {
  assert.deepEqual(intentsAccount("shop.near"), { accountId: "shop.near", standard: "nep413" });
  assert.deepEqual(intentsAccount("a".repeat(64)), { accountId: "a".repeat(64), standard: "nep413" });
  assert.deepEqual(intentsAccount("0x2527D02599Ba641c19FEa793cD0F167589a0f10D"), {
    accountId: "0x2527d02599ba641c19fea793cd0f167589a0f10d",
    standard: "erc191",
  });
  for (const bad of ["near", "Shop.near", "shop..near", "0x123", "-shop.near", "a".repeat(65)]) assert.equal(intentsAccount(bad), null, bad);
});

test("NEP-413 signatures verify against the Borsh payload, base64 or base58", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const key = `ed25519:${bs58.encode(raw)}`;
  const payload = { message: "PayRouta: settle crypto payments", nonce: Buffer.alloc(32, 7).toString("base64"), recipient: "PayRouta" };
  const signature = sign(null, nep413Hash(payload), privateKey);
  assert.ok(verifyNep413(payload, key, ed25519Signature(signature.toString("base64"))));
  assert.ok(verifyNep413(payload, key, ed25519Signature(bs58.encode(signature))));
  assert.ok(!verifyNep413({ ...payload, recipient: "intents.near" }, key, ed25519Signature(signature.toString("base64"))));
  assert.ok(!verifyNep413({ ...payload, message: "other" }, key, `ed25519:${bs58.encode(signature)}`));
  // Base58 signatures can be 88 characters long, like base64 ones.
  for (let i = 0; i < 300; i++) {
    const s = sign(null, Buffer.from([i & 255, i >> 8]), privateKey);
    const expected = `ed25519:${bs58.encode(s)}`;
    assert.equal(ed25519Signature(s.toString("base64")), expected);
    assert.equal(ed25519Signature(bs58.encode(s)), expected);
  }
});

test("ERC-191 signatures recover the signing address, with v as 27/28 or 0/1", () => {
  const secret = secp256k1.utils.randomPrivateKey();
  const address = `0x${Buffer.from(keccak_256(secp256k1.getPublicKey(secret, false).slice(1)).slice(-20)).toString("hex")}`;
  const message = "PayRouta: settle crypto payments into 0xabc";
  const body = new TextEncoder().encode(message);
  const digest = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`), body]));
  const s = secp256k1.sign(digest, secret);
  const hex = (v: number) => `0x${s.toCompactHex()}${v.toString(16).padStart(2, "0")}`;
  assert.equal(erc191Signer(message, secp256k1Signature(hex(27 + s.recovery))), address);
  assert.equal(erc191Signer(message, secp256k1Signature(hex(s.recovery))), address);
  assert.notEqual(erc191Signer(`${message}!`, secp256k1Signature(hex(27 + s.recovery))), address);
  assert.throws(() => secp256k1Signature("0x1234"));
});

// One execute_intents receipt from a settlement transaction, shaped like the
// live ones: dip4 transfer events next to the NEP-245 mt_transfer.
function settlementTx(transfers: { hash: string; from: string; to: string; amount: string }[], status: object = { SuccessValue: "" }) {
  const log = (e: object) => `EVENT_JSON:${JSON.stringify(e)}`;
  return {
    final_execution_status: "FINAL",
    status: { SuccessValue: "" },
    receipts_outcome: [
      {
        id: "Receipt1111111111111111111111111111111111111",
        block_hash: "Block11111111111111111111111111111111111111",
        outcome: {
          executor_id: "intents.near",
          status,
          logs: [
            ...transfers.map((t) =>
              log({
                standard: "dip4",
                version: "0.4.3",
                event: "transfer",
                data: [{ intent_hash: t.hash, account_id: t.from, receiver_id: t.to, tokens: { [baseUsdcAsset]: t.amount } }],
              }),
            ),
            ...transfers.map((t) =>
              log({
                standard: "nep245",
                version: "1.0.0",
                event: "mt_transfer",
                data: [{ old_owner_id: t.from, new_owner_id: t.to, token_ids: [baseUsdcAsset], amounts: [t.amount] }],
              }),
            ),
          ],
        },
      },
    ],
  };
}

test("deliveries count only the swap's own transfers in a batched settlement", () => {
  const tx = settlementTx([
    { hash: "SwapIntent", from: "q".repeat(64), to: "shop.near", amount: "25000000" },
    { hash: "SomeoneElse", from: "z".repeat(64), to: "shop.near", amount: "99000000" },
    { hash: "SwapIntent2", from: "q".repeat(64), to: "other.near", amount: "25000000" },
  ]);
  const found = deliveries(tx, "TxHash", { account: "shop.near", assetId: baseUsdcAsset, intentHashes: ["SwapIntent", "SwapIntent2"] });
  assert.equal(found.length, 1);
  assert.equal(found[0].amount, 25000000n);
  assert.equal(found[0].intentHash, "SwapIntent");
  // A transfer event without the matching token movement does not count.
  const forged = settlementTx([{ hash: "SwapIntent", from: "q".repeat(64), to: "shop.near", amount: "25000000" }]);
  forged.receipts_outcome[0].outcome.logs.pop();
  assert.equal(deliveries(forged, "T", { account: "shop.near", assetId: baseUsdcAsset, intentHashes: ["SwapIntent"] }).length, 0);
  // Nor does a failed receipt.
  const failed = settlementTx([{ hash: "SwapIntent", from: "q".repeat(64), to: "shop.near", amount: "25000000" }], { Failure: {} });
  assert.equal(deliveries(failed, "T", { account: "shop.near", assetId: baseUsdcAsset, intentHashes: ["SwapIntent"] }).length, 0);
});

// generate-intent answers captured from the live API (30 October 2026).
const deposit = "7c80f98d5bdeddd12e59edb3470ec17ff7ddef5f836d42539fc1773b27ace60a";
const evmSigner = "0x2527d02599ba641c19fea793cd0f167589a0f10d";
const erc191Intent = {
  standard: "erc191" as const,
  payload: JSON.stringify({
    verifying_contract: "intents.near",
    signer_id: evmSigner,
    deadline: "2026-11-02T16:20:36.000Z",
    nonce: "Vij2xgAlKBKzAEj639VG5BgBIMMa7hPeFLFZ+7lO0ok=",
    intents: [{ intent: "transfer", receiver_id: deposit, tokens: { [baseUsdcAsset]: "25000000" } }],
  }),
};
const nep413Intent = {
  standard: "nep413" as const,
  payload: {
    message: JSON.stringify({
      deadline: "2026-11-02T16:20:36.000Z",
      intents: [{ intent: "transfer", receiver_id: deposit, tokens: { [baseUsdcAsset]: "25000000" } }],
      signer_id: evmSigner,
    }),
    nonce: "Vij2xgAlKBKzAEj639VG5BiM75NZCnvI4uhmRk7xCxU=",
    recipient: "intents.near",
  },
};

test("a payout's funding intent must be exactly the quoted transfer to the quote's deposit account", () => {
  const expect = { signer: evmSigner, receiver: deposit, token: baseUsdcAsset, amount: "25000000" };
  checkFundingIntent(erc191Intent, expect);
  checkFundingIntent(nep413Intent, expect);
  assert.throws(() => checkFundingIntent(erc191Intent, { ...expect, amount: "25000001" }), /INTENTS_INTENT_UNEXPECTED/);
  assert.throws(() => checkFundingIntent(erc191Intent, { ...expect, receiver: "attacker.near" }), /INTENTS_INTENT_UNEXPECTED/);
  assert.throws(() => checkFundingIntent(erc191Intent, { ...expect, signer: "shop.near" }), /INTENTS_INTENT_UNEXPECTED/);
  const extra = JSON.parse(erc191Intent.payload);
  extra.intents.push({ intent: "transfer", receiver_id: "attacker.near", tokens: { [baseUsdcAsset]: "1" } });
  assert.throws(() => checkFundingIntent({ standard: "erc191", payload: JSON.stringify(extra) }, expect), /INTENTS_INTENT_UNEXPECTED/);
  assert.throws(
    () => checkFundingIntent({ ...nep413Intent, payload: { ...nep413Intent.payload, recipient: "evil.near" } }, expect),
    /INTENTS_INTENT_UNEXPECTED/,
  );
});

test("1Click quotes into and out of an intents account", async () => {
  const bodies: Record<string, unknown>[] = [];
  const http: Http = async (_b, o) => {
    bodies.push(JSON.parse(o.body!));
    return ok({ quote: { depositAddress: deposit, amountIn: "25000000", amountInFormatted: "25", amountOut: "24987437" } });
  };
  const common = { originAsset: baseUsdcAsset, destinationAsset: baseUsdcAsset, amountOut: "25000000", deadline: new Date() };
  await quote({ ...common, recipient: "shop.near", refundTo: "0x" + "a".repeat(40), to: "INTENTS" }, http);
  await quote({ ...common, recipient: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", refundTo: "shop.near", from: "INTENTS", exactInput: true }, http);
  assert.deepEqual(
    bodies.map((b) => [b.depositType, b.refundType, b.recipientType, b.swapType]),
    [
      ["ORIGIN_CHAIN", "ORIGIN_CHAIN", "INTENTS", "EXACT_OUTPUT"],
      ["INTENTS", "INTENTS", "DESTINATION_CHAIN", "EXACT_INPUT"],
    ],
  );
});

test("intents settlement is a deposit integration, mainnet only, for 1Click stablecoins", () => {
  const config = {
    mode: "NATIVE",
    adapter: "near-intents-deposit",
    environment: "production",
    ...baseUsdc,
    account: "shop.near",
    intentsAccountId: "acct_1",
  };
  assert.ok(isDepositAdapter("near-intents-deposit"));
  assert.ok(stablecoinDepositConfig.safeParse(config).success);
  assert.ok(!intentsDepositConfigSchema.safeParse({ ...config, environment: "sandbox" }).success);
  assert.ok(!intentsDepositConfigSchema.safeParse({ ...config, account: "Shop.near" }).success);
  assert.ok(!intentsDepositConfigSchema.safeParse({ ...config, network: "eip155:84532", identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" }).success);
  const action = { kind: "intents", provider: "NEAR Intents", text: "Pay", address: "shop.near", ...baseUsdc, amount: "25", symbol: "USDC" };
  assert.ok(factAction.safeParse(action).success);
  assert.ok(!factAction.safeParse({ ...action, symbol: "USDT" }).success);
  assert.ok(!factAction.safeParse({ ...action, address: "not an account" }).success);
});

test("the adapter confirms only after the swap's delivery is final on NEAR, and claims it once", async () => {
  let binding: DepositBinding | null = null;
  const claims: { txHash: string; logIndex: string; amount: string }[] = [];
  const swaps: IntentsSwap[] = [];
  let swapStatus = "PENDING_DEPOSIT";
  const tx = settlementTx([{ hash: "SwapIntent", from: "q".repeat(64), to: "shop.near", amount: "25000000" }]);
  const http = async (base: string, o: { path: string; body?: string }) => {
    if (base === oneClickBase)
      return ok({ status: swapStatus, swapDetails: { intentHashes: ["SwapIntent"], nearTxHashes: ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"] } });
    const rpc = JSON.parse(o.body!);
    if (rpc.method === "block") return ok({ result: { header: { height: 222292657 } } });
    if (rpc.method === "tx") return ok({ result: tx });
    throw new Error(`unexpected ${rpc.method}`);
  };
  const adapter = intentsDepositExecutionAdapter(
    { mode: "NATIVE", adapter: "near-intents-deposit", environment: "production", ...baseUsdc, account: "shop.near", intentsAccountId: "acct_1" },
    {
      http,
      credentials: { get: async () => "" },
      now: () => new Date("2026-10-30T12:00:00Z"),
      deposits: {
        allocate: async (input) => (binding = { ...input, address: input.addresses[0], integrationId: "int_1" }),
        find: async () => binding,
        claim: async (_b, evidence) => void claims.push(evidence),
      },
      swaps: {
        forAttempt: async () => swaps,
        record: async (id, status) => {
          swaps.find((s) => s.id === id)!.status = status;
        },
      },
    },
  );
  const attempt = { id: "att_1", key: "key_1", environment: "production" };
  const created = await adapter.create(attempt, {
    reference: "ORDER-1",
    amount: "25",
    asset: { kind: "blockchain", ...baseUsdc },
    selectedMethod: "stablecoin",
    precision: 6,
  });
  assert.equal(created.state, "Requires action");
  assert.equal((created.action as { kind: string; address: string }).kind, "intents");
  assert.equal((created.action as { address: string }).address, "shop.near");
  assert.match(binding!.address, /^shop\.near\//);
  assert.equal(binding!.startBlock, 222292657n);
  // No swap yet: the customer still has to pay.
  assert.equal((await adapter.status(attempt))!.state, "Requires action");
  swaps.push({ id: "s1", depositAddress: "dep1", depositMemo: null, destinationAsset: baseUsdcAsset, amountOut: "25000000", status: "PENDING_DEPOSIT", details: null, checkedAt: null });
  swapStatus = "PROCESSING";
  assert.equal((await adapter.status(attempt))!.state, "Pending");
  swaps[0].checkedAt = null;
  swapStatus = "SUCCESS";
  const confirmed = await adapter.status(attempt);
  assert.equal(confirmed!.state, "Confirmed");
  assert.equal(confirmed!.amount, "25");
  assert.deepEqual(claims[0], {
    txHash: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
    logIndex: "Receipt1111111111111111111111111111111111111:SwapIntent",
    blockHash: "Block11111111111111111111111111111111111111",
    amount: "25",
  });
  // A swap for a different amount never confirms this checkout.
  swaps[0].amountOut = "24000000";
  assert.equal((await adapter.status(attempt))!.state, "Requires action");
});

test("with PayRouta's fee withheld at source, the account receives the invoice less the fee and the payment confirms in full", async () => {
  let binding: DepositBinding | null = null;
  const claims: { amount: string }[] = [];
  const tx = settlementTx([{ hash: "SwapIntent", from: "q".repeat(64), to: "shop.near", amount: "24625000" }]);
  const http = async (base: string, o: { path: string; body?: string }) => {
    if (base === oneClickBase)
      return ok({ status: "SUCCESS", swapDetails: { intentHashes: ["SwapIntent"], nearTxHashes: ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"] } });
    const rpc = JSON.parse(o.body!);
    if (rpc.method === "block") return ok({ result: { header: { height: 222292657 } } });
    if (rpc.method === "tx") return ok({ result: tx });
    throw new Error(`unexpected ${rpc.method}`);
  };
  const swaps: IntentsSwap[] = [
    { id: "s1", depositAddress: "dep1", depositMemo: null, destinationAsset: baseUsdcAsset, amountOut: "24625000", appFeeMinor: "375000", status: "PENDING_DEPOSIT", details: null, checkedAt: null },
  ];
  const adapter = intentsDepositExecutionAdapter(
    { mode: "NATIVE", adapter: "near-intents-deposit", environment: "production", ...baseUsdc, account: "shop.near", intentsAccountId: "acct_1" },
    {
      http,
      credentials: { get: async () => "" },
      now: () => new Date("2026-10-30T12:00:00Z"),
      deposits: {
        allocate: async (input) => (binding = { ...input, address: input.addresses[0], integrationId: "int_1" }),
        find: async () => binding,
        claim: async (_b, evidence) => void claims.push(evidence),
      },
      swaps: { forAttempt: async () => swaps, record: async () => {} },
    },
  );
  const attempt = { id: "att_1", key: "key_1", environment: "production" };
  await adapter.create(attempt, { reference: "ORDER-1", amount: "25", asset: { kind: "blockchain", ...baseUsdc }, selectedMethod: "stablecoin", precision: 6 });
  const confirmed = await adapter.status(attempt);
  assert.equal(confirmed!.state, "Confirmed");
  assert.equal(confirmed!.amount, "25");
  assert.equal(claims[0].amount, "25");
  // A swap that claims a fee but delivers the full invoice is not this payment.
  swaps[0].appFeeMinor = "0";
  assert.equal((await adapter.status(attempt))!.state, "Requires action");
});

test("PayRouta's fee in the payment's own token: 1.5%, capped, nothing when free", () => {
  const schedule = {
    version: "2026-10-v2",
    asset: `blockchain:${baseUsdc.identifier}:${baseUsdc.network}`,
    inputPrecision: 6,
    currency: "USD",
    billingPrecision: 2,
    conversionNumerator: "1",
    conversionDenominator: "10000",
    validUntil: "2099-01-01T00:00:00.000Z",
    valuationReference: "usdc-par",
  };
  const snap = (s: object) => ({ version: "2026-10-v2", free: false, schedule: { ...schedule, ...s } });
  assert.equal(directFeeInAsset(snap({}), "stablecoin", "25", 6), 375000n);
  // A $5 cap (500 cents) is 5 USDC.
  assert.equal(directFeeInAsset(snap({ directCapMinor: "500" }), "stablecoin", "1000", 6), 5000000n);
  assert.equal(directFeeInAsset({ version: "2026-10-v2", free: true, schedule: null }, "stablecoin", "25", 6), 0n);
});

test("a Solana wallet owns the implicit account named by its key, and signs the payload text itself", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const address = bs58.encode(raw);
  const owner = solanaOwner(address)!;
  assert.equal(owner.accountId, Buffer.from(raw).toString("hex"));
  assert.equal(owner.standard, "raw_ed25519");
  assert.equal(owner.publicKey, `ed25519:${address}`);
  // Its account id is a valid intents account (an implicit one).
  assert.equal(intentsAccount(owner.accountId)?.accountId, owner.accountId);
  const payload = JSON.stringify({ signer_id: owner.accountId, verifying_contract: "intents.near", intents: [] });
  const signature = ed25519Signature(bs58.encode(sign(null, Buffer.from(payload), privateKey)));
  assert.ok(verifyRawEd25519(payload, owner.publicKey, signature));
  assert.ok(!verifyRawEd25519(`${payload} `, owner.publicKey, signature));
  assert.equal(solanaOwner("0x" + "a".repeat(40)), null);
  assert.equal(solanaOwner("shop.near"), null);
});

test("settled straight to the bank: confirmed only by the swap's own finalized USDC transfer to the funding address", async () => {
  const saved = { key: process.env.ALCHEMY_RPC_KEY_REF, mode: process.env.PAYMENT_RPC_MODE };
  delete process.env.ALCHEMY_RPC_KEY_REF;
  process.env.PAYMENT_RPC_MODE = "public";
  try {
    const funding = `0x${"b".repeat(40)}`;
    const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const delivery = `0x${"d".repeat(64)}`;
    let finalized = 100n,
      amount = 24625000n;
    const http = async (base: string, o: { path: string; body?: string }) => {
      if (base === oneClickBase) return ok({ status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: delivery }] } });
      const rpc = JSON.parse(o.body!);
      const result =
        rpc.method === "eth_chainId"
          ? "0x2105"
          : rpc.method === "eth_getBlockByNumber"
            ? { number: `0x${finalized.toString(16)}` }
            : rpc.method === "eth_getTransactionReceipt"
              ? {
                  status: "0x1",
                  transactionHash: delivery,
                  blockHash: `0x${"e".repeat(64)}`,
                  blockNumber: "0x64",
                  logs: [
                    {
                      address: usdc,
                      topics: [
                        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                        `0x${"0".repeat(24)}${"c".repeat(40)}`,
                        `0x${"0".repeat(24)}${funding.slice(2)}`,
                      ],
                      data: `0x${amount.toString(16).padStart(64, "0")}`,
                      logIndex: "0x3",
                    },
                  ],
                }
              : null;
      return ok({ jsonrpc: "2.0", id: rpc.id, result });
    };
    const config = { mode: "NATIVE", adapter: "near-intents-offramp", environment: "production", network: "eip155:8453", identifier: `erc20:${usdc}`, partner: "bridge", fiatAccountId: "fpa_1", address: funding };
    assert.ok(offrampConfigSchema.safeParse(config).success);
    assert.ok(!offrampConfigSchema.safeParse({ ...config, environment: "sandbox" }).success);
    let binding: DepositBinding | null = null;
    const claims: { txHash: string; logIndex: string; amount: string }[] = [];
    const swaps: IntentsSwap[] = [
      { id: "s1", depositAddress: "dep1", depositMemo: null, destinationAsset: "nep141:base-usdc", amountOut: "24625000", appFeeMinor: "375000", status: "PENDING_DEPOSIT", details: null, checkedAt: null },
    ];
    const asked: (string | undefined)[] = [];
    const adapter = offrampExecutionAdapter(config, {
      http,
      credentials: { get: async () => "" },
      now: () => new Date("2026-11-10T12:00:00Z"),
      deposits: {
        allocate: async (input) => (binding = { ...input, address: input.addresses[0], integrationId: "int_1" }),
        find: async () => binding,
        claim: async (_b, evidence) => void claims.push(evidence),
      },
      swaps: { forAttempt: async (_id, type) => (asked.push(type), swaps), record: async () => {} },
    });
    const attempt = { id: "att_1", key: "key_1", environment: "production" };
    const created = await adapter.create(attempt, { reference: "ORDER-1", amount: "25", asset: { kind: "blockchain", network: "eip155:8453", identifier: `erc20:${usdc}` }, selectedMethod: "stablecoin", precision: 6 });
    assert.deepEqual(
      { kind: (created.action as { kind: string }).kind, settle: (created.action as { settle: string }).settle, address: (created.action as { address: string }).address },
      { kind: "intents", settle: "bank", address: funding },
    );
    assert.ok(factAction.safeParse(created.action).success);
    // Not final yet: still pending.
    finalized = 99n;
    assert.equal((await adapter.status(attempt))!.state, "Pending");
    assert.equal(asked[0], "BANK");
    finalized = 100n;
    const confirmed = await adapter.status(attempt);
    assert.equal(confirmed!.state, "Confirmed");
    assert.equal(confirmed!.amount, "25");
    assert.deepEqual(claims[0], { txHash: delivery, logIndex: "0x3", blockHash: `0x${"e".repeat(64)}`, amount: "25" });
    // A delivery of the wrong amount is never this payment.
    amount = 25000000n;
    await assert.rejects(adapter.status(attempt), /DEPOSIT_AMOUNT_MISMATCH/);
  } finally {
    if (saved.key === undefined) delete process.env.ALCHEMY_RPC_KEY_REF;
    else process.env.ALCHEMY_RPC_KEY_REF = saved.key;
    if (saved.mode === undefined) delete process.env.PAYMENT_RPC_MODE;
    else process.env.PAYMENT_RPC_MODE = saved.mode;
  }
});

// The checkout's one crypto question: what do you pay with?
const listed = [
  { assetId: baseUsdcAsset, blockchain: "base", symbol: "USDC" },
  { assetId: "nep141:base.omft.near", blockchain: "base", symbol: "ETH" },
  { assetId: "nep141:eth.omft.near", blockchain: "eth", symbol: "ETH" },
  { assetId: "nep141:sol-c800a4bd850783ccb82c2b2c7e84175443606352.omft.near", blockchain: "sol", symbol: "USDT" },
  { assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", blockchain: "tron", symbol: "USDT" },
];
const usdtSol = { network: "solana:mainnet", identifier: "spl:Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" };
const option = (id: string, a: { network: string; identifier: string }, symbol: string, intents: boolean, method = "stablecoin") => ({
  id,
  ...a,
  symbol,
  amount: "40.000000",
  method,
  intents,
});
const routeOf = (r: ReturnType<typeof payTokens>, chain: string, symbol: string) =>
  r.chains.find((c) => c.id === chain)?.tokens.find((t) => t.symbol === symbol);

test("pay options: the customer picks what they hold; intents settlement turns every token into a swap", () => {
  const r = payTokens([option("o1", baseUsdc, "USDC", true), option("o2", usdtSol, "USDT", false)], true, listed);
  assert.deepEqual(r.settle, { symbol: "USDC", amount: "40.000000" });
  // USDT on Solana goes straight to the merchant's address, listed once.
  assert.equal(routeOf(r, "sol", "USDT")!.route, "direct");
  assert.equal(r.chains.find((c) => c.id === "sol")!.tokens.length, 1);
  // USDC on Base settles into the intents account, so it pays as a swap too.
  assert.deepEqual(
    { route: routeOf(r, "base", "USDC")!.route, optionId: routeOf(r, "base", "USDC")!.optionId, assetId: routeOf(r, "base", "USDC")!.assetId },
    { route: "swap", optionId: "o1", assetId: baseUsdcAsset },
  );
  assert.equal(routeOf(r, "tron", "USDT")!.route, "swap");
  assert.deepEqual(
    r.chains.map((c) => c.name),
    [...r.chains.map((c) => c.name)].sort((a, b) => a.localeCompare(b)),
  );
});

test("pay options: receive addresses only, a token the merchant takes directly is never offered as a swap", () => {
  const r = payTokens([option("o1", baseUsdc, "USDC", false)], true, listed);
  assert.equal(routeOf(r, "base", "USDC")!.route, "direct");
  assert.equal(r.chains.find((c) => c.id === "base")!.tokens.filter((t) => t.symbol === "USDC").length, 1);
  assert.equal(routeOf(r, "base", "ETH")!.optionId, "o1", "swaps settle into the USDC option");
  // ETH taken directly on Ethereum stays direct; ETH elsewhere swaps.
  const withEth = payTokens(
    [option("o1", baseUsdc, "USDC", false), option("o3", { network: "eip155:1", identifier: "native:ETH" }, "ETH", false, "crypto-app")],
    true,
    listed,
  );
  assert.equal(routeOf(withEth, "eth", "ETH")!.route, "direct");
  assert.equal(routeOf(withEth, "base", "ETH")!.route, "swap");
});

test("pay options: without swaps (sandbox, or switched off) only direct tokens are offered", () => {
  const r = payTokens([option("o1", { network: "eip155:84532", identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" }, "USDC", false)], false, listed);
  assert.equal(r.settle, null);
  assert.deepEqual(
    r.chains.flatMap((c) => c.tokens.map((t) => t.route)),
    ["direct"],
  );
});

test("pay options: swap tokens show today's price, and which wallet pays them", () => {
  const priced = [
    { ...listed[2], price: 2290.83 },
    { ...listed[4], price: 1, contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
    { assetId: "nep141:sol.omft.near", blockchain: "sol", symbol: "SOL", price: 94.47 },
    { assetId: "nep141:wrap.near", blockchain: "near", symbol: "wNEAR", price: 4.13, contractAddress: "wrap.near" },
    { assetId: "nep141:btc.omft.near", blockchain: "btc", symbol: "BTC", price: 70000 },
  ];
  const r = payTokens([option("o1", baseUsdc, "USDC", true)], true, priced);
  assert.equal(routeOf(r, "eth", "ETH")!.approx, "0.0174609");
  assert.equal(routeOf(r, "tron", "USDT")!.approx, "40");
  assert.equal(routeOf(r, "tron", "USDT")!.contract, "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t");
  assert.deepEqual(routeOf(r, "eth", "ETH")!.wallet, { family: "evm", chainId: 1 });
  assert.deepEqual(routeOf(r, "sol", "SOL")!.wallet, { family: "solana" });
  assert.deepEqual(routeOf(r, "near", "wNEAR")!.wallet, { family: "near" });
  // Tron and Bitcoin are paid by sending to an address.
  assert.equal(routeOf(r, "tron", "USDT")!.wallet, undefined);
  assert.equal(routeOf(r, "btc", "BTC")!.wallet, undefined);
  // A direct token is paid from the wallet of its own network.
  const direct = payTokens([option("o2", usdtSol, "USDT", false)], false, []);
  assert.deepEqual(routeOf(direct, "sol", "USDT")!.wallet, { family: "solana" });
  assert.equal(routeOf(direct, "sol", "USDT")!.contract, "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
});

test("swap wallet transfers: the quoted amount to the deposit address, on chains a wallet can pay", () => {
  const quote = { depositAddress: `0x${"d".repeat(40)}`, depositMemo: null, amountIn: "40180000" };
  assert.deepEqual(
    walletTransfer(quote, { assetId: "x", blockchain: "arb", decimals: 6, contractAddress: `0x${"a".repeat(40)}` }),
    { amount: "40180000", decimals: 6, to: quote.depositAddress, token: `0x${"a".repeat(40)}`, family: "evm", chainId: 42161, chainName: "Arbitrum" },
  );
  // A chain's own coin has no contract.
  assert.equal(walletTransfer(quote, { assetId: "x", blockchain: "base", decimals: 18 })!.token, null);
  assert.equal(walletTransfer({ ...quote, depositAddress: "abc123" }, { assetId: "x", blockchain: "near", decimals: 24, contractAddress: "wrap.near" })!.family, "near");
  assert.equal(walletTransfer(quote, { assetId: "x", blockchain: "tron", decimals: 6, contractAddress: "T" }), undefined);
  // An EVM "contract" that isn't an address is never sent to.
  assert.equal(walletTransfer(quote, { assetId: "x", blockchain: "eth", decimals: 6, contractAddress: "not-a-contract" }), undefined);
  assert.equal(approximate(0, 5), undefined);
  assert.equal(approximate(40, 0.000001234), "32414900");
});

test("EVM wallet transfers: ERC-20 transfer calldata, or value for the chain's own coin", () => {
  const to = `0x${"d".repeat(40)}`;
  const token = evmTransfer({ chainId: 42161, token: `0x${"a".repeat(40)}`, amount: "40180000", to });
  assert.deepEqual(token, {
    chainId: "0xa4b1",
    to: `0x${"a".repeat(40)}`,
    value: "0x0",
    data: `0xa9059cbb${"d".repeat(40).padStart(64, "0")}${(40180000).toString(16).padStart(64, "0")}`,
  });
  assert.deepEqual(evmTransfer({ chainId: 8453, token: null, amount: "1000", to }), { chainId: "0x2105", to, value: "0x3e8", data: "0x" });
  assert.throws(() => evmTransfer({ chainId: 1, token: null, amount: "0", to }));
  assert.throws(() => evmTransfer({ chainId: 1, token: "0x12", amount: "5", to }));
});

test("pay options: swaps settle into the merchant's chosen receive stablecoin when the checkout offers it", () => {
  const options = [option("o1", baseUsdc, "USDC", false), option("o2", usdtSol, "USDT", false)];
  assert.equal(routeOf(payTokens(options, true, listed), "tron", "USDT")!.optionId, "o1", "first deliverable by default");
  assert.equal(routeOf(payTokens(options, true, listed, usdtSol), "tron", "USDT")!.optionId, "o2");
  assert.deepEqual(payTokens(options, true, listed, usdtSol).settle, { symbol: "USDT", amount: "40.000000" });
  // A choice this checkout doesn't offer falls back to the first.
  assert.equal(routeOf(payTokens([options[0]], true, listed, usdtSol), "tron", "USDT")!.optionId, "o1");
  // A merchant settling into a NEAR Intents account always settles there.
  assert.equal(routeOf(payTokens([option("o3", baseUsdc, "USDC", true), options[1]], true, listed, usdtSol), "tron", "USDT")!.optionId, "o3");
});
