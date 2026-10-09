import "dotenv/config";
import { randomUUID, createECDH } from "node:crypto";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { Keypair as SolanaKeypair } from "@solana/web3.js";
import {
  Keypair,
  Asset,
  Operation,
  Account,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { readFile, writeFile } from "node:fs/promises";
import { supportedChains } from "../lib/blockchain/chains";
import { tokenAssets } from "../lib/blockchain/assets";
import { alchemyReader } from "../lib/blockchain/alchemy-rpc";
import {
  stellarAccount,
  ensureStellarReceivable,
  checkStellarNetwork,
} from "../lib/providers/adapters/native/stellar-deposit";
import { providerRequest } from "../lib/providers/adapters/http";
import { localMode, secretManager } from "../lib/portal/adapters";
import { db } from "../lib/portal/db";
import { json } from "../lib/portal/service";
import { createIntent, createSession } from "../lib/payments/service";
import { verifyTestnetPayment } from "./verify-testnet-payment";
const file = ".local/portal/multichain-testnet.json";
async function main() {
  if (
    !localMode() ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")
  )
    throw new Error("Isolated local sandbox only");
  const org = await db.organization.findUniqueOrThrow({
    where: { id: "payment-demo-merchant" },
  });
  if (!org.fictional) throw new Error("Fictional merchant required");
  let fixture: {
    evmAddress: string;
    evmRecoveryRef: string;
    solanaAddress: string;
    solanaRecoveryRef: string;
    stellarAddress: string;
    stellarRecoveryRef: string;
    stellarSetupHash?: string;
    sessionId?: string;
    checkout?: string;
    intentId?: string;
  };
  try {
    fixture = JSON.parse(await readFile(file, "utf8"));
  } catch {
    const evm = createECDH("secp256k1");
    evm.generateKeys();
    const solana = SolanaKeypair.generate(),
      stellar = Keypair.random();
    fixture = {
      evmAddress:
        "0x" +
        Buffer.from(
          keccak_256(evm.getPublicKey(undefined, "uncompressed").subarray(1)),
        )
          .subarray(12)
          .toString("hex"),
      evmRecoveryRef: await secretManager.put(
        evm.getPrivateKey().toString("hex"),
      ),
      solanaAddress: solana.publicKey.toBase58(),
      solanaRecoveryRef: await secretManager.put(
        JSON.stringify([...solana.secretKey]),
      ),
      stellarAddress: stellar.publicKey(),
      stellarRecoveryRef: await secretManager.put(stellar.secret()),
    };
    await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  if (process.argv.includes("--observe") || process.argv.includes("--verify")) {
    if (!fixture.intentId) throw new Error("Prepare the checkout first");
    await verifyTestnetPayment(
      fixture.intentId,
      process.argv.includes("--verify"),
    );
    return;
  }
  if (process.argv.includes("--new") && fixture.sessionId) {
    const previous = await db.checkoutSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
    });
    if (previous.expiresAt > new Date())
      throw new Error(
        "Existing checkout is still payable; inspect it rather than creating another payment",
      );
    if (!/^[a-zA-Z0-9-]+$/.test(fixture.sessionId))
      throw new Error("Invalid fixture identity");
    await writeFile(
      `.local/portal/multichain-testnet-${fixture.sessionId}.json`,
      JSON.stringify(fixture, null, 2),
      { mode: 0o600 },
    );
    const evm = createECDH("secp256k1");
    evm.generateKeys();
    const solana = SolanaKeypair.generate();
    // The Stellar receiver was never bound by the expired Solana checkout.
    // Reuse it only if no checkout has consumed this network/address pair.
    if (
      await db.depositBinding.count({
        where: { network: "stellar:testnet", address: fixture.stellarAddress },
      })
    )
      throw new Error(
        "Prepare a fresh funded Stellar test receiver before another fixture",
      );
    fixture = {
      evmAddress:
        "0x" +
        Buffer.from(
          keccak_256(evm.getPublicKey(undefined, "uncompressed").subarray(1)),
        )
          .subarray(12)
          .toString("hex"),
      evmRecoveryRef: await secretManager.put(
        evm.getPrivateKey().toString("hex"),
      ),
      solanaAddress: solana.publicKey.toBase58(),
      solanaRecoveryRef: await secretManager.put(
        JSON.stringify([...solana.secretKey]),
      ),
      stellarAddress: fixture.stellarAddress,
      stellarRecoveryRef: fixture.stellarRecoveryRef,
      stellarSetupHash: fixture.stellarSetupHash,
    };
    await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  }
  if (fixture.sessionId) {
    console.log("Existing test checkout: " + fixture.checkout);
    return;
  }
  const rpc = alchemyReader(
    { network: "stellar:testnet", publicRpc: true },
    { http: providerRequest, credentials: secretManager },
  );
  await checkStellarNetwork(rpc, "stellar:testnet");
  try {
    await stellarAccount(rpc, fixture.stellarAddress);
  } catch {
    const funded = await providerRequest("https://friendbot.stellar.org", {
      method: "GET",
      path: "/?addr=" + fixture.stellarAddress,
      timeoutMs: 15000,
      maxResponseBytes: 65536,
    });
    if (funded.status !== 200)
      throw new Error("Testnet account faucet unavailable");
  }
  const stellarTokens = tokenAssets.filter(
    (a) => a.network === "stellar:testnet",
  );
  if (!fixture.stellarSetupHash) {
    let ready = true;
    for (const t of stellarTokens) {
      try {
        await ensureStellarReceivable(
          rpc,
          fixture.stellarAddress,
          t.contractAddress,
          "0",
          t.symbol,
        );
      } catch {
        ready = false;
      }
    }
    if (!ready) {
      const account = await stellarAccount(rpc, fixture.stellarAddress),
        payer = Keypair.fromSecret(
          await secretManager.get(fixture.stellarRecoveryRef),
        );
      const tx = new TransactionBuilder(
        new Account(fixture.stellarAddress, account.seqNum.toString()),
        {
          fee: "100",
          networkPassphrase: supportedChains.find(
            (c) => c.id === "stellar:testnet",
          )!.passphrase!,
        },
      );
      for (const t of stellarTokens)
        tx.addOperation(
          Operation.changeTrust({
            asset: new Asset(t.symbol, t.contractAddress),
            limit: "1000",
          }),
        );
      const signed = tx.setTimeout(60).build();
      signed.sign(payer);
      fixture.stellarSetupHash = Buffer.from(signed.hash()).toString("hex");
      await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
      // Agent-owned testnet account only; this operation creates trustlines, never sends customer funds.
      const sent = (await rpc("sendTransaction", {
        transaction: signed.toXDR(),
      })) as { status: string; hash: string };
      if (
        !["PENDING", "DUPLICATE"].includes(sent.status) ||
        sent.hash !== fixture.stellarSetupHash
      )
        throw new Error(
          "Trustline setup uncertain: inspect the saved public hash",
        );
    }
  }
  if (fixture.stellarSetupHash) {
    let closed = false;
    for (let n = 0; n < 12; n++) {
      const result = (await rpc("getTransaction", {
        hash: fixture.stellarSetupHash,
      })) as { status: string };
      if (result.status === "SUCCESS") {
        closed = true;
        break;
      }
      if (result.status === "FAILED")
        throw new Error("Stellar testnet trustline setup failed");
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!closed)
      throw new Error("Stellar setup pending: rerun to observe, never resign");
  }
  for (const t of stellarTokens)
    await ensureStellarReceivable(
      rpc,
      fixture.stellarAddress,
      t.contractAddress,
      "1",
      t.symbol,
    );
  const testTokens = tokenAssets.filter(
      (t) => supportedChains.find((c) => c.id === t.network)?.testnet,
    ),
    quoted = [];
  for (const t of testTokens) {
    const family = supportedChains.find((c) => c.id === t.network)!.family,
      address =
        family === "evm"
          ? fixture.evmAddress
          : family === "solana"
            ? fixture.solanaAddress
            : fixture.stellarAddress;
    const old = await db.integration.findFirst({
      where: { orgId: org.id, environment: "sandbox" },
      orderBy: { version: "desc" },
    });
    await db.integration.create({
      data: {
        orgId: org.id,
        environment: "sandbox",
        version: (old?.version ?? 0) + 1,
        config: json({
          mode: "NATIVE",
          adapter: family === "evm" ? "erc20-deposit" : family + "-deposit",
          environment: "sandbox",
          network: t.network,
          identifier: t.identifier,
          addresses: [address],
          publicRpc: true,
          accountId: `multichain-test-${t.network}-${t.symbol}`,
        }),
      },
    });
    const asset = {
      kind: "blockchain",
      network: t.network,
      identifier: t.identifier,
    };
    quoted.push({
      asset,
      settlement: asset,
      amount: "1." + "0".repeat(t.decimals),
      precision: t.decimals,
    });
  }
  const [primary, ...paymentOptions] = quoted;
  const intent = await createIntent(org.id, randomUUID(), {
    ...primary,
    paymentOptions,
    reference: "Multichain test checkout — test tokens only",
    methods: ["stablecoin"],
    returnUrl: "http://127.0.0.1:3000/merchant",
    scenario: "success",
  });
  const session = await createSession(org.id, intent.id);
  fixture.intentId = intent.id;
  fixture.sessionId = session.sessionId;
  fixture.checkout = "http://127.0.0.1:3000" + session.checkoutPath;
  await writeFile(file, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  console.log(
    JSON.stringify({
      checkout: fixture.checkout,
      options: quoted.length,
      stellarSetupHash: fixture.stellarSetupHash,
      testnetOnly: true,
    }),
  );
}
main()
  .catch((e) => {
    console.error("Multichain test setup:", e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
