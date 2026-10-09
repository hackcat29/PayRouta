import "dotenv/config";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import bs58 from "bs58";
import { Keypair as SolKeypair } from "@solana/web3.js";
import { Keypair } from "@stellar/stellar-sdk";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { chain } from "../../lib/blockchain/chains";
import { cryptoAsset } from "../../lib/blockchain/crypto-assets";
import { tokenMinor } from "../../lib/blockchain/assets";
import { depositAdapterKind } from "../../lib/blockchain/deposit-config";
import { createCryptoCheckout } from "../../lib/payments/crypto-checkout";
import {
  methods,
  selectMethod,
  confirm,
  progress,
} from "../../lib/payments/service";
import {
  applyFact,
  dispatch,
  settle,
  reconcile,
} from "../../lib/payments/processing";
import { nativeModules } from "../../lib/providers/adapters/native/registry";
import { solanaDepositExecutionAdapter } from "../../lib/providers/adapters/native/solana-deposit";
import { stellarDepositExecutionAdapter } from "../../lib/providers/adapters/native/stellar-deposit";
import { stellarAccountData, stellarPaymentReceipt } from "../fixtures/crypto";
let orgId: string;
const selected = [
  cryptoAsset("solana:devnet", "native:SOL")!,
  cryptoAsset("stellar:testnet", "native:XLM")!,
];
before(async () => {
  if (
    process.env.PORTAL_MODE !== "local" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")
  )
    throw new Error("Isolated local database required");
  orgId = "crypto-families-" + randomUUID();
  await db.organization.create({
    data: {
      id: orgId,
      name: "Fictional native crypto family tests",
      fictional: true,
    },
  });
  await db.merchantConfig.create({
    data: { orgId, returnOrigin: "http://127.0.0.1:3000" },
  });
  for (const [index, a] of selected.entries())
    await db.integration.create({
      data: {
        orgId,
        environment: "sandbox",
        version: index + 1,
        config: json({
          mode: "NATIVE",
          adapter: depositAdapterKind(a.network, a.identifier),
          environment: "sandbox",
          network: a.network,
          identifier: a.identifier,
          addresses: [
            a.symbol === "SOL"
              ? SolKeypair.generate().publicKey.toBase58()
              : Keypair.random().publicKey(),
          ],
          publicRpc: true,
          accountId: "fictional-native-family-" + randomUUID(),
        }),
      },
    });
});
after(() => db.$disconnect());
for (const asset of selected)
  test(`${asset.symbol}: priced checkout, native transfer claim, settlement and reconciliation are exact and idempotent`, async () => {
    const checkout = await createCryptoCheckout(
      orgId,
      "sandbox",
      randomUUID(),
      {
        reference: "Fictional native " + asset.symbol,
        payerCountry: "US",
        usdAmount: "0.10",
        options: [{ network: asset.network, identifier: asset.identifier }],
      },
      async () => ({
        [asset.coinGeckoId]: {
          usd: asset.symbol === "SOL" ? "100" : "0.25",
          source: "CoinGecko",
          updatedAt: new Date().toISOString(),
        },
      }),
    );
    const token = checkout.checkoutPath.split("#")[1];
    await methods(checkout.id, token);
    const route = await selectMethod(checkout.id, token, "crypto-app"),
      created = await confirm(checkout.id, token, route.routeId);
    const attempt = await db.paymentAttempt.findUniqueOrThrow({
        where: { id: created.attemptId },
        include: { intent: true },
      }),
      integration = await db.integration.findUniqueOrThrow({
        where: { id: attempt.integrationId },
      });
    const adapterModule = nativeModules.find(
        (m) => m.id === depositAdapterKind(asset.network, asset.identifier),
      )!,
      original = adapterModule.create;
    const payer = Keypair.random(),
      solPayer = SolKeypair.generate(),
      signature = bs58.encode(randomBytes(64));
    let paid = false;
    try {
      adapterModule.create = (config, deps) => {
        const nativeDeps = {
          ...deps,
          http: async (
            _base: string,
            options: Parameters<typeof deps.http>[1],
          ) => {
            const binding = await db.depositBinding.findUnique({
                where: { attemptId: attempt.id },
              }),
              amount = attempt.intent.amount,
              close = Math.floor(
                (attempt.intent.expiresAt.getTime() - 1000) / 1000,
              );
            if (options.method === "GET")
              return {
                status: 200,
                headers: {},
                body: JSON.stringify(
                  options.path === "/"
                    ? { network_passphrase: chain(asset.network)!.passphrase }
                    : {
                        sequence: 101,
                        hash: "a".repeat(64),
                        closed_at: new Date(close * 1000).toISOString(),
                      },
                ),
              };
            const request = JSON.parse(options.body!);
            let result: unknown;
            if (request.method === "getGenesisHash")
              result = chain(asset.network)!.genesisHash;
            else if (request.method === "getSlot") result = paid ? 101 : 100;
            else if (request.method === "getSignaturesForAddress") {
              assert.equal(request.params[0], binding!.address);
              result = paid ? [{ signature, slot: 101, err: null }] : [];
            } else if (
              request.method === "getTransaction" &&
              asset.symbol === "SOL"
            ) {
              const units = Number(tokenMinor(amount, 9));
              result = {
                slot: 101,
                meta: {
                  err: null,
                  preBalances: [units + 10000, 0],
                  postBalances: [10000, units],
                },
                transaction: {
                  signatures: [signature],
                  message: {
                    accountKeys: [
                      solPayer.publicKey.toBase58(),
                      binding!.address,
                    ],
                    instructions: [
                      {
                        programId: "11111111111111111111111111111111",
                        parsed: {
                          type: "transfer",
                          info: {
                            source: solPayer.publicKey.toBase58(),
                            destination: binding!.address,
                            lamports: units,
                          },
                        },
                      },
                    ],
                  },
                },
              };
            } else if (request.method === "getBlock")
              result = {
                blockhash: solPayer.publicKey.toBase58(),
                blockTime: close,
                signatures: [signature],
              };
            else if (request.method === "getNetwork")
              result = { passphrase: chain(asset.network)!.passphrase };
            else if (request.method === "getHealth")
              result = { status: "healthy", latestLedger: paid ? 101 : 100 };
            else if (request.method === "getLedgerEntries")
              result = {
                entries: [
                  {
                    key: request.params.keys[0],
                    xdr: stellarAccountData(binding!.address),
                  },
                ],
              };
            else if (request.method === "getTransactions")
              result = {
                oldestLedger: 90,
                transactions: paid
                  ? [
                      stellarPaymentReceipt(
                        asset.network,
                        payer,
                        binding!.address,
                        amount,
                      ),
                    ]
                  : [],
              };
            else if (request.method === "getTransaction")
              result = stellarPaymentReceipt(
                asset.network,
                payer,
                binding!.address,
                amount,
              );
            else if (request.method === "getLedgers")
              return { status: 503, headers: {}, body: "{}" };
            else throw new Error(request.method);
            return {
              status: 200,
              headers: {},
              body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
            };
          },
        };
        return asset.symbol === "SOL"
          ? solanaDepositExecutionAdapter(config, nativeDeps)
          : stellarDepositExecutionAdapter(config, nativeDeps);
      };
      const { resolveExecutionAdapter } =
        await import("../../lib/payments/execution");
      const adapter = resolveExecutionAdapter(integration);
      await dispatch(attempt.id);
      const instructions = await progress(checkout.id, token);
      assert.equal(instructions.attemptState, "Requires action");
      const action = instructions.action as {
        kind: string;
        address: string;
        symbol: string;
        network: string;
        identifier: string;
        amount: string;
        code: string;
      };
      assert.equal(action.kind, "deposit");
      assert.equal(action.symbol, asset.symbol);
      assert.equal(action.network, asset.network);
      assert.equal(action.identifier, asset.identifier);
      assert.equal(action.amount, attempt.intent.amount);
      assert.ok(action.address);
      assert.doesNotMatch(action.code, /spl-token|asset_issuer/);
      paid = true;
      const fact = await adapter.status(attempt, attempt.intent);
      assert.equal(fact?.state, "Confirmed");
      const afterExpiry = new Date(attempt.intent.expiresAt.getTime() + 60000);
      await applyFact(attempt.id, fact!, afterExpiry);
      await applyFact(attempt.id, fact!, afterExpiry);
      await settle(attempt.id, afterExpiry);
      await settle(attempt.id, afterExpiry);
      await reconcile(attempt.id, afterExpiry);
      assert.equal(
        await db.depositClaim.count({ where: { attemptId: attempt.id } }),
        1,
      );
      assert.equal(
        await db.paymentException.count({
          where: { intentId: attempt.intentId, code: "LATE_PAYMENT" },
        }),
        0,
      );
      const settled = await progress(checkout.id, token);
      assert.equal(settled.state, "Confirmed");
      assert.deepEqual(settled.settlement, ["Completed"]);
      assert.equal(
        (
          await db.paymentFee.findUniqueOrThrow({
            where: { intentId: attempt.intentId },
          })
        ).amountMinor.toString(),
        "0",
      );
    } finally {
      adapterModule.create = original;
    }
  });
