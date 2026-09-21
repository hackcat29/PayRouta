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
