import { tokenAssets } from "../lib/blockchain/assets";
import { chain } from "../lib/blockchain/chains";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  depositPayment,
  submitDeposit,
} from "../lib/blockchain/wallet-payment";
import {
  assertLaunchAsset,
  assertLaunchMethod,
  enforceLaunchScope,
} from "../lib/payments/launch";
import { comingSoonMethods } from "../lib/payments/launch-catalog";
import { depositExecutionAdapter } from "../lib/providers/adapters/native/erc20-deposit";
import type {
  DepositStore,
  DepositBinding,
} from "../lib/blockchain/deposit-types";
import type { NativeDeps } from "../lib/providers/adapters/native/common";
const payment = {
  address: `0x${"a".repeat(40)}`,
  network: "eip155:84532",
  identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e",
  amount: "1.000001",
};
const txHash = `0x${"b".repeat(64)}`;
function wallet(responses: Record<string, unknown | (() => unknown)>) {
  const calls: { method: string; params?: unknown[] }[] = [];
  return {
    calls,
    request: async (q: (typeof calls)[number]) => {
      calls.push(q);
      const r = responses[q.method];
      return typeof r === "function" ? r() : r;
    },
  };
}
test("MVP rejects future categories, unsupported contracts, precision and wrong environment", () => {
  assert.equal(enforceLaunchScope(), true);
  assert.equal(comingSoonMethods.length, 7);
  for (const method of comingSoonMethods)
    assert.throws(() => assertLaunchMethod(method.method), /COMING_SOON/);
  assert.doesNotThrow(() =>
    assertLaunchAsset(
      {
        kind: "blockchain",
        network: payment.network,
        identifier: payment.identifier,
      },
      6,
      "sandbox",
    ),
  );
  for (const a of [
    { kind: "fiat", network: "", identifier: "USD" },
    {
      kind: "blockchain",
      network: payment.network,
      identifier: `erc20:${payment.address}`,
    },
  ])
    assert.throws(() => assertLaunchAsset(a, 6, "sandbox"), /NOT_SUPPORTED/);
  assert.throws(
    () =>
      assertLaunchAsset(
        {
          kind: "blockchain",
          network: payment.network,
          identifier: payment.identifier,
        },
        6,
        "production",
      ),
    /NOT_SUPPORTED/,
  );
  assert.throws(
    () =>
      assertLaunchAsset(
        {
          kind: "blockchain",
          network: payment.network,
          identifier: payment.identifier,
        },
        18,
        "sandbox",
      ),
    /NOT_SUPPORTED/,
  );
});
test("wallet transfer contains exact ERC20 units and token contract; URI uses chain id", async () => {
  const w = wallet({
    eth_chainId: "0x14a34",
    eth_requestAccounts: [payment.address],
    eth_sendTransaction: txHash,
  });
  assert.equal(await submitDeposit(w, payment), txHash);
  const q = w.calls.find((q) => q.method === "eth_sendTransaction")!
    .params![0] as { to: string; data: string; value: string };
  assert.equal(q.to, payment.identifier.slice(6));
  assert.equal(q.value, "0x0");
  assert.equal(
    q.data,
    `0xa9059cbb${payment.address.slice(2).padStart(64, "0")}${1000001n.toString(16).padStart(64, "0")}`,
  );
  assert.ok(
    depositPayment(payment).uri.endsWith(
      `@84532/transfer?address=${payment.address}&uint256=1000001`,
    ),
  );
});
test("wallet cancellation, wrong network after switching and expiry never send", async () => {
  const changed = wallet({
    eth_chainId: "0x1",
    wallet_switchEthereumChain: undefined,
    eth_requestAccounts: [payment.address],
  });
  await assert.rejects(submitDeposit(changed, payment), /Switch your wallet/);
  assert.ok(!changed.calls.some((c) => c.method === "eth_sendTransaction"));
  const rejected = wallet({
    eth_chainId: "0x14a34",
    eth_requestAccounts: () => {
      throw Object.assign(new Error("User rejected"), { code: 4001 });
    },
  });
  await assert.rejects(submitDeposit(rejected, payment), /rejected/);
  assert.ok(!rejected.calls.some((c) => c.method === "eth_sendTransaction"));
  const expired = wallet({});
  await assert.rejects(
    submitDeposit(expired, payment, new Date(0).toISOString()),
    /expired/,
  );
  assert.equal(expired.calls.length, 0);
});
test("Base Sepolia can be added only from fixed metadata; chain rechecked before sending", async () => {
  let chain = "0x1",
    switches = 0;
  const w = wallet({
    eth_chainId: () => chain,
    eth_requestAccounts: [payment.address],
    wallet_switchEthereumChain: () => {
      if (++switches === 1) throw Object.assign(new Error(), { code: 4902 });
      chain = "0x14a34";
    },
    wallet_addEthereumChain: undefined,
    eth_sendTransaction: txHash,
  });
  await submitDeposit(w, payment);
  const metadata = w.calls.find((q) => q.method === "wallet_addEthereumChain")!
    .params![0] as { rpcUrls: string[] };
  assert.deepEqual(metadata.rpcUrls, ["https://sepolia.base.org"]);
});
test("invalid wallet instructions never request permissions or transfers", async () => {
  for (const p of [
    { ...payment, amount: "0" },
    { ...payment, amount: "1.0000001" },
    { ...payment, address: `0x${"0".repeat(40)}` },
    { ...payment, identifier: `erc20:${payment.address}` },
  ]) {
    const w = wallet({});
    await assert.rejects(submitDeposit(w, p));
    assert.equal(w.calls.length, 0);
  }
});
function scanHarness(paymentOverride = payment) {
  const payment = paymentOverride;
  const network = chain(payment.network)!;
  const environment = network.testnet ? "sandbox" : "production";
  let binding: DepositBinding | null = null,
    cursor = 0n,
    head = 200n,
    finalized = 150n,
    transferBlock: bigint | undefined;
  const ranges: [bigint, bigint][] = [],
    hash = `0x${"c".repeat(64)}`;
  const transfer = () => ({
    address: payment.identifier.slice(6),
    topics: [
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
      `0x${"d".repeat(64)}`,
      `0x${payment.address.slice(2).padStart(64, "0")}`,
    ],
    data: `0x${1000001n.toString(16).padStart(64, "0")}`,
    blockNumber: `0x${transferBlock!.toString(16)}`,
    blockHash: hash,
    transactionHash: txHash,
    logIndex: "0x0",
    removed: false,
  });
  let claims = 0;
  let claimed: {
    txHash: string;
    logIndex: string;
    blockHash: string;
    amount: string;
  } | null = null;
  const store: DepositStore = {
    find: async () => binding,
    allocate: async (i) => {
      const { addresses, ...b } = i;
      binding = { ...b, address: addresses[0], integrationId: "native-test" };
      cursor = b.startBlock;
      return binding;
    },
    claimed: async () => claimed,
    claim: async (_b, evidence) => {
      claims++;
      claimed = evidence;
    },
    scanStart: async () => cursor,
    advanceScan: async (_b, next) => {
      cursor = next;
    },
  };
  const deps: NativeDeps = {
    deposits: store,
    credentials: { get: async () => "key" },
    http: async (_url, o) => {
      const q = JSON.parse(o.body!),
        hex = (n: bigint) => `0x${n.toString(16)}`;
      let result: unknown;
      if (q.method === "eth_chainId")
        result = `0x${BigInt(payment.network.split(":")[1]).toString(16)}`;
      if (q.method === "eth_blockNumber") result = hex(head);
      if (q.method === "eth_getBlockByNumber")
        result = {
          hash,
          number: q.params[0] === "finalized" ? hex(finalized) : q.params[0],
        };
      if (q.method === "eth_getLogs") {
        const from = BigInt(q.params[0].fromBlock),
          to = BigInt(q.params[0].toBlock);
        assert.ok(
          to - from < 500n,
          "Public RPC query must respect its 500-block limit",
        );
        ranges.push([from, to]);
        result =
          transferBlock && transferBlock >= from && transferBlock <= to
            ? [transfer()]
            : [];
      }
      if (q.method === "eth_getTransactionReceipt")
        result = {
          transactionHash: txHash,
          blockHash: hash,
          blockNumber: hex(transferBlock!),
          status: "0x1",
          logs: [transfer()],
        };
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }),
      };
    },
  };
  const a = { id: "test-attempt", key: "test:key", environment };
  const adapter = depositExecutionAdapter(
    {
      environment,
      network: payment.network,
      identifier: payment.identifier,
      ...(payment.network === "eip155:84532"
        ? { publicTestnetRpc: true }
        : { publicRpc: true, logBlockRange: 500 }),
      addresses: [payment.address],
    },
    deps,
  );
  return {
    adapter,
    a,
    ranges,
    cursor: () => cursor,
    claims: () => claims,
    set: (h: bigint, f: bigint, t?: bigint) => {
      head = h;
      finalized = f;
      transferBlock = t;
    },
  };
}
test("scanner checkpoints empty finalized blocks only, then finds the transfer after restart", async () => {
  const h = scanHarness();
  h.set(100n, 90n);
  const c = await h.adapter.create(h.a, {
    reference: "Invoice",
    selectedMethod: "stablecoin",
    amount: payment.amount,
    precision: 6,
    asset: {
      kind: "blockchain",
      network: payment.network,
      identifier: payment.identifier,
    },
  });
  h.set(200n, 150n);
  assert.equal(
    (await h.adapter.status({ ...h.a, providerReference: c.reference }))?.state,
    "Requires action",
  );
  assert.equal(h.cursor(), 151n);
  assert.deepEqual(h.ranges, [[101n, 200n]]);
  h.set(200n, 170n, 160n);
  assert.equal(
    (await h.adapter.status({ ...h.a, providerReference: c.reference }))?.state,
    "Confirmed",
  );
  assert.equal(h.cursor(), 151n);
  assert.equal(h.claims(), 1);
  assert.deepEqual(h.ranges.at(-1), [151n, 200n]);
});
test("scanner catches up bounded pages without discarding old transfers", async () => {
  const h = scanHarness();
  h.set(0n, 0n);
  await h.adapter.create(h.a, {
    reference: "Invoice",
    selectedMethod: "stablecoin",
    amount: payment.amount,
    precision: 6,
    asset: {
      kind: "blockchain",
      network: payment.network,
      identifier: payment.identifier,
    },
  });
  h.set(30000n, 25000n);
  assert.equal((await h.adapter.status(h.a))?.state, "Requires action");
  assert.equal(h.ranges.length, 20);
  assert.equal(h.cursor(), 10001n);
  h.set(15000n, 15000n, 14000n);
  assert.equal((await h.adapter.status(h.a))?.state, "Confirmed");
  assert.equal(h.claims(), 1);
});

test("a canonical exact transfer is detected before finality without claiming; disappearance returns to awaiting payment", async () => {
  const h = scanHarness();
  h.set(100n, 90n);
  await h.adapter.create(h.a, {
    reference: "Invoice",
    selectedMethod: "stablecoin",
    amount: payment.amount,
    precision: 6,
    asset: {
      kind: "blockchain",
      network: payment.network,
      identifier: payment.identifier,
    },
  });
  h.set(200n, 150n, 160n);
  assert.equal((await h.adapter.status(h.a))?.state, "Pending");
  assert.equal(h.claims(), 0);
  assert.equal(h.cursor(), 101n);
  h.set(200n, 150n);
  assert.equal((await h.adapter.status(h.a))?.state, "Requires action");
  assert.equal(h.cursor(), 151n);
  assert.equal(h.claims(), 0);
  h.set(200n, 170n, 160n);
  assert.equal((await h.adapter.status(h.a))?.state, "Confirmed");
  assert.equal(h.claims(), 1);
});

test("finalized receipt reconciliation remains bounded after a long gap and revalidates its canonical evidence", async () => {
  const h = scanHarness();
  h.set(100n, 90n);
  const created = await h.adapter.create(h.a, {
    reference: "Invoice",
    selectedMethod: "stablecoin",
    amount: payment.amount,
    precision: 6,
    asset: {
      kind: "blockchain",
      network: payment.network,
      identifier: payment.identifier,
    },
  });
  h.set(200n, 170n, 160n);
  assert.equal(
    (await h.adapter.status({ ...h.a, providerReference: created.reference }))
      ?.state,
    "Confirmed",
  );
  const queries = h.ranges.length;
  h.set(100000n, 99900n, 160n);
  assert.equal(
    (await h.adapter.status({ ...h.a, providerReference: created.reference }))
      ?.state,
    "Confirmed",
  );
  assert.equal(h.ranges.length, queries);
});

for (const token of tokenAssets.filter(
  (t) => chain(t.network)?.family === "evm",
))
  test(`${token.symbol} ${token.network}: exact wallet transfer, finalized receipt and durable claim`, async () => {
    const p = {
      ...payment,
      network: token.network,
      identifier: token.identifier,
    };
    const w = wallet({
      eth_chainId: `0x${BigInt(token.network.split(":")[1]).toString(16)}`,
      eth_requestAccounts: [`0x${"d".repeat(40)}`],
      eth_sendTransaction: txHash,
    });
    await submitDeposit(w, p);
    const submitted = w.calls.find((q) => q.method === "eth_sendTransaction")!
      .params![0] as { to: string; data: string };
    assert.equal(submitted.to, token.contractAddress);
    assert.equal(submitted.data.slice(0, 10), "0xa9059cbb");
    assert.equal(BigInt("0x" + submitted.data.slice(-64)), 1000001n);
    assert.ok(!w.calls.some((q) => q.method.includes("approve")));
    const h = scanHarness(p);
    h.set(100n, 90n);
    const created = await h.adapter.create(h.a, {
      reference: "Fictional token qualification",
      selectedMethod: "stablecoin",
      amount: p.amount,
      precision: token.decimals,
      asset: {
        kind: "blockchain",
        network: token.network,
        identifier: token.identifier,
      },
    });
    h.set(200n, 150n, 160n);
    assert.equal((await h.adapter.status(h.a))?.state, "Pending");
    assert.equal(h.claims(), 0);
    h.set(200n, 170n, 160n);
    const final = await h.adapter.status({
      ...h.a,
      providerReference: created.reference,
    });
    assert.equal(final?.state, "Confirmed");
    assert.equal(final?.amount, p.amount);
    assert.deepEqual(final?.asset, {
      kind: "blockchain",
      network: token.network,
      identifier: token.identifier,
    });
    assert.equal(h.claims(), 1);
  });
