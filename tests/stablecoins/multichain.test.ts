import "dotenv/config";
import { stablecoinOverview } from "../../lib/merchant/stablecoins";
import bs58 from "bs58";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { Keypair as SolanaKeypair } from "@solana/web3.js";
import { Keypair } from "@stellar/stellar-sdk";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { tokenAssets } from "../../lib/blockchain/assets";
import { stablecoinCheckoutTerms } from "../../lib/merchant/stablecoin-checkout";
import { merchantConfiguration } from "../../lib/merchant/configuration";
import { responseContract } from "../../lib/merchant/contracts";
import { session as merchantSession } from "../../lib/merchant/service";
import { tokenMinor } from "../../lib/blockchain/assets";
import { chain } from "../../lib/blockchain/chains";
import { databaseDepositStore } from "../../lib/blockchain/deposit-store";
import {
  createIntent,
  createSession,
  progress,
  choosePaymentOption,
  methods,
  selectMethod,
  confirm,
} from "../../lib/payments/service";
import { recordSettlement, applyFact } from "../../lib/payments/processing";
let orgId: string;
const networks = [
  "eip155:84532",
  "eip155:5042002",
  "solana:devnet",
  "stellar:testnet",
];
const pools = new Map<string, { id: string; addresses: string[] }>();
const token = (network: string, s = "USDC") =>
  tokenAssets.find((t) => t.network === network && t.symbol === s)!;
const asset = (n: string, s = "USDC") => ({
  kind: "blockchain",
  identifier: token(n, s).identifier,
  network: n,
});
const option = (n: string, s = "USDC") => ({
  amount: chain(n)!.family === "stellar" ? "1.0000001" : "1.000001",
  precision: token(n, s).decimals,
  asset: asset(n, s),
  settlement: asset(n, s),
});
const input = () => ({
  ...option(networks[0]),
  reference: "Fictional multichain invoice",
  methods: ["stablecoin"],
  returnUrl: "http://127.0.0.1:3000/",
  paymentOptions: [
    ...networks.slice(1).map((n) => option(n)),
    option(networks[0], "EURC"),
  ],
});
before(async () => {
  if (
    process.env.PORTAL_MODE !== "local" ||
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta")
  )
    throw new Error("Isolated local database required");
  orgId = `multichain-test-${randomUUID()}`;
  await db.organization.create({
    data: {
      id: orgId,
      name: "Fictional multichain regression",
      fictional: true,
    },
  });
  await db.merchantConfig.create({
    data: { orgId, returnOrigin: "http://127.0.0.1:3000" },
  });
  for (const [index, n] of [...networks, networks[0]].entries()) {
    const symbol = index === 4 ? "EURC" : "USDC",
      family = chain(n)!.family,
      addresses = Array.from({ length: 6 }, () =>
        family === "evm"
          ? "0x" + randomBytes(20).toString("hex")
          : family === "solana"
            ? SolanaKeypair.generate().publicKey.toBase58()
            : Keypair.random().publicKey(),
      );
    const integration = await db.integration.create({
      data: {
        orgId,
        environment: "sandbox",
        version: index + 1,
        config: json({
          mode: "NATIVE",
          adapter: family === "evm" ? "erc20-deposit" : family + "-deposit",
          environment: "sandbox",
          network: n,
          identifier: token(n, symbol).identifier,
          addresses,
          rpcKeyRef: "fictional-local-ref",
          accountId: `pool-${index}`,
        }),
      },
    });
    pools.set(n + "|" + symbol, { id: integration.id, addresses });
  }
});
after(() => db.$disconnect());
test("customer picks only merchant-quoted token/network, preserving exact amount, fee and trusted context", async () => {
  const intent = await createIntent(orgId, randomUUID(), input()),
    session = await createSession(orgId, intent.id),
    initial = await progress(session.sessionId, session.token);
  assert.equal(initial.paymentOptions.length, 5);
  assert.ok(initial.paymentOptions.every((o) => o.available));
  assert.equal(initial.chainLocked, false);
  await assert.rejects(
    choosePaymentOption(
      session.sessionId,
      session.token,
      "foreign-unquoted-option",
    ),
    /NOT_OFFERED/,
  );
  const chosen = initial.paymentOptions.find(
    (o) => o.network === "stellar:testnet",
  )!;
  await choosePaymentOption(session.sessionId, session.token, chosen.id);
  const selected = await db.paymentIntent.findUniqueOrThrow({
    where: { id: intent.id },
  });
  assert.equal(selected.precision, 7);
  assert.equal(selected.amount, "1.0000001");
  assert.deepEqual(selected.asset, asset("stellar:testnet"));
  assert.notEqual(selected.contextId, intent.contextId);
  assert.equal(selected.routeId, null);
  assert.equal(selected.evaluationId, null);
  const context = await db.availabilityContext.findUniqueOrThrow({
    where: { id: selected.contextId },
  });
  assert.equal((context.context as { amount: string }).amount, "1.0000001");
  assert.deepEqual(
    selected.feeSnapshot,
    (selected.paymentOptions as { id: string; feeSnapshot: unknown }[]).find(
      (o) => o.id === chosen.id,
    )!.feeSnapshot,
  );
  await methods(session.sessionId, session.token);
  const route = await selectMethod(
    session.sessionId,
    session.token,
    "stablecoin",
  );
  await confirm(session.sessionId, session.token, route.routeId);
  await assert.rejects(
    choosePaymentOption(
      session.sessionId,
      session.token,
      initial.selectedOption!,
    ),
    /CHAIN_LOCKED/,
  );
  assert.equal(
    (await progress(session.sessionId, session.token)).chainLocked,
    true,
  );
});
test("chain selection invalidates old route and concurrent confirmations never bind two networks", async () => {
  const intent = await createIntent(orgId, randomUUID(), input()),
    s = await createSession(orgId, intent.id);
  await methods(s.sessionId, s.token);
  const old = await selectMethod(s.sessionId, s.token, "stablecoin");
  const arc = (await progress(s.sessionId, s.token)).paymentOptions.find(
    (o) => o.network === "eip155:5042002",
  )!;
  await choosePaymentOption(s.sessionId, s.token, arc.id);
  await assert.rejects(confirm(s.sessionId, s.token, old.routeId));
  assert.equal(
    await db.paymentAttempt.count({ where: { intentId: intent.id } }),
    0,
  );
  await methods(s.sessionId, s.token);
  const route = await selectMethod(s.sessionId, s.token, "stablecoin");
  const attempts = await Promise.all([
    confirm(s.sessionId, s.token, route.routeId),
    confirm(s.sessionId, s.token, route.routeId),
  ]);
  assert.equal(attempts[0].attemptId, attempts[1].attemptId);
  assert.equal(
    await db.paymentAttempt.count({ where: { intentId: intent.id } }),
    1,
  );
});
for (const n of ["solana:devnet", "stellar:testnet"])
  test(`${n}: immutable receive scope and durable claim required before confirmation`, async () => {
    const intent = await createIntent(orgId, randomUUID(), input()),
      s = await createSession(orgId, intent.id),
      o = (await progress(s.sessionId, s.token)).paymentOptions.find(
        (o) => o.network === n,
      )!;
    await choosePaymentOption(s.sessionId, s.token, o.id);
    await methods(s.sessionId, s.token);
    const r = await selectMethod(s.sessionId, s.token, "stablecoin"),
      result = await confirm(s.sessionId, s.token, r.routeId),
      a = await db.paymentAttempt.findUniqueOrThrow({
        where: { id: result.attemptId },
      }),
      pool = pools.get(n + "|USDC")!,
      store = databaseDepositStore(pool.id),
      value = option(n);
    const b = await store.allocate({
      attemptId: a.id,
      attemptKey: a.key,
      environment: "sandbox",
      network: n,
      identifier: value.asset.identifier,
      amount: value.amount,
      precision: value.precision,
      startBlock: 100n,
      addresses: pool.addresses,
    });
    await assert.rejects(
      applyFact(a.id, {
        state: "Confirmed",
        reference: "fictional-proof",
        amount: b.amount,
        asset: value.asset,
      }),
      /DEPOSIT_FINALIZED_EVIDENCE/,
    );
    assert.equal(
      await db.settlementAllocation.count({ where: { intentId: intent.id } }),
      0,
    );
    await store.advanceCheckpoint!(b, 100n, "cursor-one", {
      nextBlock: 100n,
      cursor: null,
    });
    await store.advanceCheckpoint!(b, 100n, "cursor-stale", {
      nextBlock: 100n,
      cursor: null,
    });
    assert.equal((await store.checkpoint!(b)).cursor, "cursor-one");
    await store.advanceCheckpoint!(b, 200n, null, {
      nextBlock: 100n,
      cursor: "cursor-one",
    });
    await store.advanceCheckpoint!(b, 100n, "cursor-old", {
      nextBlock: 100n,
      cursor: "cursor-one",
    });
    assert.deepEqual(await store.checkpoint!(b), {
      nextBlock: 200n,
      cursor: null,
    });
    await assert.rejects(
      databaseDepositStore("foreign").claim(b, {
        txHash: "fictional",
        logIndex: "0",
        blockHash: "fictional",
        amount: b.amount,
      }),
      /MISMATCH/,
    );
    await store.claim(b, {
      txHash:
        n === "solana:devnet"
          ? bs58.encode(randomBytes(64))
          : randomBytes(32).toString("hex"),
      logIndex: "0",
      blockHash: "fictional-canonical-hash",
      amount: b.amount,
    });
    await applyFact(a.id, {
      state: "Confirmed",
      reference: "fictional-proof",
      amount: b.amount,
      asset: value.asset,
    });
    assert.equal(
      (await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id } }))
        .state,
      "Confirmed",
    );
    assert.equal(
      await db.paymentFee.count({ where: { intentId: intent.id } }),
      1,
    );
    const paid = await db.paymentFee.findUniqueOrThrow({
      where: { intentId: intent.id },
    });
    assert.equal(paid.billable, false);
    assert.equal(paid.amountMinor.toString(), "0");
    await assert.rejects(
      db.depositBinding.update({
        where: { attemptId: a.id },
        data: { amount: "2" },
      }),
      /immutable/,
    );
  });
test("unsupported or wrong-environment alternatives, fake tokens and implicit cross-asset settlement are rejected", async () => {
  const base = input();
  for (const bad of [
    { ...option("eip155:1") },
    { ...option("solana:devnet"), precision: 7 },
    {
      ...option(networks[0]),
      asset: { ...asset(networks[0]), identifier: "erc20:0x" + "a".repeat(40) },
    },
    { ...option("stellar:testnet"), settlement: asset(networks[0]) },
  ])
    await assert.rejects(
      createIntent(orgId, randomUUID(), { ...base, paymentOptions: [bad] }),
    );
  await assert.rejects(
    createIntent(orgId, randomUUID(), {
      ...base,
      paymentOptions: [option(networks[0])],
    }),
    /DUPLICATE_PAYMENT_OPTION/,
  );
});

test("native checkout remains eligible independently of unrelated provider TTL and refreshes an expired quote", async () => {
  const intent = await createIntent(orgId, randomUUID(), input()),
    s = await createSession(orgId, intent.id);
  const selected = (await progress(s.sessionId, s.token)).paymentOptions.find(
    (o) => o.network === "solana:devnet",
  )!;
  await choosePaymentOption(s.sessionId, s.token, selected.id);
  const now = new Date();
  await methods(s.sessionId, s.token, now);
  const current = await db.paymentIntent.findUniqueOrThrow({
    where: { id: intent.id },
  });
  const evaluation = await db.availabilityEvaluation.findUniqueOrThrow({
    where: { id: current.evaluationId! },
  });
  assert.equal(evaluation.expiresAt.getTime(), now.getTime() + 60000);
  const later = new Date(now.getTime() + 61000);
  await assert.rejects(
    selectMethod(s.sessionId, s.token, "stablecoin", later),
    /EVALUATION_EXPIRED/,
  );
  await methods(s.sessionId, s.token, later);
  const route = await selectMethod(s.sessionId, s.token, "stablecoin", later);
  assert.ok(
    (await confirm(s.sessionId, s.token, route.routeId, later)).attemptId,
  );
});

for (const [tokenIndex, t] of tokenAssets
  .filter((t) => chain(t.network)!.testnet)
  .entries())
  test(`${t.symbol} ${t.network}: invoice to immutable claim, full settlement, fee and balanced journal postings`, async () => {
    const family = chain(t.network)!.family;
    const address =
      family === "evm"
        ? "0x" + randomBytes(20).toString("hex")
        : family === "solana"
          ? SolanaKeypair.generate().publicKey.toBase58()
          : Keypair.random().publicKey();
    const integration = await db.integration.create({
      data: {
        orgId,
        environment: "sandbox",
        version: 100 + tokenIndex,
        config: json({
          mode: "NATIVE",
          adapter: family === "evm" ? "erc20-deposit" : family + "-deposit",
          environment: "sandbox",
          network: t.network,
          identifier: t.identifier,
          addresses: [address],
          publicRpc: true,
          accountId: "fictional-token-pool-" + randomUUID(),
        }),
      },
    });
    const raw = {
      key: randomUUID(),
      environment: "sandbox",
      payerCountry: "NG",
      reference: "Fictional per-token financial regression",
      options: [
        {
          network: t.network,
          identifier: t.identifier,
          amount: "1." + "0".repeat(t.decimals - 1) + "1",
        },
      ],
    };
    const terms = stablecoinCheckoutTerms(raw, "http://127.0.0.1:3000");
    const intent = await createIntent(orgId, raw.key, terms);
    const sessions = await Promise.all([
      merchantSession({ orgId, environment: "sandbox" }, intent.id, raw.key),
      merchantSession({ orgId, environment: "sandbox" }, intent.id, raw.key),
    ]);
    assert.equal(sessions[0].checkoutPath, sessions[1].checkoutPath);
    const session = sessions[0],
      token = session.checkoutPath.split("#")[1];
    await methods(session.id, token);
    const route = await selectMethod(session.id, token, "stablecoin"),
      result = await confirm(session.id, token, route.routeId);
    // Use the integration selected by routing when another valid pool for this asset exists.
    const attempt = await db.paymentAttempt.findUniqueOrThrow({
      where: { id: result.attemptId },
    });
    const picked = await db.integration.findUniqueOrThrow({
      where: { id: attempt.integrationId },
    });
    const addresses = (picked.config as { addresses: string[] }).addresses;
    const store = databaseDepositStore(picked.id);
    const binding = await store.allocate({
      attemptId: attempt.id,
      attemptKey: attempt.key,
      environment: "sandbox",
      network: t.network,
      identifier: t.identifier,
      amount: terms.amount,
      precision: t.decimals,
      startBlock: 100n,
      addresses,
    });
    await assert.rejects(
      applyFact(attempt.id, {
        state: "Confirmed",
        reference: "fictional-unverified",
        amount: terms.amount,
        asset: terms.asset,
      }),
      /FINALIZED_EVIDENCE/,
    );
    const txHash =
      family === "evm"
        ? "0x" + randomBytes(32).toString("hex")
        : family === "solana"
          ? bs58.encode(randomBytes(64))
          : randomBytes(32).toString("hex");
    await store.claim(binding, {
      txHash,
      logIndex: "0",
      blockHash: "fictional-regression-header",
      amount: terms.amount,
    });
    const fact = {
      state: "Confirmed" as const,
      reference: txHash,
      amount: terms.amount,
      asset: terms.asset,
    };
    await applyFact(attempt.id, fact);
    await applyFact(attempt.id, fact);
    const gross = tokenMinor(terms.amount, t.decimals).toString();
    const evidence = {
      integrationId: picked.id,
      environment: "sandbox",
      reference: "fictional-verified-" + txHash,
      asset: terms.asset,
      gross,
      fee: "0",
      net: gross,
      evidence: "fictional-regression-transport: no real blockchain payment",
      allocations: [{ intentId: intent.id, amount: gross, fee: "0" }],
    };
    await recordSettlement(evidence);
    await recordSettlement(evidence);
    const allocation = await db.settlementAllocation.findMany({
      where: { intentId: intent.id },
      include: { settlement: true },
    });
    assert.equal(allocation.length, 1);
    assert.equal(allocation[0].settlement.state, "Completed");
    assert.equal(allocation[0].settlement.net, gross);
    assert.equal(allocation[0].settlement.fee, "0");
    const fee = await db.paymentFee.findUniqueOrThrow({
      where: { intentId: intent.id },
    });
    assert.equal(fee.billable, false);
    assert.equal(fee.amountMinor.toString(), "0");
    const journals = await db.journalEntry.findMany({
      where: {
        orgId,
        OR: [
          { source: `payment:${intent.id}` },
          { source: { contains: ":" + intent.id } },
        ],
      },
      include: { postings: true },
    });
    assert.equal(journals.length, 3);
    for (const journal of journals)
      assert.equal(
        journal.postings.reduce(
          (sum, p) =>
            sum + BigInt(p.debit.toString()) - BigInt(p.credit.toString()),
          0n,
        ),
        0n,
      );
    assert.equal(
      await db.depositClaim.count({ where: { attemptId: attempt.id } }),
      1,
    );
    assert.equal(
      await db.checkoutSession.count({ where: { intentId: intent.id } }),
      1,
    );
    assert.ok(integration.id);
  });
test("per-token merchant configuration validates publicly and follows processing pause", async () => {
  let configuration = await merchantConfiguration(orgId, "sandbox");
  responseContract("GET configuration").parse(configuration);
  assert.equal(configuration.stablecoinAssets.length, 14);
  assert.equal(
    configuration.stablecoinAssets.some((a) => a.symbol === "USDT"),
    false,
  );
  assert.ok(
    configuration.stablecoinAssets.some(
      (a) => a.symbol === "EURC" && a.configured,
    ),
  );
  await db.merchantConfig.update({
    where: { orgId },
    data: { riskPolicy: { paused: true } },
  });
  configuration = await merchantConfiguration(orgId, "sandbox");
  assert.ok(configuration.stablecoinAssets.every((a) => !a.executionEnabled));
  assert.ok(
    configuration.stablecoinAssets.every(
      (a) => a.reason === "PROCESSING_PAUSED",
    ),
  );
  assert.equal(configuration.liveExecutionEnabled, false);
});

test("receive pool overview consolidates overlapping integrations without double-counting addresses", async () => {
  const n = networks[0],
    original = pools.get(n + "|USDC")!;
  const before = (await stablecoinOverview(orgId, "sandbox")).find(
    (p) => p.network === n && p.symbol === "USDC",
  )!;
  await db.integration.create({
    data: {
      orgId,
      environment: "sandbox",
      version: 999,
      config: json({
        mode: "NATIVE",
        adapter: "erc20-deposit",
        environment: "sandbox",
        network: n,
        identifier: token(n).identifier,
        addresses: original.addresses,
        publicRpc: true,
        accountId: "fictional-overlapping-pool",
      }),
    },
  });
  const after = await stablecoinOverview(orgId, "sandbox");
  assert.equal(
    after.filter((p) => p.network === n && p.symbol === "USDC").length,
    1,
  );
  assert.equal(
    after.find((p) => p.network === n && p.symbol === "USDC")!.remaining,
    before.remaining,
  );
});
