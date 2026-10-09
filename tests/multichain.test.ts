import "dotenv/config";
import { PortalError } from "../lib/portal/domain";
import { createHash } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Keypair as SolanaKeypair,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import {
  Keypair,
  Account,
  Asset,
  Operation,
  TransactionBuilder,
  xdr,
  FeeBumpTransaction,
} from "@stellar/stellar-sdk";
import { supportedChains, chain } from "../lib/blockchain/chains";
import { tokenAssets, tokenAsset } from "../lib/blockchain/assets";
import { assertLaunchAsset } from "../lib/payments/launch";
import { alchemyNetworkUrl } from "../lib/blockchain/alchemy";
import { alchemyReader } from "../lib/blockchain/alchemy-rpc";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createTransferCheckedInstruction,
} from "../lib/blockchain/solana-token";
import {
  verifySolanaTransfer,
  solanaDepositExecutionAdapter,
} from "../lib/providers/adapters/native/solana-deposit";
import {
  verifyStellarTransfer,
  checkStellarNetwork,
  stellarDepositConfigSchema,
  stellarLedgerKeys,
  canonicalStellarLedger,
  stellarDepositExecutionAdapter,
} from "../lib/providers/adapters/native/stellar-deposit";
import {
  buildSolanaWalletTransaction,
  verifySignedWalletTransaction,
} from "../lib/blockchain/wallet-submissions";
import {
  submitNativeDeposit,
  type StellarWallet,
  type CheckoutApi,
} from "../lib/blockchain/wallet-native";
import { submitDeposit } from "../lib/blockchain/wallet-payment";
import type {
  DepositBinding,
  DepositStore,
} from "../lib/blockchain/deposit-types";
import type { NativeDeps } from "../lib/providers/adapters/native/common";
const assets = (n: string, s = "USDC") =>
  tokenAssets.find((a) => a.network === n && a.symbol === s)!;
const payer = SolanaKeypair.generate(),
  receiver = SolanaKeypair.generate(),
  sig = "2".repeat(88);
function binding(n = "solana:devnet", symbol = "USDC"): DepositBinding {
  return {
    attemptId: "a",
    attemptKey: "k",
    integrationId: "i",
    environment: chain(n)!.testnet ? "sandbox" : "production",
    network: n,
    identifier: assets(n, symbol).identifier,
    address: receiver.publicKey.toBase58(),
    amount: "1.000001",
    precision: 6,
    startBlock: 100n,
  };
}
function solanaFixture(b = binding()) {
  const mint = assets(
    b.network,
    assets(b.network).identifier === b.identifier
      ? "USDC"
      : tokenAssets.find(
          (a) => a.identifier === b.identifier && a.network === b.network,
        )!.symbol,
  ).contractAddress;
  const source = getAssociatedTokenAddressSync(
      new PublicKey(mint),
      payer.publicKey,
    ).toBase58(),
    target = getAssociatedTokenAddressSync(
      new PublicKey(mint),
      new PublicKey(b.address),
    ).toBase58();
  return {
    slot: 101,
    transaction: {
      signatures: [sig],
      message: {
        accountKeys: [source, target],
        instructions: [
          {
            programId: TOKEN_PROGRAM_ID.toBase58(),
            parsed: {
              type: "transferChecked",
              info: {
                source,
                destination: target,
                mint,
                tokenAmount: { amount: "1000001", decimals: 6 },
              },
            },
          },
        ],
      },
    },
    meta: {
      err: null,
      preTokenBalances: [
        {
          accountIndex: 0,
          mint,
          owner: payer.publicKey.toBase58(),
          uiTokenAmount: { amount: "1000001", decimals: 6 },
        },
      ],
      postTokenBalances: [
        {
          accountIndex: 1,
          mint,
          owner: b.address,
          uiTokenAmount: { amount: "1000001", decimals: 6 },
        },
      ],
      innerInstructions: [] as { index: number; instructions: unknown[] }[],
    },
  };
}
for (const c of supportedChains)
  test(`${c.name}: exact registry asset, environment and Alchemy host`, () => {
    const a = assets(c.id);
    assert.ok(a);
    assert.doesNotThrow(() =>
      assertLaunchAsset(
        { kind: "blockchain", identifier: a.identifier, network: c.id },
        a.decimals,
        c.testnet ? "sandbox" : "production",
      ),
    );
    assert.throws(() =>
      assertLaunchAsset(
        { kind: "blockchain", identifier: a.identifier, network: c.id },
        a.decimals,
        c.testnet ? "production" : "sandbox",
      ),
    );
    assert.equal(
      new URL(alchemyNetworkUrl(c.id, "redacted-test")).hostname,
      `${c.alchemyName}.g.alchemy.com`,
    );
  });
test("USDT pins official issuer deployments, preserves mint case and never invents testnet USDT", () => {
  assert.deepEqual(
    tokenAssets
      .filter((a) => a.symbol === "USDT")
      .map((a) => a.network)
      .sort(),
    ["eip155:1", "eip155:43114", "solana:mainnet"].sort(),
  );
  assert.equal(
    assets("solana:mainnet", "USDT").contractAddress,
    "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  );
  assert.deepEqual(
    tokenAssets
      .filter((a) => a.symbol === "USDT0")
      .map((a) => a.network)
      .sort(),
    [],
  );
  for (const [network, identifier] of [
    ["eip155:42161", "erc20:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9"],
    ["eip155:137", "erc20:0xc2132d05d31c914a87c6611c10748aeb04b58e8f"],
    [
      "stellar:pubnet",
      "stellar:USDT0.GATISXX6BZ6NC7IKQBY37CJD4SOZL3CYZJWXEDG6JVIY4WBS6KXJHN6Q",
    ],
  ]) {
    assert.equal(tokenAsset(network, identifier), undefined);
    assert.throws(() =>
      assertLaunchAsset(
        { kind: "blockchain", network, identifier },
        6,
        "production",
      ),
    );
  }
  assert.equal(
    tokenAssets.filter(
      (a) => ["USDT", "USDT0"].includes(a.symbol) && chain(a.network)!.testnet,
    ).length,
    0,
  );
  assert.equal(
    new Set(tokenAssets.map((a) => `${a.network}|${a.identifier}`)).size,
    tokenAssets.length,
  );
});
for (const token of tokenAssets.filter(
  (t) => chain(t.network)?.family === "solana",
))
  test(`Solana ${token.symbol} ${token.network}: exact mint, destination and net received units`, () => {
    const b = binding(token.network, token.symbol),
      f = solanaFixture(b);
    assert.equal(verifySolanaTransfer(f, b, sig)?.amount, b.amount);
    const inner = structuredClone(f);
    inner.meta.innerInstructions = [
      { index: 0, instructions: inner.transaction.message.instructions },
    ];
    inner.transaction.message.instructions = [];
    assert.ok(verifySolanaTransfer(inner, b, sig));
    for (const change of [
      (r: typeof f) => {
        r.meta.err = { InstructionError: [0, "fail"] } as never;
      },
      (r: typeof f) => {
        r.slot = 99;
      },
      (r: typeof f) => {
        r.transaction.signatures[0] = "3".repeat(88);
      },
      (r: typeof f) => {
        r.transaction.message.instructions[0].parsed.info.mint =
          payer.publicKey.toBase58();
      },
      (r: typeof f) => {
        r.meta.postTokenBalances[0].uiTokenAmount.amount = "1000000";
      },
      (r: typeof f) => {
        r.transaction.message.instructions.push(
          r.transaction.message.instructions[0],
        );
      },
      (r: typeof f) => {
        r.transaction.message.instructions[0].parsed.info.source =
          r.transaction.message.instructions[0].parsed.info.destination;
      },
    ]) {
      const bad = structuredClone(f);
      change(bad);
      assert.throws(() => verifySolanaTransfer(bad, b, sig));
    }
  });
function transport(
  fn: (method: string, params: unknown) => unknown,
  deposits?: DepositStore,
): NativeDeps {
  return {
    credentials: { get: async () => "fictional-key" },
    deposits,
    http: async (_base, o) => {
      const r = JSON.parse(o.body!);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: r.id,
          result: fn(r.method, r.params),
        }),
      };
    },
  };
}
test("Solana: finalized receipt and canonical block are both required before a durable claim", async () => {
  const b = binding(),
    f = solanaFixture();
  let finalized = false,
    claimed = 0;
  const store: DepositStore = {
    find: async () => b,
    allocate: async () => b,
    claim: async () => {
      claimed++;
    },
  };
  const adapter = solanaDepositExecutionAdapter(
    {
      mode: "NATIVE",
      adapter: "solana-deposit",
      environment: "sandbox",
      network: b.network,
      identifier: b.identifier,
      addresses: [b.address],
      rpcKeyRef: "key",
    },
    transport((method, params) => {
      if (method === "getGenesisHash") return chain(b.network)!.genesisHash;
      if (method === "getSlot") return 105;
      if (method === "getSignaturesForAddress")
        return [{ signature: sig, slot: 101, err: null }];
      if (method === "getTransaction")
        return (params as [unknown, { commitment: string }])[1].commitment ===
          "finalized" && !finalized
          ? null
          : f;
      if (method === "getBlock")
        return { blockhash: receiver.publicKey.toBase58(), signatures: [sig] };
      throw new Error(method);
    }, store),
  );
  const attempt = { id: "a", key: "k", environment: "sandbox" };
  assert.equal((await adapter.status(attempt))?.state, "Pending");
  assert.equal(claimed, 0);
  finalized = true;
  assert.equal((await adapter.status(attempt))?.state, "Confirmed");
  assert.equal(claimed, 1);
});
test("Solana: wrong genesis never reads receipts or creates claims", async () => {
  const b = binding();
  let claims = 0;
  const adapter = solanaDepositExecutionAdapter(
    {
      mode: "NATIVE",
      adapter: "solana-deposit",
      environment: "sandbox",
      network: b.network,
      identifier: b.identifier,
      addresses: [b.address],
      rpcKeyRef: "key",
    },
    transport(() => "wrong-genesis", {
      find: async () => b,
      allocate: async () => b,
      claim: async () => {
        claims++;
      },
    }),
  );
  await assert.rejects(adapter.status({ id: "a", key: "k" }), /CHAIN_MISMATCH/);
  assert.equal(claims, 0);
});
const stellarPayer = Keypair.random(),
  stellarReceiver = Keypair.random();
function stellarFixture(
  symbol = "USDC",
  overrides: {
    amount?: string;
    issuer?: string;
    destination?: string;
    source?: Keypair;
    network?: string;
  } = {},
  assetNetwork = "stellar:testnet",
) {
  const token = assets(assetNetwork, symbol),
    network = overrides.network ?? assetNetwork,
    source = overrides.source ?? stellarPayer;
  const tx = new TransactionBuilder(new Account(source.publicKey(), "12"), {
    fee: "100",
    networkPassphrase: chain(network)!.passphrase!,
  })
    .addOperation(
      Operation.payment({
        destination: overrides.destination ?? stellarReceiver.publicKey(),
        asset: new Asset(symbol, overrides.issuer ?? token.contractAddress),
        amount: overrides.amount ?? "1.0000001",
      }),
    )
    .setTimeout(60)
    .build();
  tx.sign(source);
  const result = new xdr.TransactionResult({
    feeCharged: 100n,
    result: xdr.TransactionResultResult.txSuccess([
      xdr.OperationResult.opInner(
        xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess()),
      ),
    ]),
    ext: xdr.TransactionResultExt.fromXdrObject({ v: 0 }),
  });
  return {
    status: "SUCCESS",
    txHash: Buffer.from(tx.hash()).toString("hex"),
    ledger: 101,
    envelopeXdr: tx.toXDR(),
    resultXdr: result.toXDR("base64"),
  };
}
function stellarBinding(
  symbol = "USDC",
  network = "stellar:testnet",
): DepositBinding {
  return {
    ...binding(),
    network,
    identifier: assets(network, symbol).identifier,
    address: stellarReceiver.publicKey(),
    precision: 7,
    amount: "1.0000001",
  };
}
for (const token of tokenAssets.filter(
  (t) => chain(t.network)?.family === "stellar",
)) {
  const s = token.symbol,
    n = token.network;
  test(`Stellar ${s} ${n}: exact issuer, amount, recipient, hash and environment`, () => {
    const b = stellarBinding(s, n),
      good = stellarFixture(s, {}, n);
    assert.equal(verifyStellarTransfer(good, b).length, 1);
    assert.equal(
      verifyStellarTransfer(
        stellarFixture(s, { issuer: stellarPayer.publicKey() }, n),
        b,
      ).length,
      0,
    );
    assert.equal(
      verifyStellarTransfer(
        stellarFixture(s, { destination: stellarPayer.publicKey() }, n),
        b,
      ).length,
      0,
    );
    assert.throws(
      () =>
        verifyStellarTransfer(stellarFixture(s, { amount: "1.0000002" }, n), b),
      /AMOUNT/,
    );
    assert.throws(
      () =>
        verifyStellarTransfer(
          stellarFixture(s, { source: stellarReceiver }, n),
          b,
        ),
      /SELF_TRANSFER/,
    );
    assert.throws(
      () =>
        verifyStellarTransfer(
          stellarFixture(
            s,
            {
              network:
                n === "stellar:testnet" ? "stellar:pubnet" : "stellar:testnet",
            },
            n,
          ),
          b,
        ),
      /RECEIPT/,
    );
    assert.throws(
      () => verifyStellarTransfer({ ...good, ledger: 99 }, b),
      /RECEIPT/,
    );
    assert.throws(
      () => verifyStellarTransfer({ ...good, txHash: "a".repeat(64) }, b),
      /RECEIPT/,
    );
    assert.deepEqual(
      verifyStellarTransfer({ ...good, status: "FAILED" }, b),
      [],
    );
    assert.notDeepEqual(
      stellarLedgerKeys(b.address, assets(n, s).contractAddress, s),
      stellarLedgerKeys(
        b.address,
        assets(n, s).contractAddress,
        s === "USDC" ? "EURC" : "USDC",
      ),
    );
  });
}
test("Stellar receiver configuration requires exact classic issuer and rejects network/environment mismatch", async () => {
  const b = stellarBinding();
  assert.ok(
    stellarDepositConfigSchema.safeParse({
      mode: "NATIVE",
      adapter: "stellar-deposit",
      environment: "sandbox",
      network: b.network,
      identifier: b.identifier,
      rpcKeyRef: "key",
      addresses: [b.address],
    }).success,
  );
  assert.equal(
    stellarDepositConfigSchema.safeParse({
      mode: "NATIVE",
      adapter: "stellar-deposit",
      environment: "sandbox",
      network: "stellar:pubnet",
      identifier: b.identifier,
      rpcKeyRef: "key",
      addresses: [b.address],
    }).success,
    false,
  );
  await assert.rejects(
    checkStellarNetwork(
      async () => ({ passphrase: chain("stellar:pubnet")!.passphrase }),
      "stellar:testnet",
    ),
    /CHAIN_MISMATCH/,
  );
});
for (const asset of tokenAssets.filter(
  (t) => chain(t.network)?.family === "solana",
))
  test(`Solana ${asset.symbol} ${asset.network}: signed transfer binds mint, payer and exact message`, async () => {
    const b = binding(asset.network, asset.symbol),
      built = await buildSolanaWalletTransaction(
        async () => ({
          value: { blockhash: SolanaKeypair.generate().publicKey.toBase58() },
        }),
        payer.publicKey.toBase58(),
        b,
      );
    const tx = Transaction.from(Buffer.from(built.unsigned, "base64"));
    assert.equal(tx.instructions.length, 2);
    assert.equal(tx.instructions[1].data.readBigUInt64LE(1), 1000001n);
    assert.equal(tx.instructions[1].data[9], 6);
    assert.throws(() =>
      verifySignedWalletTransaction(
        b.network,
        payer.publicKey.toBase58(),
        built.messageHash,
        built.unsigned,
      ),
    );
    tx.sign(payer);
    const signed = tx.serialize().toString("base64");
    assert.ok(
      verifySignedWalletTransaction(
        b.network,
        payer.publicKey.toBase58(),
        built.messageHash,
        signed,
      ),
    );
    assert.throws(
      () =>
        verifySignedWalletTransaction(
          b.network,
          receiver.publicKey.toBase58(),
          built.messageHash,
          signed,
        ),
      /MISMATCH/,
    );
    tx.instructions[1].data.writeBigUInt64LE(1000002n, 1);
    tx.sign(payer);
    assert.throws(
      () =>
        verifySignedWalletTransaction(
          b.network,
          payer.publicKey.toBase58(),
          built.messageHash,
          tx.serialize().toString("base64"),
        ),
      /MISMATCH/,
    );
    const checked = createTransferCheckedInstruction(
      payer.publicKey,
      new PublicKey(assets(b.network).contractAddress),
      receiver.publicKey,
      payer.publicKey,
      1000001n,
      6,
    );
    assert.equal(checked.data.toString("hex"), "0c41420f000000000006");
  });
test("Stellar relaying checks message, master signature, payer and network", () => {
  const good = stellarFixture();
  const hash = good.txHash;
  assert.equal(
    verifySignedWalletTransaction(
      "stellar:testnet",
      stellarPayer.publicKey(),
      hash,
      good.envelopeXdr,
    ),
    hash,
  );
  assert.throws(
    () =>
      verifySignedWalletTransaction(
        "stellar:pubnet",
        stellarPayer.publicKey(),
        hash,
        good.envelopeXdr,
      ),
    /MISMATCH/,
  );
  assert.throws(
    () =>
      verifySignedWalletTransaction(
        "stellar:testnet",
        stellarReceiver.publicKey(),
        hash,
        good.envelopeXdr,
      ),
    /MISMATCH/,
  );
});
test("Freighter mismatched network never prepares or broadcasts a transaction", async () => {
  let requests = 0;
  const api: CheckoutApi = async () => {
    requests++;
    return {};
  };
  const w: StellarWallet = {
    requestAccess: async () => ({ address: stellarPayer.publicKey() }),
    getNetworkDetails: async () => ({
      networkPassphrase: chain("stellar:pubnet")!.passphrase!,
    }),
    signTransaction: async () => {
      throw new Error("must not sign");
    },
  };
  const b = stellarBinding();
  await assert.rejects(submitNativeDeposit(b, api, w), /Switch Freighter/);
  assert.equal(requests, 0);
});
test("Freighter cancellation does not broadcast; a lost broadcast response prevents a second payment", async () => {
  const b = stellarBinding();
  let calls = 0,
    cancel = true;
  const api: CheckoutApi = async (a) => {
    calls++;
    if ((a as { action: string }).action === "prepare-wallet")
      return {
        unsigned: "fictional-xdr",
        payer: stellarPayer.publicKey(),
        network: b.network,
        submissionId: "submission",
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      };
    throw new Error("lost response");
  };
  const wallet: StellarWallet = {
    requestAccess: async () => ({ address: stellarPayer.publicKey() }),
    getNetworkDetails: async () => ({
      networkPassphrase: chain(b.network)!.passphrase!,
    }),
    signTransaction: async () =>
      cancel
        ? { signedTxXdr: "", signerAddress: "", error: {} }
        : {
            signedTxXdr: "signed-fixture",
            signerAddress: stellarPayer.publicKey(),
          },
  };
  await assert.rejects(submitNativeDeposit(b, api, wallet), /cancelled/);
  assert.equal(calls, 1);
  cancel = false;
  await assert.rejects(
    submitNativeDeposit(b, api, wallet),
    (e) => (e as { mayHaveSent: boolean }).mayHaveSent,
  );
  assert.equal(calls, 3);
});
test("Alchemy RPC enforces named Stellar params, exact response id and sanitizes denied credentials", async () => {
  const rpc = alchemyReader(
    { network: "stellar:testnet", rpcKeyRef: "key", rpcMode: "alchemy" },
    transport((_m, p) => {
      assert.deepEqual(p, { hash: "test" });
      return { status: "NOT_FOUND" };
    }),
  );
  assert.deepEqual(await rpc("getTransaction", { hash: "test" }), {
    status: "NOT_FOUND",
  });
  const denied = alchemyReader(
    {
      network: "stellar:testnet",
      rpcKeyRef: "key",
      rpcMode: "alchemy",
      allowPublicFallback: false,
    },
    {
      credentials: { get: async () => "secret-test-key" },
      http: async () => ({ status: 429, headers: {}, body: "secret-test-key" }),
    },
  );
  await assert.rejects(denied("getNetwork", {}), /RPC_UNAVAILABLE_HTTP_429/);
});
test("Arc wallet adds USDC gas with 18 native decimals while token transfer stays 6 decimals", async () => {
  let correct = false;
  const calls: { method: string; params?: unknown[] }[] = [];
  const a = assets("eip155:5042002");
  const wallet = {
    request: async (q: { method: string; params?: unknown[] }) => {
      calls.push(q);
      if (q.method === "eth_chainId") return correct ? "0x4cef52" : "0x1";
      if (q.method === "wallet_switchEthereumChain") {
        if (!correct) throw Object.assign(new Error("unknown"), { code: 4902 });
        return null;
      }
      if (q.method === "wallet_addEthereumChain") {
        correct = true;
        return null;
      }
      if (q.method === "eth_requestAccounts") return ["0x" + "a".repeat(40)];
      if (q.method === "eth_sendTransaction") return "0x" + "b".repeat(64);
      return null;
    },
  };
  await submitDeposit(wallet, {
    address: "0x" + "c".repeat(40),
    network: a.network,
    identifier: a.identifier,
    amount: "1.000001",
  });
  const added = calls.find((c) => c.method === "wallet_addEthereumChain")!
    .params![0] as { nativeCurrency: { symbol: string; decimals: number } };
  assert.deepEqual(added.nativeCurrency, {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  });
});

test("Stellar canonical ledger fallback validates network, sequence and hash without oversized metadata", async () => {
  const expected = createHash("sha256")
    .update("fictional canonical ledger")
    .digest("hex");
  let network = "stellar:testnet",
    sequence = 101;
  const rpc = async () => {
    throw new PortalError("RPC_TRANSPORT_UNAVAILABLE", 503);
  };
  const deps: NativeDeps = {
    credentials: { get: async () => "" },
    http: async (_url, o) => ({
      status: 200,
      headers: {},
      body: JSON.stringify(
        o.path === "/"
          ? { network_passphrase: chain(network)!.passphrase }
          : { sequence, hash: expected },
      ),
    }),
  };
  assert.equal(
    await canonicalStellarLedger(rpc, deps, "stellar:testnet", 101),
    expected,
  );
  sequence = 102;
  await assert.rejects(
    canonicalStellarLedger(rpc, deps, "stellar:testnet", 101),
    /RECEIPT_MISMATCH/,
  );
  network = "stellar:pubnet";
  await assert.rejects(
    canonicalStellarLedger(rpc, deps, "stellar:testnet", 101),
    /CHAIN_MISMATCH/,
  );
  await assert.rejects(
    canonicalStellarLedger(
      async () => ({ ledgers: [] }),
      deps,
      "stellar:testnet",
      101,
    ),
    /INVALID_RPC_RESPONSE/,
  );
});
test("Stellar complete reader requires a canonical closed ledger before claiming and rejects conflicting receipts", async () => {
  const b = stellarBinding(),
    entry = stellarFixture();
  let claimed = 0,
    conflict = false;
  const store: DepositStore = {
    find: async () => b,
    allocate: async () => b,
    claim: async (_b, e) => {
      assert.equal(e.txHash, entry.txHash);
      assert.equal(e.amount, "1.0000001");
      claimed++;
    },
  };
  const deps: NativeDeps = {
    credentials: { get: async () => "" },
    deposits: store,
    http: async (_url, o) => {
      if (o.method === "GET")
        return {
          status: 200,
          headers: {},
          body: JSON.stringify(
            o.path === "/"
              ? { network_passphrase: chain(b.network)!.passphrase }
              : { sequence: 101, hash: "a".repeat(64) },
          ),
        };
      const q = JSON.parse(o.body!);
      let result: unknown;
      if (q.method === "getNetwork")
        result = { passphrase: chain(b.network)!.passphrase };
      else if (q.method === "getHealth")
        result = { status: "healthy", latestLedger: 105 };
      else if (q.method === "getTransactions")
        result = { oldestLedger: 90, transactions: [entry], cursor: "cursor" };
      else if (q.method === "getTransaction")
        result = conflict ? { ...entry, ledger: 102 } : entry;
      else if (q.method === "getLedgers")
        return { status: 503, headers: {}, body: "unavailable" };
      else throw new Error(q.method);
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }),
      };
    },
  };
  const adapter = stellarDepositExecutionAdapter(
    {
      mode: "NATIVE",
      adapter: "stellar-deposit",
      environment: "sandbox",
      network: b.network,
      identifier: b.identifier,
      addresses: [b.address],
      publicRpc: true,
    },
    deps,
  );
  assert.equal(
    (await adapter.status({ id: "a", key: "k" }))?.state,
    "Confirmed",
  );
  assert.equal(claimed, 1);
  conflict = true;
  await assert.rejects(
    adapter.status({ id: "a", key: "k" }),
    /RECEIPT_MISMATCH/,
  );
  assert.equal(claimed, 1);
});
test("public failover verifies chain identity before reads and never retries an ambiguous broadcast", async () => {
  const calls: string[] = [];
  let broadcast = false;
  const rpc = alchemyReader(
    { network: "solana:devnet", rpcKeyRef: "key", rpcMode: "auto" },
    {
      credentials: { get: async () => "fictional-key" },
      http: async (base, o) => {
        const q = JSON.parse(o.body!);
        calls.push(`${base}|${q.method}`);
        if (base.includes("alchemy"))
          return { status: 429, headers: {}, body: "quota" };
        const result =
          q.method === "getGenesisHash"
            ? chain("solana:devnet")!.genesisHash
            : 123;
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }),
        };
      },
    },
  );
  assert.equal(await rpc("getSlot", []), 123);
  assert.equal(rpc.source?.(), "public");
  assert.ok(calls[1].endsWith("|getGenesisHash"));
  const sending = alchemyReader(
    { network: "solana:devnet", rpcKeyRef: "key", rpcMode: "auto" },
    {
      credentials: { get: async () => "fictional-key" },
      http: async (base) => {
        assert.ok(base.includes("alchemy"));
        broadcast = true;
        return { status: 429, headers: {}, body: "quota" };
      },
    },
  );
  await assert.rejects(
    sending("sendTransaction", ["signed"]),
    /RPC_UNAVAILABLE_HTTP_429/,
  );
  assert.equal(broadcast, true);
});

test("token amount display removes padding without rounding meaningful decimals or large balances", async () => {
  const { displayTokenAmount } =
    await import("../lib/blockchain/stablecoin-payment");
  for (const [raw, expected] of [
    ["1.000000", "1.00"],
    ["1.0000000", "1.00"],
    ["0.900000", "0.90"],
    ["0.000001", "0.000001"],
    ["1.0000001", "1.0000001"],
    ["9007199254740993.000000", "9007199254740993.00"],
  ])
    assert.equal(displayTokenAmount(raw), expected);
});

test("checkout countdown shows remaining time and clamps expired/invalid windows", async () => {
  const { checkoutCountdown } =
    await import("../lib/payments/checkout-display");
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(checkoutCountdown("2026-10-07T12:30:00Z", now), "30:00");
  assert.equal(checkoutCountdown("2026-10-07T12:01:05Z", now), "01:05");
  assert.equal(checkoutCountdown("2026-10-07T11:59:59Z", now), "00:00");
  assert.equal(checkoutCountdown("invalid", now), "00:00");
});

for (const symbol of ["USDC", "EURC"])
  test(`Stellar ${symbol}: fee-bump success binds the exact inner hash and operation result`, () => {
    const b = stellarBinding(symbol, "stellar:pubnet"),
      fixture = stellarFixture(symbol, {}, b.network);
    const tx = TransactionBuilder.fromXDR(
      fixture.envelopeXdr,
      chain(b.network)!.passphrase!,
    );
    if (tx instanceof FeeBumpTransaction)
      throw new Error("Expected classic transaction");
    const bump = TransactionBuilder.buildFeeBumpTransaction(
      stellarPayer,
      "100",
      tx,
      chain(b.network)!.passphrase!,
    );
    bump.sign(stellarPayer);
    const opResults = [
      xdr.OperationResult.opInner(
        xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess()),
      ),
    ];
    const result = (hash = Buffer.from(tx.hash()), operations = opResults) =>
      new xdr.TransactionResult({
        feeCharged: 200n,
        result: xdr.TransactionResultResult.txFeeBumpInnerSuccess(
          new xdr.InnerTransactionResultPair({
            transactionHash: hash,
            result: new xdr.InnerTransactionResult({
              feeCharged: 0n,
              result: xdr.InnerTransactionResultResult.txSuccess(operations),
              ext: xdr.InnerTransactionResultExt.fromXdrObject({ v: 0 }),
            }),
          }),
        ),
        ext: xdr.TransactionResultExt.fromXdrObject({ v: 0 }),
      }).toXDR("base64");
    const raw = {
      ...fixture,
      envelopeXdr: bump.toXDR(),
      txHash: Buffer.from(bump.hash()).toString("hex"),
      resultXdr: result(),
    };
    assert.equal(verifyStellarTransfer(raw, b).length, 1);
    assert.throws(
      () =>
        verifyStellarTransfer(
          { ...raw, resultXdr: result(Buffer.alloc(32)) },
          b,
        ),
      /RECEIPT/,
    );
    assert.throws(
      () => verifyStellarTransfer({ ...raw, resultXdr: fixture.resultXdr }, b),
      /RECEIPT/,
    );
    assert.throws(
      () =>
        verifyStellarTransfer(
          { ...raw, resultXdr: result(Buffer.from(tx.hash()), []) },
          b,
        ),
      /RECEIPT/,
    );
    assert.throws(
      () =>
        verifyStellarTransfer(
          {
            ...raw,
            resultXdr: result(Buffer.from(tx.hash()), [
              xdr.OperationResult.opInner(
                xdr.OperationResultTr.payment(
                  xdr.PaymentResult.paymentUnderfunded(),
                ),
              ),
            ]),
          },
          b,
        ),
      /RECEIPT/,
    );
  });
