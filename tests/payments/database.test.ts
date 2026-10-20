Object.assign(process.env, { NODE_ENV: "test" });
process.env.PAYMENT_TEST_LEGACY_METHODS = "enabled";
import "dotenv/config";
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { atomic } from "../../lib/portal/service";
import { paymentFixtures } from "../../scripts/payment-fixtures";
import {
  createIntent,
  createSession,
  methods,
  selectMethod,
  confirm,
  progress,
  authorizeSession,
  customerAction,
} from "../../lib/payments/service";
import {
  dispatch,
  poll,
  settle,
  reconcile,
  applyFact,
  allocate,
} from "../../lib/payments/processing";
import { reverse } from "../../lib/payments/journal";
import { persistentSimulator } from "../../lib/payments/execution";
let merchant: string;
const fiat = { kind: "fiat", identifier: "NGN", network: "" };
const input = {
  reference: "Test order",
  amount: "100.00",
  asset: fiat,
  precision: 2,
  methods: ["bank-transfer"],
  settlement: fiat,
  returnUrl: "http://127.0.0.1:3000/",
};
before(async () => {
  merchant = await paymentFixtures();
});
after(() => db.$disconnect());
async function checkout(scenario = "success") {
  const i = await createIntent(merchant, randomUUID(), { ...input, scenario });
  const s = await createSession(merchant, i.id);
  await methods(s.sessionId, s.token);
  const r = await selectMethod(s.sessionId, s.token, "bank-transfer");
  return { i, s, r };
}
test("database: trusted amount, idempotency conflicts, session scope and expiry", async () => {
  const key = randomUUID();
  const a = await createIntent(merchant, key, input);
  assert.equal((await createIntent(merchant, key, input)).id, a.id);
  await assert.rejects(
    createIntent(merchant, key, { ...input, amount: "101.00" }),
  );
  await assert.rejects(
    createIntent(merchant, randomUUID(), {
      ...input,
      returnUrl: "https://evil.example/",
    }),
  );
  const s = await createSession(merchant, a.id);
  await assert.rejects(authorizeSession(s.sessionId, "bad"));
  await assert.rejects(
    authorizeSession(s.sessionId, s.token, new Date(Date.now() + 3600000)),
  );
});
test("database: concurrent confirmation, payment, settlement, journal dedup and reversal", async () => {
  const { i, s, r } = await checkout();
  const results = await Promise.all([
    confirm(s.sessionId, s.token, r.routeId),
    confirm(s.sessionId, s.token, r.routeId),
  ]);
  assert.equal(results[0].attemptId, results[1].attemptId);
  await dispatch(results[0].attemptId);
  await poll(results[0].attemptId);
  assert.equal((await progress(s.sessionId, s.token)).state, "Confirmed");
  await settle(results[0].attemptId);
  assert.equal((await reconcile(results[0].attemptId)).result, "Exact match");
  const entries = await db.journalEntry.findMany({
    where: { source: `payment:${i.id}` },
  });
  assert.equal(entries.length, 1);
  await atomic((tx) =>
    reverse(
      tx,
      entries[0].id,
      `correction:${i.id}`,
      "Fictional correction example",
    ),
  );
  await assert.rejects(
    db.journalEntry.update({
      where: { id: entries[0].id },
      data: { purpose: "edit" },
    }),
  );
});
test("database: timeout after acceptance resolves without duplicate provider payment", async () => {
  const { i, s, r } = await checkout("timeout");
  const a = await confirm(s.sessionId, s.token, r.routeId);
  await dispatch(a.attemptId);
  assert.equal((await progress(s.sessionId, s.token)).attemptState, "Unknown");
  await assert.rejects(selectMethod(s.sessionId, s.token, "bank-transfer"));
  await poll(a.attemptId);
  assert.equal((await progress(s.sessionId, s.token)).state, "Confirmed");
  assert.equal(
    await db.simulatorPayment.count({
      where: { reference: `test-${a.attemptId}` },
    }),
    1,
  );
  assert.equal(await db.paymentAttempt.count({ where: { intentId: i.id } }), 1);
});
test("database: customer action and settlement mismatch remain distinct from payment", async () => {
  const { s, r } = await checkout("action");
  const a = await confirm(s.sessionId, s.token, r.routeId);
  await dispatch(a.attemptId);
  assert.equal(
    (await progress(s.sessionId, s.token)).attemptState,
    "Requires action",
  );
  await customerAction(s.sessionId, s.token);
  await poll(a.attemptId);
  assert.equal((await progress(s.sessionId, s.token)).state, "Confirmed");
  const other = await checkout("fee-mismatch");
  const b = await confirm(other.s.sessionId, other.s.token, other.r.routeId);
  await dispatch(b.attemptId);
  await settle(b.attemptId);
  assert.equal((await reconcile(b.attemptId)).result, "Unresolved exception");
  assert.ok(
    await db.paymentException.findFirst({
      where: { intentId: other.i.id, code: "FEE_MISMATCH" },
    }),
  );
});
test("database: crash after acceptance, late confirmation and stale quote", async () => {
  const { i, s, r } = await checkout();
  const a = await confirm(s.sessionId, s.token, r.routeId);
  const record = await db.paymentAttempt.update({
    where: { id: a.attemptId },
    data: { state: "Dispatching" },
  });
  await persistentSimulator.create(record, i);
  await dispatch(a.attemptId);
  assert.equal((await progress(s.sessionId, s.token)).state, "Confirmed");
  const late = await checkout();
  const b = await confirm(late.s.sessionId, late.s.token, late.r.routeId);
  await applyFact(
    b.attemptId,
    {
      reference: `late-${b.attemptId}`,
      state: "Confirmed",
      amount: "100.00",
      asset: fiat,
    },
    new Date(Date.now() + 3600000),
  );
  assert.ok(
    await db.paymentException.findFirst({
      where: { intentId: late.i.id, code: "LATE_PAYMENT" },
    }),
  );
  const stale = await checkout();
  await db.paymentRoute.update({
    where: { id: stale.r.routeId },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(
    confirm(stale.s.sessionId, stale.s.token, stale.r.routeId),
  );
});
test("database: allocation refuses a second full allocation", async () => {
  const { i, s, r } = await checkout();
  const a = await confirm(s.sessionId, s.token, r.routeId);
  await dispatch(a.attemptId);
  await settle(a.attemptId);
  const original = await db.settlementAllocation.findFirstOrThrow({
    where: { intentId: i.id },
    include: { settlement: true },
  });
  const other = await db.paymentSettlement.create({
    data: {
      providerOrgId: original.settlement.providerOrgId,
      integrationId: original.settlement.integrationId,
      environment: "sandbox",
      reference: randomUUID(),
      asset: fiat,
      gross: "10000",
      fee: "10",
      net: "9990",
      state: "Completed",
      evidence: "fixture",
    },
  });
  await assert.rejects(atomic((tx) => allocate(tx, other.id, i.id, "10000")));
});

test("database: safe fallback only after definite rejection, within method", async () => {
  const { i, s, r } = await checkout("fallback");
  const first = await confirm(s.sessionId, s.token, r.routeId);
  await dispatch(first.attemptId);
  const second = await db.paymentAttempt.findFirstOrThrow({
    where: { intentId: i.id, number: 2 },
  });
  await dispatch(second.id);
  assert.equal((await progress(s.sessionId, s.token)).state, "Confirmed");
  assert.notEqual(
    second.profileId,
    (
      await db.paymentAttempt.findUniqueOrThrow({
        where: { id: first.attemptId },
      })
    ).profileId,
  );
  assert.equal(
    await db.simulatorPayment.count({
      where: {
        reference: { in: [`test-${first.attemptId}`, `test-${second.id}`] },
      },
    }),
    1,
  );
});
test("database: stale and conflicting evidence cannot regress confirmation or duplicate journal", async () => {
  const { i, s, r } = await checkout();
  const a = await confirm(s.sessionId, s.token, r.routeId);
  await dispatch(a.attemptId);
  for (const state of ["Pending", "Confirmed", "Rejected"])
    await applyFact(a.attemptId, {
      reference: `test-${a.attemptId}`,
      state,
      amount: "100.00",
      asset: fiat,
    });
  assert.equal((await progress(s.sessionId, s.token)).state, "Confirmed");
  assert.equal(
    await db.journalEntry.count({ where: { source: `payment:${i.id}` } }),
    1,
  );
  assert.ok(
    await db.paymentException.findFirst({
      where: { intentId: i.id, code: "CONFLICTING_PROVIDER_EVIDENCE" },
    }),
  );
  await applyFact(a.attemptId, {
    reference: `test-${a.attemptId}`,
    state: "Confirmed",
    amount: "90.00",
    asset: fiat,
  });
  assert.ok(
    await db.paymentException.findFirst({
      where: { intentId: i.id, code: "AMOUNT_OR_ASSET_MISMATCH" },
    }),
  );
});
test("database: settled batch allocations use exact evidence and reject oversubscription", async () => {
  const first = await checkout("settlement-pending");
  const a = await confirm(first.s.sessionId, first.s.token, first.r.routeId);
  await dispatch(a.attemptId);
  const second = await checkout("settlement-pending");
  const b = await confirm(second.s.sessionId, second.s.token, second.r.routeId);
  await dispatch(b.attemptId);
  const attempt = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: a.attemptId },
  });
  const batch = await db.paymentSettlement.create({
    data: {
      providerOrgId: attempt.providerOrgId,
      integrationId: attempt.integrationId,
      environment: "sandbox",
      reference: `batch-${randomUUID()}`,
      asset: fiat,
      gross: "20000",
      fee: "20",
      net: "19980",
      state: "Completed",
      evidence: "fictional-batch-report-with-explicit-payment-references",
    },
  });
  await atomic(async (tx) => {
    await allocate(tx, batch.id, first.i.id, "10000");
    await allocate(tx, batch.id, second.i.id, "10000");
  });
  assert.equal(
    await db.settlementAllocation.count({ where: { settlementId: batch.id } }),
    2,
  );
});

test("database: report import deduplication, suspension before dispatch and journal insert guard", async () => {
  const { importReport } = await import("../../lib/payments/reports");
  const { i, s, r } = await checkout();
  const a = await confirm(s.sessionId, s.token, r.routeId);
  await dispatch(a.attemptId);
  const attempt = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: a.attemptId },
  });
  const report = {
    providerReportId: randomUUID(),
    coverageStart: new Date(0).toISOString(),
    coverageEnd: new Date().toISOString(),
    rows: [
      {
        reference: attempt.providerReference!,
        state: "Confirmed",
        amount: "100.00",
        asset: fiat,
      },
    ],
  };
  const first = await importReport(attempt.integrationId, "sandbox", report),
    second = await importReport(attempt.integrationId, "sandbox", report);
  assert.equal(first.id, second.id);
  assert.equal(second.cursor, 1);
  const entry = await db.journalEntry.findUniqueOrThrow({
    where: { source: `payment:${i.id}` },
  });
  await assert.rejects(
    db.journalPosting.create({
      data: {
        entryId: entry.id,
        account: "provider-fee",
        debit: "0",
        credit: "0",
      },
    }),
  );
  const blocked = await checkout();
  const b = await confirm(
    blocked.s.sessionId,
    blocked.s.token,
    blocked.r.routeId,
  );
  const chosen = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: b.attemptId },
  });
  await db.publishedProfile.update({
    where: { id: chosen.profileId },
    data: { current: false },
  });
  try {
    await dispatch(b.attemptId);
    assert.equal(
      (
        await db.paymentAttempt.findUniqueOrThrow({
          where: { id: b.attemptId },
        })
      ).state,
      "Rejected",
    );
    assert.equal(
      await db.simulatorPayment.count({ where: { key: chosen.key } }),
      0,
    );
  } finally {
    await db.publishedProfile.update({
      where: { id: chosen.profileId },
      data: { current: true },
    });
  }
});
test("database: batch settlement produces balanced per-merchant postings", async () => {
  const { recordSettlement } = await import("../../lib/payments/processing");
  const payments = [];
  for (let n = 0; n < 2; n++) {
    const c = await checkout("settlement-pending");
    const a = await confirm(c.s.sessionId, c.s.token, c.r.routeId);
    await dispatch(a.attemptId);
    payments.push({
      c,
      a: await db.paymentAttempt.findUniqueOrThrow({
        where: { id: a.attemptId },
      }),
    });
  }
  const s = await recordSettlement({
    integrationId: payments[0].a.integrationId,
    environment: "sandbox",
    reference: randomUUID(),
    asset: fiat,
    gross: "20000",
    fee: "20",
    net: "19980",
    evidence: "explicit batch allocation report",
    allocations: payments.map((p) => ({
      intentId: p.c.i.id,
      amount: "10000",
      fee: "10",
    })),
  });
  assert.equal(
    await db.journalEntry.count({
      where: { source: { startsWith: `settlement:${s.id}:` } },
    }),
    2,
  );
});
test("database: linked conversion illustration balances separately per asset", async () => {
  const { post } = await import("../../lib/payments/journal");
  const link = randomUUID();
  await atomic(async (tx) => {
    for (const [asset, amount] of [
      ["fiat:USD:", "100"],
      ["fiat:NGN:", "150000"],
    ])
      await post(
        tx,
        {
          orgId: merchant,
          environment: "sandbox",
          source: `conversion:${link}:${asset}`,
          asset,
          purpose: `Fictional linked conversion ${link}; illustrative rate 1500 NGN/USD; exact minor units`,
          effectiveAt: new Date(),
        },
        [
          { account: "provider-clearing", debit: amount, credit: "0" },
          { account: "conversion-clearing", debit: "0", credit: amount },
        ],
      );
  });
  assert.equal(
    await db.journalEntry.count({
      where: { source: { startsWith: `conversion:${link}:` } },
    }),
    2,
  );
});

test("database: worker crash before provider acceptance replays stable idempotency identity", async () => {
  const { s, r } = await checkout();
  const a = await confirm(s.sessionId, s.token, r.routeId);
  await db.paymentAttempt.update({
    where: { id: a.attemptId },
    data: { state: "Dispatching" },
  });
  await dispatch(a.attemptId);
  assert.equal((await progress(s.sessionId, s.token)).state, "Confirmed");
  assert.equal(
    await db.simulatorPayment.count({
      where: { reference: `test-${a.attemptId}` },
    }),
    1,
  );
});

test("database: card, mobile money and stablecoin stay in their explicitly selected method", async () => {
  const { usdc } = await import("../fixtures/providers");
  for (const method of ["card", "mobile-money", "stablecoin"]) {
    const crypto = method === "stablecoin";
    const i = await createIntent(merchant, randomUUID(), {
      ...input,
      methods: [method],
      asset: crypto ? usdc : fiat,
      settlement: crypto ? usdc : fiat,
      precision: crypto ? 6 : 2,
      scenario: "action",
    });
    const s = await createSession(merchant, i.id);
    await methods(s.sessionId, s.token);
    const r = await selectMethod(s.sessionId, s.token, method);
    const a = await confirm(s.sessionId, s.token, r.routeId);
    await dispatch(a.attemptId);
    const view = await progress(s.sessionId, s.token);
    assert.equal(view.attemptState, "Requires action");
    assert.equal((view.action as { method: string }).method, method);
    await customerAction(s.sessionId, s.token);
    await poll(a.attemptId);
    await settle(a.attemptId);
    assert.equal((await reconcile(a.attemptId)).result, "Exact match");
  }
});

test("database: external confirmation cannot enqueue or manufacture simulator settlement", async () => {
  const { i, s, r } = await checkout();
  const created = await confirm(s.sessionId, s.token, r.routeId);
  const provider = await db.organization.create({
    data: { name: "Fictional native guard", fictional: true },
  });
  const integration = await db.integration.create({
    data: {
      orgId: provider.id,
      environment: "sandbox",
      version: 1,
      config: {
        mode: "NATIVE",
        adapter: "stripe",
        environment: "sandbox",
        secretKeyRef: "native-test-no-real-secret",
        returnUrl: "https://merchant.example/return",
        cancelUrl: "https://merchant.example/cancel",
      },
    },
  });
  await db.paymentAttempt.update({
    where: { id: created.attemptId },
    data: {
      integrationId: integration.id,
      providerOrgId: provider.id,
      state: "Pending",
      providerReference: `cs_test_${randomUUID()}`,
    },
  });
  const a = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: created.attemptId },
  });
  await applyFact(a.id, {
    state: "Confirmed",
    reference: a.providerReference,
    amount: i.amount,
    asset: i.asset,
  });
  assert.equal(
    (await db.paymentAttempt.findUniqueOrThrow({ where: { id: a.id } })).state,
    "Confirmed",
  );
  assert.equal(await db.job.count({ where: { key: `settle:${a.id}` } }), 0);
  assert.equal(await settle(a.id), undefined);
  assert.equal(
    await db.paymentSettlement.count({
      where: { integrationId: integration.id },
    }),
    0,
  );
  assert.equal(
    await db.journalEntry.count({ where: { source: `payment:${i.id}` } }),
    1,
  );
});

test("database: external dispatch without a reference is inspected and never recreated", async () => {
  const { i, s, r } = await checkout();
  const created = await confirm(s.sessionId, s.token, r.routeId);
  const provider = await db.organization.create({
    data: { name: "Fictional recovery guard", fictional: true },
  });
  const integration = await db.integration.create({
    data: {
      orgId: provider.id,
      environment: "sandbox",
      version: 1,
      config: {
        mode: "NATIVE",
        adapter: "stripe",
        environment: "sandbox",
        secretKeyRef: "native-test-no-real-secret",
        returnUrl: "https://merchant.example/return",
        cancelUrl: "https://merchant.example/cancel",
      },
    },
  });
  await db.paymentAttempt.update({
    where: { id: created.attemptId },
    data: {
      integrationId: integration.id,
      providerOrgId: provider.id,
      state: "Dispatching",
      providerReference: null,
    },
  });
  // Status lookup needs no credentials when there is no provider reference.
  // Replaying create would throw for this missing secret, instead of passing.
  await poll(created.attemptId);
  assert.equal(await db.paymentAttempt.count({ where: { intentId: i.id } }), 1);
  assert.equal(
    await db.simulatorPayment.count({
      where: {
        key: (
          await db.paymentAttempt.findUniqueOrThrow({
            where: { id: created.attemptId },
          })
        ).key,
      },
    }),
    0,
  );
  assert.equal(
    await db.paymentException.count({
      where: { intentId: i.id, code: "UNKNOWN_PROVIDER_OUTCOME" },
    }),
    1,
  );
});

test("database: deposit address reservation is restart-safe, race-safe and never reused", async () => {
  const { databaseDepositStore } =
    await import("../../lib/blockchain/deposit-store");
  const provider = await db.organization.create({
    data: { name: "Fictional deposit provider", fictional: true },
  });
  const integration = await db.integration.create({
    data: {
      orgId: provider.id,
      environment: "sandbox",
      version: 1,
      config: {
        adapter: "erc20-deposit",
        mode: "NATIVE",
        environment: "sandbox",
      },
    },
  });
  const asset = {
    kind: "blockchain",
    network: "eip155:11155111",
    identifier: "erc20:0x1c7d4b196cb0c7b01d743fbc6116a902379c7238",
  };
  async function record() {
    // Construct the exact stablecoin scope before an attempt exists. Financial
    // terms cannot be rewritten from a bank invoice after confirmation.
    const i = await createIntent(merchant, randomUUID(), {
      ...input,
      asset,
      settlement: asset,
      amount: "1.50",
      precision: 6,
      methods: ["stablecoin"],
    });
    await db.paymentIntent.update({
      where: { id: i.id },
      data: { selectedMethod: "stablecoin", state: "Processing" },
    });
    const a = await db.paymentAttempt.create({
      data: {
        intentId: i.id,
        number: 1,
        profileId: `deposit:${integration.id}`,
        providerOrgId: provider.id,
        integrationId: integration.id,
        environment: "sandbox",
        routeId: `fixture:${randomUUID()}`,
        key: `fixture:${randomUUID()}`,
        fingerprint: i.fingerprint,
      },
    });
    await assert.rejects(
      db.paymentIntent.update({
        where: { id: i.id },
        data: { amount: "2.00" },
      }),
      /locked after an attempt/,
    );
    return a;
  }
  const [a, b] = await Promise.all([record(), record()]);
  const address = `0x${randomUUID().replaceAll("-", "")}${randomUUID().slice(0, 8)}`;
  const store = databaseDepositStore(integration.id);
  const allocationInput = (a: { id: string; key: string }) => ({
    attemptId: a.id,
    attemptKey: a.key,
    environment: "sandbox",
    network: asset.network,
    identifier: asset.identifier,
    amount: "1.50",
    precision: 6,
    startBlock: 100n,
    addresses: [address],
  });
  const results = await Promise.allSettled([
    store.allocate(allocationInput(a)),
    store.allocate(allocationInput(b)),
  ]);
  const success = results.filter((r) => r.status === "fulfilled");
  assert.equal(success.length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  const binding = (
    success[0] as PromiseFulfilledResult<
      Awaited<ReturnType<typeof store.allocate>>
    >
  ).value;
  const winner = binding.attemptId === a.id ? a : b;
  const replay = await databaseDepositStore(integration.id).allocate({
    ...allocationInput(winner),
    startBlock: 999n,
  });
  assert.equal(replay.address, address);
  assert.equal(replay.startBlock, 100n);
  assert.equal(
    await db.depositBinding.count({
      where: { network: asset.network, address },
    }),
    1,
  );
  await assert.rejects(
    db.depositBinding.update({
      where: { attemptId: winner.id },
      data: { address: `0x${"e".repeat(40)}` },
    }),
    /immutable/,
  );
  await assert.rejects(
    databaseDepositStore("another-integration").find(winner.id),
    /BINDING_MISMATCH/,
  );
  const evidence = {
    txHash: `0x${"b".repeat(64)}`,
    logIndex: `0x${randomUUID().replaceAll("-", "")}`,
    blockHash: `0x${"c".repeat(64)}`,
    amount: "1.500000",
  };
  await store.claim(binding, evidence);
  await store.claim(binding, evidence);
  assert.equal(
    await db.depositClaim.count({ where: { attemptId: winner.id } }),
    1,
  );
  await assert.rejects(
    store.claim(binding, { ...evidence, blockHash: `0x${"d".repeat(64)}` }),
    /ALREADY_CLAIMED/,
  );
  await assert.rejects(
    store.claim(binding, { ...evidence, amount: "2.000000" }),
    /BINDING_MISMATCH/,
  );
});

// Production fee tests use fictional database records and authenticated-fact fixtures only.
async function feeFixture(
  method = "card",
  amount = "100.00",
  terms = true,
  feeOrgId = merchant,
) {
  const { snapshotFees } = await import("../../lib/payments/pricing");
  const { i: base, r } = await checkout();
  const asset = { kind: "fiat", identifier: "USD", network: "" };
  const intent = await db.paymentIntent.create({
    data: {
      orgId: feeOrgId,
      environment: "production",
      reference: randomUUID(),
      amount,
      asset,
      precision: 2,
      methods: [method],
      selectedMethod: method,
      settlement: asset,
      returnUrl: base.returnUrl,
      metadata: {},
      key: randomUUID(),
      fingerprint: randomUUID(),
      contextId: base.contextId,
      expiresAt: new Date(Date.now() + 3600000),
      ...(terms
        ? {
            feeSnapshot: snapshotFees(
              {
                orgId: feeOrgId,
                environment: "production",
                asset,
                precision: 2,
              },
              new Date(),
              "[]",
            ),
          }
        : {}),
    },
  });
  const provider = await db.organization.create({
    data: { name: "Fictional fee provider", fictional: true },
  });
  const integration = await db.integration.create({
    data: {
      orgId: provider.id,
      environment: "production",
      version: 1,
      config: {
        mode: "NATIVE",
        adapter: "stripe",
        environment: "production",
        secretKeyRef: "fictional-never-called",
        returnUrl: "https://merchant.example/return",
        cancelUrl: "https://merchant.example/cancel",
      },
    },
  });
  const a = await db.paymentAttempt.create({
    data: {
      intentId: intent.id,
      number: 1,
      profileId: "fictional-fee-profile",
      providerOrgId: provider.id,
      integrationId: integration.id,
      environment: "production",
      routeId: r.routeId,
      key: randomUUID(),
      fingerprint: randomUUID(),
      state: "Pending",
      providerReference: randomUUID(),
    },
  });
  const fact = (state: string, value = amount) => ({
    reference: a.providerReference,
    state,
    amount: value,
    asset,
  });
  return { intent, a, fact };
}
test("database: production fee is exactly once under concurrent confirmation and provider value stays whole", async () => {
  const { intent, a, fact } = await feeFixture();
  await Promise.all([
    applyFact(a.id, fact("Confirmed")),
    applyFact(a.id, fact("Confirmed")),
  ]);
  await applyFact(a.id, fact("Pending"));
  const fee = await db.paymentFee.findUniqueOrThrow({
    where: { intentId: intent.id },
  });
  assert.equal(fee.amountMinor.toFixed(0), "100", "1% of 100.00");
  assert.equal(fee.currency, "USD");
  assert.equal(fee.billable, true);
  assert.equal(
    await db.paymentFee.count({ where: { intentId: intent.id } }),
    1,
  );
  const entries = await db.journalEntry.findMany({
    where: {
      source: { in: [`payment:${intent.id}`, `platform-fee:${intent.id}`] },
    },
    include: { postings: true },
  });
  assert.equal(entries.length, 2);
  assert.equal(
    entries
      .find((e) => e.book === "provider-merchant-operational")!
      .postings.find((p) => p.account === "provider-clearing")!
      .debit.toFixed(0),
    "10000",
  );
  assert.equal(
    entries
      .find((e) => e.book === "payrouta-platform-accrual")!
      .postings.find((p) => p.account === "platform-receivable")!
      .debit.toFixed(0),
    "100",
  );
  await assert.rejects(
    db.paymentFee.update({
      where: { intentId: intent.id },
      data: { amountMinor: "1" },
    }),
    /immutable/,
  );
  await assert.rejects(
    db.paymentIntent.update({
      where: { id: intent.id },
      data: { feeSnapshot: {} },
    }),
    /immutable/,
  );
});
test("database: pending, rejected and mismatched confirmations incur no fee; the $5 cap applies", async () => {
  const { intent, a, fact } = await feeFixture("bank-transfer", "10000.00");
  await applyFact(a.id, fact("Pending"));
  await applyFact(a.id, fact("Confirmed", "9999.00"));
  assert.equal(
    await db.paymentFee.count({ where: { intentId: intent.id } }),
    0,
  );
  await applyFact(a.id, fact("Confirmed"));
  assert.equal(
    (
      await db.paymentFee.findUniqueOrThrow({ where: { intentId: intent.id } })
    ).amountMinor.toFixed(0),
    "500",
    "1% of 10,000.00 is $100, capped at $5",
  );
  const rejected = await feeFixture();
  await applyFact(rejected.a.id, rejected.fact("Rejected"));
  assert.equal(
    await db.paymentFee.count({ where: { intentId: rejected.intent.id } }),
    0,
  );
});
test("database: sandbox fallback is free and pre-pricing intents are never back-billed", async () => {
  const c = await checkout("fallback");
  const first = await confirm(c.s.sessionId, c.s.token, c.r.routeId);
  await dispatch(first.attemptId);
  const second = await db.paymentAttempt.findFirstOrThrow({
    where: { intentId: c.i.id, number: 2 },
  });
  await dispatch(second.id);
  const fee = await db.paymentFee.findUniqueOrThrow({
    where: { intentId: c.i.id },
  });
  assert.equal(fee.amountMinor.toFixed(0), "0");
  assert.equal(fee.billable, false);
  assert.equal(
    await db.journalEntry.count({
      where: { source: `platform-fee:${c.i.id}` },
    }),
    0,
  );
  const legacy = await feeFixture("card", "100.00", false);
  await applyFact(legacy.a.id, legacy.fact("Confirmed"));
  assert.equal(
    await db.paymentFee.count({ where: { intentId: legacy.intent.id } }),
    0,
  );
  assert.equal(
    await db.paymentException.count({
      where: { intentId: legacy.intent.id, code: "PAYMENT_FEE_TERMS_MISSING" },
    }),
    1,
  );
});
test("database: closed monthly statements are idempotent, immutable and isolated from another merchant", async () => {
  const { closeStatement, feeTotals } =
    await import("../../lib/payments/billing");
  const owner = await db.organization.create({
    data: { name: "Fictional monthly billing owner", fictional: true },
  });
  const { intent, a, fact } = await feeFixture(
    "card",
    "100.00",
    true,
    owner.id,
  );
  const now = new Date();
  now.setUTCDate(1);
  now.setUTCHours(0, 0, 0, 0);
  now.setUTCMonth(now.getUTCMonth() - 1);
  const month = now.toISOString().slice(0, 7);
  await applyFact(a.id, fact("Confirmed"), now);
  const totals = await feeTotals(owner.id, "production", month);
  assert.ok(totals.find((t) => t.currency === "USD")!.payments >= 1);
  const s = await closeStatement(owner.id, month, "USD", 2);
  assert.equal((await closeStatement(owner.id, month, "USD", 2)).id, s.id);
  assert.ok(
    (s.lines as { intentId: string }[]).some((l) => l.intentId === intent.id),
  );
  await assert.rejects(
    db.billingStatement.update({
      where: { id: s.id },
      data: { amountMinor: "0" },
    }),
    /immutable/,
  );
  assert.deepEqual(await feeTotals("other-merchant", "production", month), []);
  await assert.rejects(
    closeStatement(owner.id, new Date().toISOString().slice(0, 7), "USD", 2),
    /NOT_CLOSED/,
  );
  const { post } = await import("../../lib/payments/journal");
  await assert.rejects(
    atomic((tx) =>
      post(
        tx,
        {
          orgId: merchant,
          environment: "production",
          source: randomUUID(),
          asset: "fiat:USD:",
          purpose: "Invalid cross-book fixture",
          effectiveAt: new Date(),
        },
        [
          { account: "platform-receivable", debit: "1", credit: "0" },
          { account: "merchant-payable", debit: "0", credit: "1" },
        ],
      ),
    ),
    /BOOK_ACCOUNT_MISMATCH/,
  );
});

test("database: merchants choose who pays fees, and the choice is fixed on each payment", async () => {
  const original = await db.merchantConfig.findUniqueOrThrow({ where: { orgId: merchant } });
  try {
    // Merchant absorbs fees by default: the customer pays the price.
    const absorbed = await createIntent(merchant, randomUUID(), input);
    assert.equal(absorbed.feeBearer, "merchant");
    assert.equal(absorbed.amount, "100.00");

    // Per-payment override: 1% (standard rate shown in sandbox) on top.
    const passed = await createIntent(merchant, randomUUID(), { ...input, feeBearer: "customer" });
    assert.equal(passed.feeBearer, "customer");
    assert.equal(passed.amount, "101.01");
    const option = (passed.paymentOptions as { amount: string; baseAmount: string; customerFeeMinor: string }[])[0];
    assert.deepEqual(
      { amount: option.amount, baseAmount: option.baseAmount, customerFeeMinor: option.customerFeeMinor },
      { amount: "101.01", baseAmount: "100.00", customerFeeMinor: "101" },
    );
    await assert.rejects(
      db.paymentIntent.update({ where: { id: passed.id }, data: { feeBearer: "merchant" } }),
      /immutable/,
    );

    // Merchant default, overridable back to absorbing.
    await db.merchantConfig.update({ where: { orgId: merchant }, data: { feeBearer: "customer" } });
    assert.equal((await createIntent(merchant, randomUUID(), input)).amount, "101.01");
    assert.equal((await createIntent(merchant, randomUUID(), { ...input, feeBearer: "merchant" })).amount, "100.00");

    // Card and bank surcharges are banned for merchants in the EU and UK.
    await db.merchantConfig.update({ where: { orgId: merchant }, data: { country: "DE" } });
    await assert.rejects(createIntent(merchant, randomUUID(), input), /FEE_PASS_THROUGH_NOT_PERMITTED/);
  } finally {
    await db.merchantConfig.update({
      where: { orgId: merchant },
      data: { feeBearer: original.feeBearer, country: original.country },
    });
  }
});
