import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cryptoAssets,
  cryptoAsset,
  quoteAsset,
  validPaymentAmount,
} from "../lib/blockchain/crypto-assets";
import {
  cryptoPaymentTerms,
  parseCoinGeckoPrice,
  coinGeckoPrices,
} from "../lib/payments/crypto-prices";
import { calculateFee } from "../lib/payments/pricing";
import { tokenMinor } from "../lib/blockchain/assets";
import { chain } from "../lib/blockchain/chains";
import {
  depositPayment,
  submitDeposit,
} from "../lib/blockchain/wallet-payment";
import { nativeDepositExecutionAdapter } from "../lib/providers/adapters/native/evm-native-deposit";
import type {
  DepositBinding,
  DepositStore,
} from "../lib/blockchain/deposit-types";
import type { NativeDeps } from "../lib/providers/adapters/native/common";
const now = new Date("2026-10-07T20:00:00Z");
const receiver = `0x${"a".repeat(40)}`,
  sender = `0x${"b".repeat(40)}`,
  txHash = `0x${"c".repeat(64)}`,
  blockHash = `0x${"d".repeat(64)}`;
test("stablecoin wallet quotes use exact registered assets, independent market valuations and stablecoin fees", async () => {
  const usdc = quoteAsset(
    "eip155:84532",
    "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  )!;
  const eurc = quoteAsset(
    "eip155:84532",
    "erc20:0x808456652fdb597867f38412077a9182bf77359f",
  )!;
  assert.equal(usdc.coinGeckoId, "usd-coin");
  assert.equal(eurc.coinGeckoId, "euro-coin");
  const prices = await coinGeckoPrices([usdc, eurc], now, async (_base, q) => {
    assert.match(q.path, /ids=usd-coin,euro-coin/);
    return {
      status: 200,
      bytes: 0,
      headers: {},
      body: JSON.stringify({
        "usd-coin": { usd: 0.8, last_updated_at: now.getTime() / 1000 },
        "euro-coin": { usd: 1.25, last_updated_at: now.getTime() / 1000 },
      }),
    };
  });
  const expiry = new Date(now.getTime() + 120000);
  const usd = cryptoPaymentTerms(
    usdc,
    "10.00",
    prices[usdc.coinGeckoId],
    "production",
    expiry,
  );
  const eur = cryptoPaymentTerms(
    eurc,
    "10.00",
    prices[eurc.coinGeckoId],
    "production",
    expiry,
  );
  assert.equal(usd.amount, "12.500000");
  assert.equal(eur.amount, "8.000000");
  assert.equal(
    calculateFee(usd.feeSnapshot, "stablecoin", usd.amount, 6).amountMinor,
    "1",
  );
  assert.equal(
    calculateFee(eur.feeSnapshot, "stablecoin", eur.amount, 6).amountMinor,
    "1",
  );
  assert.equal(
    quoteAsset(
      "eip155:42161",
      "erc20:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    ),
    undefined,
  );
});
test("CoinGecko exact numeric source, tiny scientific PEPE quotes and upward atomic rounding", () => {
  const price = parseCoinGeckoPrice(
    `{"pepe":{"usd":4.065271990912203e-06,"last_updated_at":${now.getTime() / 1000}}}`,
    "pepe",
    now,
  );
  assert.equal(price.usd, "4.065271990912203e-06");
  const a = cryptoAssets.find((a) => a.symbol === "PEPE")!;
  const terms = cryptoPaymentTerms(
    a,
    "10.00",
    price,
    "production",
    new Date(now.getTime() + 120000),
  );
  const units = tokenMinor(terms.amount, 18),
    p = 4065271990912203n;
  assert.ok(units * p >= (1000n * 10n ** 39n) / 100n);
  assert.equal(
    calculateFee(terms.feeSnapshot, "crypto-app", terms.amount, 18).amountMinor,
    "1",
  );
  const capped = cryptoPaymentTerms(
    a,
    "10000.00",
    price,
    "production",
    new Date(now.getTime() + 120000),
  );
  assert.equal(
    calculateFee(capped.feeSnapshot, "crypto-app", capped.amount, 18)
      .amountMinor,
    "100",
  );
});
test("quotes reject missing, stale, future, zero and malformed market data", () => {
  for (const body of [
    "{}",
    `{"ethereum":{"usd":0,"last_updated_at":${now.getTime() / 1000}}}`,
    `{"ethereum":{"usd":1,"last_updated_at":${now.getTime() / 1000 - 301}}}`,
    `{"ethereum":{"usd":1,"last_updated_at":${now.getTime() / 1000 + 31}}}`,
    `{"ethereum":{"usd":"Infinity","last_updated_at":${now.getTime() / 1000}}}`,
  ])
    assert.throws(() => parseCoinGeckoPrice(body, "ethereum", now));
});
test("very small native token prices retain full source precision and bill with an exact rational valuation", () => {
  const a = cryptoAssets.find((a) => a.symbol === "AIDOGE")!;
  const price = parseCoinGeckoPrice(
    `{"${a.coinGeckoId}":{"usd":3.428771905112432e-12,"last_updated_at":${now.getTime() / 1000}}}`,
    a.coinGeckoId,
    now,
  );
  assert.equal(price.usd, "3.428771905112432e-12");
  const terms = cryptoPaymentTerms(
    a,
    "10.00",
    price,
    "production",
    new Date(now.getTime() + 120000),
  );
  assert.ok(validPaymentAmount(a.network, a.identifier, terms.amount));
  assert.equal(
    calculateFee(terms.feeSnapshot, "crypto-app", terms.amount, a.decimals)
      .amountMinor,
    "1",
  );
  const eth = cryptoAsset("eip155:1", "native:ETH")!;
  const tiny = cryptoPaymentTerms(
    eth,
    "10.00",
    { ...price, usd: "1.234567890123456e-20" },
    "production",
    new Date(now.getTime() + 120000),
  );
  assert.ok(tiny.feeSnapshot.schedule!.conversionDenominator.length > 40);
  assert.equal(
    calculateFee(tiny.feeSnapshot, "crypto-app", tiny.amount, 18).amountMinor,
    "1",
  );
});
test("price transport uses reviewed CoinGecko IDs and fails on rate limits without invented rates", async () => {
  const a = cryptoAssets.find((a) => a.symbol === "PEPE")!;
  let path = "";
  const prices = await coinGeckoPrices([a], now, async (base, options) => {
    assert.equal(base, "https://api.coingecko.com");
    path = options.path;
    assert.match(options.headers!["User-Agent"], /PayRouta/);
    const body = `{"${a.coinGeckoId}":{"usd":0.000004,"last_updated_at":${now.getTime() / 1000}}}`;
    return { status: 200, headers: {}, body, bytes: body.length };
  });
  assert.match(path, /simple\/price\?ids=pepe&/);
  assert.equal(prices.pepe.usd, "0.000004");
  await assert.rejects(
    coinGeckoPrices([a], now, async () => ({
      status: 429,
      headers: {},
      body: "{}",
      bytes: 2,
    })),
    /RATE_LIMITED/,
  );
});
for (const asset of cryptoAssets.filter(
  (a) => chain(a.network)?.family === "evm",
))
  test(`wallet builds exact ${asset.symbol} instructions on ${asset.network}`, async () => {
    const payment = {
        ...asset,
        address: receiver,
        amount: `0.${"1".repeat(asset.decimals)}`,
      },
      request = depositPayment(payment);
    const calls: { method: string; params?: unknown[] }[] = [];
    const wallet = {
      request: async (q: (typeof calls)[number]) => {
        calls.push(q);
        return q.method === "eth_chainId"
          ? request.chainId
          : q.method === "eth_requestAccounts"
            ? [sender]
            : txHash;
      },
    };
    assert.equal(await submitDeposit(wallet, payment), txHash);
    const tx = calls.find((c) => c.method === "eth_sendTransaction")!
      .params![0] as { to: string; value: string; data: string };
    if (asset.identifier.startsWith("native:")) {
      assert.equal(tx.to, receiver);
      assert.equal(
        BigInt(tx.value),
        tokenMinor(payment.amount, asset.decimals),
      );
      assert.equal(tx.data, "0x");
    } else {
      assert.equal(tx.to, asset.contractAddress);
      assert.equal(tx.value, "0x0");
      assert.match(tx.data, /^0xa9059cbb/);
    }
    assert.equal(
      validPaymentAmount(
        asset.network,
        asset.identifier,
        `0.${"0".repeat(asset.decimals - 1)}1`,
      ),
      true,
    );
    assert.equal(
      validPaymentAmount(
        asset.network,
        asset.identifier,
        `0.${"0".repeat(asset.decimals)}1`,
      ),
      false,
    );
  });
function harness(change?: {
  failed?: boolean;
  late?: boolean;
  wrongAmount?: boolean;
  reorg?: boolean;
  unfinalized?: boolean;
  self?: boolean;
  wrongChain?: boolean;
}) {
  const asset = cryptoAsset("eip155:84532", "native:ETH")!;
  let binding: DepositBinding | null = null,
    claim: unknown = null,
    cursor = 101n,
    head = 100n,
    reads = 0;
  const tx = {
    hash: txHash,
    blockHash,
    blockNumber: "0x65",
    to: receiver,
    from: change?.self ? receiver : sender,
    input: "0x",
    value: change?.wrongAmount ? "0x2" : "0x1",
  };
  const block = {
    hash: blockHash,
    number: "0x65",
    timestamp: change?.late ? "0x77359478" : "0x77359401",
    transactions: [tx],
  };
  const store: DepositStore = {
    find: async () => binding,
    allocate: async ({ addresses, ...input }) =>
      (binding = {
        ...input,
        integrationId: "integration",
        address: addresses[0],
        acceptBefore: new Date(2000000120000),
      }),
    claim: async (_b, e) => {
      claim = e;
    },
    scanStart: async () => cursor,
    advanceScan: async (_b, n) => {
      cursor = n;
    },
  };
  const deps: NativeDeps = {
    deposits: store,
    credentials: { get: async () => "unused" },
    http: async (_base, options) => {
      const request = JSON.parse(options.body!);
      const result =
        request.method === "eth_chainId"
          ? change?.wrongChain
            ? "0x1"
            : "0x14a34"
          : request.method === "eth_blockNumber"
            ? `0x${head.toString(16)}`
            : request.method === "eth_getBlockByNumber"
              ? request.params[0] === "finalized"
                ? { ...block, number: change?.unfinalized ? "0x64" : "0x65" }
                : {
                    ...block,
                    hash:
                      change?.reorg && ++reads > 1
                        ? `0x${"e".repeat(64)}`
                        : blockHash,
                  }
              : request.method === "eth_getTransactionReceipt"
                ? {
                    transactionHash: txHash,
                    blockHash,
                    blockNumber: "0x65",
                    status: change?.failed ? "0x0" : "0x1",
                    to: receiver,
                    from: tx.from,
                  }
                : null;
      return {
        status: 200,
        bytes: 0,
        headers: {},
        body: JSON.stringify({ id: request.id, jsonrpc: "2.0", result }),
      };
    },
  };
  const adapter = nativeDepositExecutionAdapter(
    {
      adapter: "evm-native-deposit",
      environment: "sandbox",
      network: asset.network,
      identifier: asset.identifier,
      addresses: [receiver],
      publicRpc: true,
    },
    deps,
  );
  const a = { id: "attempt", key: "attempt-key", environment: "sandbox" },
    i = {
      reference: "Crypto test",
      amount: "0.000000000000000001",
      precision: 18,
      selectedMethod: "crypto-app",
      asset: {
        kind: "blockchain",
        network: asset.network,
        identifier: asset.identifier,
      },
    };
  return {
    adapter,
    a,
    i,
    advance: () => {
      head = 101n;
    },
    claim: () => claim,
  };
}
test("native receipt confirms only exact successful canonical finalized value and claims once", async () => {
  const h = harness();
  await h.adapter.create(h.a, h.i);
  h.advance();
  assert.equal((await h.adapter.status(h.a, h.i))?.state, "Confirmed");
  assert.ok(h.claim());
});
for (const [name, change, code] of [
  ["failed", { failed: true }, "RECEIPT_MISMATCH"],
  ["late", { late: true }, "QUOTE_PAYMENT_LATE"],
  ["wrong amount", { wrongAmount: true }, "AMOUNT_MISMATCH"],
  ["self transfer", { self: true }, "TRANSFER_MISMATCH"],
] as const)
  test(`native ${name} is never claimed or settled`, async () => {
    const h = harness(change);
    await h.adapter.create(h.a, h.i);
    h.advance();
    await assert.rejects(h.adapter.status(h.a, h.i), new RegExp(code));
    assert.equal(h.claim(), null);
  });
test("native unfinalized and reorganized evidence never claims a payment", async () => {
  for (const change of [{ unfinalized: true }, { reorg: true }]) {
    const h = harness(change);
    await h.adapter.create(h.a, h.i);
    h.advance();
    assert.notEqual((await h.adapter.status(h.a, h.i))?.state, "Confirmed");
    assert.equal(h.claim(), null);
  }
});
test("native chain mismatch fails before address allocation", async () => {
  const h = harness({ wrongChain: true });
  await assert.rejects(h.adapter.create(h.a, h.i), /CHAIN_MISMATCH/);
});
test("native scanning reaches an on-time transfer beyond the first page before finality and resets after a reorg", async () => {
  for (const reorganize of [false, true]) {
    let binding: DepositBinding | null = null;
    let checkpoint: { nextBlock: bigint; cursor: string | null } = {
      nextBlock: 101n,
      cursor: null,
    };
    let final = 99n,
      revision = 0,
      paidBlock = 150n,
      claimed = false;
    const blockHashAt = (n: bigint) =>
      `0x${(n + (revision && n >= 110n ? 10000n : 0n)).toString(16).padStart(64, "0")}`;
    const transaction = () => ({
      hash: txHash,
      blockHash: blockHashAt(paidBlock),
      blockNumber: `0x${paidBlock.toString(16)}`,
      to: receiver,
      from: sender,
      value: "0x1",
      input: "0x",
    });
    const blockAt = (n: bigint) => ({
      number: `0x${n.toString(16)}`,
      hash: blockHashAt(n),
      parentHash: blockHashAt(n - 1n),
      timestamp: "0x77359401",
      transactions: n === paidBlock ? [transaction()] : [],
    });
    const store: DepositStore = {
      find: async () => binding,
      allocate: async ({ addresses, ...input }) =>
        (binding = {
          ...input,
          integrationId: "fixture",
          address: addresses[0],
          acceptBefore: new Date(2000000120000),
        }),
      checkpoint: async () => ({ ...checkpoint }),
      advanceCheckpoint: async (_b, nextBlock, cursor, expected) => {
        assert.deepEqual(checkpoint, expected);
        checkpoint = { nextBlock, cursor };
      },
      claim: async () => {
        claimed = true;
      },
    };
    const adapter = nativeDepositExecutionAdapter(
      {
        adapter: "evm-native-deposit",
        environment: "sandbox",
        network: "eip155:84532",
        identifier: "native:ETH",
        publicRpc: true,
        addresses: [receiver],
      },
      {
        deposits: store,
        credentials: { get: async () => "unused" },
        http: async (_base, options) => {
          const q = JSON.parse(options.body!);
          const result =
            q.method === "eth_chainId"
              ? "0x14a34"
              : q.method === "eth_blockNumber"
                ? binding
                  ? "0x98"
                  : "0x64"
                : q.method === "eth_getBlockByNumber"
                  ? blockAt(
                      q.params[0] === "finalized" ? final : BigInt(q.params[0]),
                    )
                  : q.method === "eth_getTransactionReceipt"
                    ? {
                        ...transaction(),
                        transactionHash: txHash,
                        status: "0x1",
                      }
                    : null;
          return {
            status: 200,
            headers: {},
            body: JSON.stringify({ id: q.id, jsonrpc: "2.0", result }),
          };
        },
      },
    );
    const attempt = { id: "paginated", key: "key", environment: "sandbox" };
    const intent = {
      reference: "Late in quote",
      amount: "0.000000000000000001",
      precision: 18,
      selectedMethod: "crypto-app",
      asset: {
        kind: "blockchain",
        network: "eip155:84532",
        identifier: "native:ETH",
      },
    };
    await adapter.create(attempt, intent);
    assert.equal(
      (await adapter.status(attempt, intent))?.state,
      "Requires action",
    );
    assert.equal(checkpoint.nextBlock, 133n);
    if (reorganize) {
      revision = 1;
      paidBlock = 120n;
      assert.equal(
        (await adapter.status(attempt, intent))?.state,
        "Requires action",
      );
      assert.equal(checkpoint.nextBlock, 101n);
    }
    assert.equal((await adapter.status(attempt, intent))?.state, "Pending");
    assert.equal(claimed, false);
    final = paidBlock;
    assert.equal((await adapter.status(attempt, intent))?.state, "Confirmed");
    assert.equal(claimed, true);
  }
});
