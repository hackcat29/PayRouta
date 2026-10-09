import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Keypair as SolKeypair,
  Transaction,
  SystemInstruction,
} from "@solana/web3.js";
import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import {
  cryptoAssets,
  cryptoAsset,
  validPaymentAmount,
} from "../lib/blockchain/crypto-assets";
import { chain } from "../lib/blockchain/chains";
import { tokenMinor } from "../lib/blockchain/assets";
import {
  cryptoPaymentTerms,
  coinGeckoPrices,
} from "../lib/payments/crypto-prices";
import { cryptoCheckoutInput } from "../lib/payments/crypto-contracts";
import { factAction } from "../lib/payments/contracts";
test("all catalog deposit instructions survive the payment contract and reject a substituted symbol", () => {
  const solana = SolKeypair.generate().publicKey.toBase58();
  const stellar = Keypair.random().publicKey();
  for (const asset of cryptoAssets) {
    const family = chain(asset.network)!.family;
    const action = {
      kind: "deposit",
      provider: "Crypto wallet",
      text: "Send the selected coin once",
      address:
        family === "evm"
          ? `0x${"a".repeat(40)}`
          : family === "solana"
            ? solana
            : stellar,
      network: asset.network,
      identifier: asset.identifier,
      amount: "1",
      symbol: asset.symbol,
    };
    assert.equal(
      factAction.safeParse(action).success,
      true,
      asset.network + " " + asset.symbol,
    );
    assert.equal(
      factAction.safeParse({ ...action, symbol: "UNREGISTERED" }).success,
      false,
    );
  }
});
import {
  buildSolanaWalletTransaction,
  buildStellarWalletTransaction,
  verifySignedWalletTransaction,
} from "../lib/blockchain/wallet-submissions";
import {
  solanaRecipient,
  verifySolanaTransfer,
  solanaDepositExecutionAdapter,
} from "../lib/providers/adapters/native/solana-deposit";
import {
  verifyStellarTransfer,
  canonicalStellarLedger,
} from "../lib/providers/adapters/native/stellar-deposit";
import { TOKEN_PROGRAM_ID } from "../lib/blockchain/solana-token";
import type { DepositBinding } from "../lib/blockchain/deposit-types";
import { stellarAccountData } from "./fixtures/crypto";
import { liveScopeInput } from "../lib/merchant/live-scope";
const mainnet = cryptoAssets.filter((a) => !chain(a.network)?.testnet);
test("production review can name the full crypto catalog and still rejects unknown deployments and missing methods", () => {
  const keys = mainnet.map((a) => `blockchain:${a.identifier}:${a.network}`);
  const input = {
    environment: "production",
    merchantCountry: "US",
    payerCountries: ["US"],
    methods: ["crypto-app"],
    asset: keys[0],
    settlementAsset: keys[0],
    maximumMinor: "10000",
    dailyMaximumMinor: "100000",
    additionalAssets: keys.slice(1).map((asset) => ({
      asset,
      maximumMinor: "10000",
      dailyMaximumMinor: "100000",
    })),
    profileIds: [],
    accounts: mainnet.map((_a, index) => ({
      integrationId: `review-${index}`,
      accountReference: `merchant-owned-${index}`,
    })),
    evidenceIds: ["review-evidence"],
    nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
  };
  assert.ok(liveScopeInput.safeParse(input).success);
  assert.equal(
    liveScopeInput.safeParse({ ...input, methods: ["stablecoin"] }).success,
    false,
  );
  assert.equal(
    liveScopeInput.safeParse({
      ...input,
      additionalAssets: [
        ...input.additionalAssets,
        {
          asset: "blockchain:native:ETH:solana:mainnet",
          maximumMinor: "10000",
          dailyMaximumMinor: "100000",
        },
      ],
    }).success,
    false,
  );
});
test("catalog has reviewed exact deployments, 20 coins per populated chain and an honest Stellar shortfall", () => {
  for (const network of [...new Set(mainnet.map((a) => a.network))])
    assert.equal(
      mainnet.filter((a) => a.network === network).length,
      network === "stellar:pubnet" ? 12 : 20,
    );
  assert.equal(
    new Set(cryptoAssets.map((a) => a.network + "|" + a.identifier)).size,
    cryptoAssets.length,
  );
  for (const a of mainnet.filter((a) => a.contractAddress)) {
    assert.ok(a.verifiedAt);
    assert.ok(a.deploymentSource);
    assert.ok(a.tokenListSource);
    assert.doesNotMatch(a.coinGeckoId, /wrapped|bridged|staked|dinari|xstock/);
  }
  assert.equal(cryptoAsset("solana:mainnet", "native:ETH"), undefined);
  assert.equal(
    cryptoAsset(
      "eip155:42161",
      cryptoAssets.find((a) => a.symbol === "PEPE")!.identifier,
    ),
    undefined,
  );
  assert.equal(
    cryptoAssets.some((a) => ["WETH", "WSOL", "WBTC"].includes(a.symbol)),
    false,
  );
});
test("one price batch uses reviewed IDs, rejects forged deployments and enforces the checkout option limit", async () => {
  const now = new Date(),
    selected = mainnet.slice(0, 20);
  let calls = 0;
  const prices = await coinGeckoPrices(selected, now, async (_base, o) => {
    calls++;
    assert.match(o.path, /simple\/price\?ids=/);
    const body = JSON.stringify(
      Object.fromEntries(
        selected.map((a) => [
          a.coinGeckoId,
          { usd: 1, last_updated_at: Math.floor(now.getTime() / 1000) },
        ]),
      ),
    );
    return { status: 200, headers: {}, body, bytes: body.length };
  });
  assert.equal(calls, 1);
  assert.equal(
    Object.keys(prices).length,
    new Set(selected.map((a) => a.coinGeckoId)).size,
  );
  await assert.rejects(
    coinGeckoPrices([{ ...selected[0], coinGeckoId: "bitcoin" }], now),
    /UNSUPPORTED_PAYMENT_ASSET/,
  );
  const input = {
    reference: "Invoice",
    payerCountry: "US",
    usdAmount: "1.00",
    options: selected.map((a) => ({
      network: a.network,
      identifier: a.identifier,
    })),
  };
  assert.ok(cryptoCheckoutInput.safeParse(input).success);
  assert.equal(
    cryptoCheckoutInput.safeParse({
      ...input,
      options: [...input.options, input.options[0]],
    }).success,
    false,
  );
});
for (const a of cryptoAssets)
  test(`exact quote and protocol precision: ${a.symbol} ${a.network}`, () => {
    const terms = cryptoPaymentTerms(
      a,
      "1.00",
      { usd: "3", source: "CoinGecko", updatedAt: new Date().toISOString() },
      "sandbox",
      new Date(Date.now() + 120000),
    );
    const units = tokenMinor(terms.amount, a.decimals),
      scale = 10n ** BigInt(a.decimals);
    assert.ok(units * 3n >= scale && (units - 1n) * 3n < scale);
    assert.ok(validPaymentAmount(a.network, a.identifier, terms.amount));
    assert.equal(
      validPaymentAmount(a.network, a.identifier, terms.amount + "1"),
      false,
    );
  });
const payer = SolKeypair.generate(),
  receiver = SolKeypair.generate(),
  signature = "2".repeat(88);
for (const a of cryptoAssets.filter(
  (a) => chain(a.network)?.family === "solana",
))
  test(`Solana ${a.symbol}: signed exact transfer and successful receipt bind mint and receiver`, async () => {
    const amount = `1.${"0".repeat(a.decimals - 1)}1`,
      units = tokenMinor(amount, a.decimals);
    const b: DepositBinding = {
      attemptId: "a",
      attemptKey: "k",
      integrationId: "i",
      environment: chain(a.network)!.testnet ? "sandbox" : "production",
      network: a.network,
      identifier: a.identifier,
      address: receiver.publicKey.toBase58(),
      amount,
      precision: a.decimals,
      startBlock: 100n,
    };
    const built = await buildSolanaWalletTransaction(
      async () => ({
        value: { blockhash: SolKeypair.generate().publicKey.toBase58() },
      }),
      payer.publicKey.toBase58(),
      b,
    );
    const tx = Transaction.from(Buffer.from(built.unsigned, "base64"));
    if (!a.contractAddress)
      assert.equal(
        SystemInstruction.decodeTransfer(tx.instructions[0]).lamports,
        units,
      );
    else {
      assert.equal(tx.instructions[1].data.readBigUInt64LE(1), units);
      assert.equal(tx.instructions[1].data[9], a.decimals);
    }
    tx.sign(payer);
    assert.ok(
      verifySignedWalletTransaction(
        a.network,
        payer.publicKey.toBase58(),
        built.messageHash,
        tx.serialize().toString("base64"),
      ),
    );
    if (!a.contractAddress) return;
    const destination = solanaRecipient(b.address, a.contractAddress);
    const receipt = {
      slot: 101,
      transaction: {
        signatures: [signature],
        message: {
          accountKeys: [payer.publicKey.toBase58(), destination],
          instructions: [
            {
              programId: TOKEN_PROGRAM_ID.toBase58(),
              parsed: {
                type: "transferChecked",
                info: {
                  source: payer.publicKey.toBase58(),
                  destination,
                  mint: a.contractAddress,
                  tokenAmount: {
                    amount: units.toString(),
                    decimals: a.decimals,
                  },
                },
              },
            },
          ],
        },
      },
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [
          {
            accountIndex: 1,
            mint: a.contractAddress,
            owner: b.address,
            uiTokenAmount: { amount: units.toString(), decimals: a.decimals },
          },
        ],
      },
    };
    assert.ok(verifySolanaTransfer(receipt, b, signature));
    receipt.transaction.message.instructions[0].parsed.info.mint =
      payer.publicKey.toBase58();
    assert.throws(
      () => verifySolanaTransfer(receipt, b, signature),
      /TOKEN_MISMATCH/,
    );
  });
const stellarPayer = Keypair.random(),
  stellarReceiver = Keypair.random();
test("native XLM wallet builds a native payment without a trustline and binds the exact signed message", async () => {
  let accountReads = 0;
  const built = await buildStellarWalletTransaction(
    async (method, params) => {
      if (method === "getFeeStats") return { inclusionFee: { p70: "100" } };
      assert.equal(method, "getLedgerEntries");
      const key = (params as { keys: string[] }).keys[0];
      const address =
        accountReads++ === 0
          ? stellarReceiver.publicKey()
          : stellarPayer.publicKey();
      return { entries: [{ key, xdr: stellarAccountData(address) }] };
    },
    "stellar:testnet",
    stellarPayer.publicKey(),
    {
      address: stellarReceiver.publicKey(),
      identifier: "native:XLM",
      amount: "0.1234567",
    },
  );
  assert.equal(accountReads, 2);
  const parsed = TransactionBuilder.fromXDR(
    built.unsigned,
    chain("stellar:testnet")!.passphrase!,
  );
  assert.ok("operations" in parsed);
  const payment = parsed.operations[0];
  assert.equal(payment.type, "payment");
  if (payment.type !== "payment") throw new Error("Expected payment");
  assert.ok(payment.asset.isNative());
  assert.equal(payment.amount, "0.1234567");
  assert.equal(payment.destination, stellarReceiver.publicKey());
  assert.throws(() =>
    verifySignedWalletTransaction(
      "stellar:testnet",
      stellarPayer.publicKey(),
      built.messageHash,
      built.unsigned,
    ),
  );
  parsed.sign(stellarPayer);
  assert.equal(
    verifySignedWalletTransaction(
      "stellar:testnet",
      stellarPayer.publicKey(),
      built.messageHash,
      parsed.toXDR(),
    ),
    built.messageHash,
  );
});
for (const a of cryptoAssets.filter(
  (a) => chain(a.network)?.family === "stellar",
))
  test(`Stellar ${a.symbol}: successful signed payment binds original issuer or native XLM`, () => {
    const b: DepositBinding = {
      attemptId: "a",
      attemptKey: "k",
      integrationId: "i",
      environment: chain(a.network)!.testnet ? "sandbox" : "production",
      network: a.network,
      identifier: a.identifier,
      address: stellarReceiver.publicKey(),
      amount: "1.0000001",
      precision: 7,
      startBlock: 100n,
    };
    const tx = new TransactionBuilder(
      new Account(stellarPayer.publicKey(), "12"),
      { fee: "100", networkPassphrase: chain(a.network)!.passphrase! },
    )
      .addOperation(
        Operation.payment({
          destination: b.address,
          asset: a.contractAddress
            ? new Asset(a.symbol, a.contractAddress)
            : Asset.native(),
          amount: b.amount,
        }),
      )
      .setTimeout(60)
      .build();
    tx.sign(stellarPayer);
    const result = new xdr.TransactionResult({
      feeCharged: 100n,
      result: xdr.TransactionResultResult.txSuccess([
        xdr.OperationResult.opInner(
          xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess()),
        ),
      ]),
      ext: xdr.TransactionResultExt.fromXdrObject({ v: 0 }),
    });
    const receipt = {
      status: "SUCCESS",
      ledger: 101,
      txHash: Buffer.from(tx.hash()).toString("hex"),
      envelopeXdr: tx.toXDR(),
      resultXdr: result.toXDR("base64"),
    };
    assert.equal(verifyStellarTransfer(receipt, b).length, 1);
    assert.equal(
      verifyStellarTransfer(receipt, {
        ...b,
        address: stellarPayer.publicKey(),
      }).length,
      0,
    );
    assert.throws(
      () => verifyStellarTransfer(receipt, { ...b, amount: "1.0000002" }),
      /AMOUNT_MISMATCH/,
    );
  });
test("native SOL quote deadline is proven by finalized block time before claiming funds", async () => {
  const address = receiver.publicKey.toBase58(),
    b: DepositBinding = {
      attemptId: "a",
      attemptKey: "k",
      integrationId: "i",
      environment: "sandbox",
      network: "solana:devnet",
      identifier: "native:SOL",
      address,
      amount: "0.000001001",
      precision: 9,
      startBlock: 100n,
      acceptBefore: new Date(200000),
    };
  let time = 199,
    claims = 0;
  const receipt = {
    slot: 101,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [payer.publicKey.toBase58(), address],
        instructions: [
          {
            programId: "11111111111111111111111111111111",
            parsed: {
              type: "transfer",
              info: {
                source: payer.publicKey.toBase58(),
                destination: address,
                lamports: 1001,
              },
            },
          },
        ],
      },
    },
    meta: { err: null, preBalances: [10000, 0], postBalances: [8999, 1001] },
  };
  const adapter = solanaDepositExecutionAdapter(
    {
      mode: "NATIVE",
      adapter: "solana-deposit",
      environment: "sandbox",
      network: b.network,
      identifier: b.identifier,
      addresses: [address],
      publicRpc: true,
    },
    {
      credentials: { get: async () => "" },
      deposits: {
        find: async () => b,
        allocate: async () => b,
        claim: async () => {
          claims++;
        },
      },
      http: async (_base, o) => {
        const q = JSON.parse(o.body!);
        let result: unknown;
        if (q.method === "getGenesisHash")
          result = chain(b.network)!.genesisHash;
        else if (q.method === "getSlot") result = 105;
        else if (q.method === "getSignaturesForAddress") {
          assert.equal(q.params[0], address);
          result = [{ signature, slot: 101, err: null }];
        } else if (q.method === "getTransaction") result = receipt;
        else if (q.method === "getBlock")
          result = {
            blockhash: address,
            signatures: [signature],
            blockTime: time,
          };
        else throw new Error(q.method);
        return {
          status: 200,
          headers: {},
          body: JSON.stringify({ jsonrpc: "2.0", id: q.id, result }),
        };
      },
    },
  );
  assert.equal(
    (await adapter.status({ id: "a", key: "k" }))?.state,
    "Confirmed",
  );
  assert.equal(claims, 1);
  time = 200;
  await assert.rejects(
    adapter.status({ id: "a", key: "k" }),
    /QUOTE_PAYMENT_LATE/,
  );
  assert.equal(claims, 1);
});
test("Stellar indexed canonical ledger rejects missing or late quote timestamps", async () => {
  let closed_at: unknown = new Date(199000).toISOString();
  const deps = {
    credentials: { get: async () => "" },
    http: async (_base: string, o: { path: string }) => ({
      status: 200,
      headers: {},
      body: JSON.stringify(
        o.path === "/"
          ? { network_passphrase: chain("stellar:testnet")!.passphrase }
          : { sequence: 101, hash: "a".repeat(64), closed_at },
      ),
    }),
  };
  const rpc = async () => {
    throw new (await import("../lib/portal/domain")).PortalError(
      "RPC_UNAVAILABLE_HTTP_503",
      503,
    );
  };
  assert.equal(
    await canonicalStellarLedger(
      rpc,
      deps,
      "stellar:testnet",
      101,
      new Date(200000),
    ),
    "a".repeat(64),
  );
  closed_at = new Date(200000).toISOString();
  await assert.rejects(
    canonicalStellarLedger(rpc, deps, "stellar:testnet", 101, new Date(200000)),
    /QUOTE_PAYMENT_LATE/,
  );
  closed_at = undefined;
  await assert.rejects(
    canonicalStellarLedger(rpc, deps, "stellar:testnet", 101, new Date(200000)),
    /QUOTE_PAYMENT_LATE/,
  );
});
