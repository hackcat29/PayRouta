import { enforceRisk } from "../merchant/policy";
import { randomUUID } from "node:crypto";
import { db } from "../portal/db";
import { atomic, json } from "../portal/service";
import { PortalError } from "../portal/domain";
import { assertAdapterConfiguration } from "../portal/provider-adapters";
import { revalidateSelectedMethod } from "../portal/availability-service";
import { fingerprint } from "../portal/registry";
import { sandboxInstructions } from "./execution";
import { persistentSimulator } from "../portal/simulator";
import { assetKey, minor, providerFact } from "./contracts";
import { event, queue, Tx } from "./service";
import { post, exception } from "./journal";
export async function applyFact(
  attemptId: string,
  value: unknown,
  now = new Date(),
) {
  const fact = providerFact.parse(value);
  console.info(
    JSON.stringify({ event: "payment.fact", attemptId, state: fact.state }),
  );
  return atomic(async (tx) => {
    const a = await tx.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { intent: true },
    });
    const i = a.intent;
    if (a.providerReference && a.providerReference !== fact.reference) {
      await exception(tx, i.id, "REFERENCE_MISMATCH", fact, now);
      return;
    }
    if (
      fingerprint(i.asset) !== fingerprint(fact.asset) ||
      minor(i.amount, i.precision) !== minor(fact.amount, i.precision)
    ) {
      await exception(tx, i.id, "AMOUNT_OR_ASSET_MISMATCH", fact, now);
      return;
    }
    if (a.state === "Confirmed") {
      if (fact.state === "Rejected")
        await exception(tx, i.id, "CONFLICTING_PROVIDER_EVIDENCE", fact, now);
      return;
    }
    if (a.state === "Rejected" && fact.state !== "Rejected") {
      await exception(tx, i.id, "CONFIRMATION_AFTER_REJECTION", fact, now);
      return;
    }
    if (a.state === fact.state) return;
    if (fact.state === "Confirmed" && i.expiresAt <= now)
      await exception(tx, i.id, "LATE_PAYMENT", fact, now);
    await tx.paymentAttempt.update({
      where: { id: a.id },
      data: {
        state: fact.state,
        providerReference: fact.reference,
        action:
          fact.state === "Requires action"
            ? json(
                sandboxInstructions(
                  i.selectedMethod!,
                  fact.reference,
                  i.amount,
                  i.asset,
                  i.expiresAt,
                ),
              )
            : undefined,
      },
    });
    await tx.paymentIntent.update({
      where: { id: i.id },
      data: {
        state:
          fact.state === "Confirmed"
            ? "Confirmed"
            : fact.state === "Rejected"
              ? "Open"
              : "Processing",
        version: { increment: 1 },
      },
    });
    await event(
      tx,
      i.id,
      fact.state === "Confirmed"
        ? "payment.confirmed"
        : fact.state === "Rejected"
          ? "payment.failed"
          : fact.state === "Requires action"
            ? "payment.action_required"
            : "payment.pending",
      now,
    );
    await tx.integrationEvent.upsert({
      where: {
        orgId_environment_eventId: {
          orgId: a.providerOrgId,
          environment: a.environment,
          eventId: `payment:${a.id}:${fact.state}`,
        },
      },
      create: {
        orgId: a.providerOrgId,
        environment: a.environment,
        eventId: `payment:${a.id}:${fact.state}`,
        type: "payment.status",
        state: "Processed",
        summary: `Payment ${fact.state.toLowerCase()}`,
      },
      update: {},
    });
    const existingTransaction = await tx.transaction.findUnique({
      where: {
        orgId_environment_reference: {
          orgId: a.providerOrgId,
          environment: a.environment,
          reference: fact.reference,
        },
      },
    });
    const timeline = json([
      ...((existingTransaction?.timeline as object[]) || []).slice(-19),
      { at: now.toISOString(), state: fact.state },
    ]);
    const latencyMs = a.dispatchedAt
      ? Math.max(
          0,
          Math.min(2147483647, now.getTime() - a.dispatchedAt.getTime()),
        )
      : null;
    await tx.transaction.upsert({
      where: {
        orgId_environment_reference: {
          orgId: a.providerOrgId,
          environment: a.environment,
          reference: fact.reference,
        },
      },
      create: {
        orgId: a.providerOrgId,
        environment: a.environment,
        reference: fact.reference,
        method: i.selectedMethod!,
        operation: "pay-in",
        amount: i.amount,
        asset: fact.asset.identifier,
        executionState: fact.state,
        timeline,
        latencyMs,
      },
      update: { executionState: fact.state, timeline, latencyMs },
    });
    if (fact.state === "Confirmed") {
      const n = minor(i.amount, i.precision).toString();
      await post(
        tx,
        {
          orgId: i.orgId,
          environment: i.environment,
          source: `payment:${i.id}`,
          asset: assetKey(fact.asset),
          purpose: "Provider confirms payer value; outside PayRouta custody",
          effectiveAt: now,
        },
        [
          { account: "provider-clearing", debit: n, credit: "0" },
          { account: "merchant-payable", debit: "0", credit: n },
        ],
      );
      await event(tx, i.id, "settlement.pending", now);
      if (i.scenario !== "settlement-pending")
        await queue(tx, i.orgId, "payment-settle", `settle:${a.id}`, {
          attemptId: a.id,
        });
      await queue(
        tx,
        i.orgId,
        "payment-reconcile",
        `reconcile:${a.id}`,
        { attemptId: a.id },
        new Date(now.getTime() + 2000),
      );
    }
  });
}
export async function dispatch(attemptId: string, now = new Date()) {
  const a = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { intent: true },
  });
  if (a.state !== "Created") {
    if (["Dispatching", "Unknown", "Pending"].includes(a.state))
      await poll(a.id, now);
    return;
  }
  const route = await db.paymentRoute.findUniqueOrThrow({
    where: { id: a.routeId },
  });
  try {
    if (route.expiresAt <= now) throw new PortalError("QUOTE_EXPIRED");
    const current = await revalidateSelectedMethod(
      a.intent.orgId,
      a.intent.contextId,
      route.evaluationId,
      route.method,
      now,
    );
    if (!current.candidateIds.includes(a.profileId))
      throw new PortalError("PROVIDER_SUSPENDED");
    const integration = await db.integration.findUniqueOrThrow({
      where: { id: a.integrationId },
    });
    assertAdapterConfiguration(
      "simulator",
      "1",
      a.environment,
      integration.config,
    );
  } catch {
    await atomic(async (tx) => {
      const result = await tx.paymentAttempt.updateMany({
        where: { id: a.id, state: "Created" },
        data: { state: "Rejected" },
      });
      if (result.count) {
        await tx.paymentIntent.update({
          where: { id: a.intentId },
          data: { state: "Open", routeId: null, version: { increment: 1 } },
        });
        await event(tx, a.intentId, "payment.failed", now);
      }
    });
    return;
  }
  const claim = await atomic(async (tx) => {
    const risk = await enforceRisk(tx, a.intent, now, false);
    if (risk.decision !== "Allow") return { count: 0 };
    return tx.paymentAttempt.updateMany({
      where: { id: a.id, state: "Created" },
      data: { state: "Dispatching", dispatchedAt: now },
    });
  });
  if (!claim.count) return;
  console.info(
    JSON.stringify({
      event: "payment.dispatch",
      attemptId: a.id,
      environment: a.environment,
    }),
  );
  let result;
  try {
    result = await persistentSimulator.create(a, a.intent);
  } catch {
    result = { state: "Unknown", reference: "" };
  }
  if (result.state === "Unknown") {
    await atomic(async (tx) => {
      await tx.paymentAttempt.updateMany({
        where: { id: a.id, state: "Dispatching" },
        data: {
          state: "Unknown",
          ...(result.reference ? { providerReference: result.reference } : {}),
        },
      });
      await event(tx, a.intentId, "payment.pending", now);
      await queue(
        tx,
        a.intent.orgId,
        "payment-poll",
        `poll:${a.id}`,
        { attemptId: a.id },
        new Date(now.getTime() + 1000),
      );
    });
  } else
    await applyFact(
      a.id,
      {
        ...result,
        reference: result.reference || `rejected-${a.id}`,
        amount: a.intent.amount,
        asset: a.intent.asset,
      },
      now,
    );
  if (
    result.state === "Rejected" &&
    a.intent.scenario === "fallback" &&
    a.number === 1
  ) {
    const current = await revalidateSelectedMethod(
      a.intent.orgId,
      a.intent.contextId,
      route.evaluationId,
      route.method,
      now,
    );
    const snapshot = route.snapshot as {
      ranked: { profileId: string; fee: string }[];
    };
    const next = snapshot.ranked.find(
      (p) =>
        p.profileId !== a.profileId &&
        current.candidateIds.includes(p.profileId),
    );
    if (next)
      await atomic(async (tx) => {
        const previous = await tx.paymentAttempt.findUniqueOrThrow({
          where: { id: a.id },
        });
        if (
          previous.state !== "Rejected" ||
          (await tx.paymentAttempt.count({
            where: { intentId: a.intentId, number: 2 },
          }))
        )
          return;
        const p = await tx.publishedProfile.findUniqueOrThrow({
          where: { id: next.profileId },
        });
        const r = await tx.paymentRoute.create({
          data: {
            intentId: a.intentId,
            method: route.method,
            evaluationId: route.evaluationId,
            policy: route.policy,
            policyVersion: route.policyVersion,
            profileId: p.id,
            snapshot: json({
              ...(route.snapshot as object),
              providerFeeMinor: next.fee,
              fallbackFrom: a.id,
            }),
            expiresAt: route.expiresAt,
          },
        });
        const second = await tx.paymentAttempt.create({
          data: {
            intentId: a.intentId,
            number: 2,
            profileId: p.id,
            providerOrgId: p.orgId,
            integrationId: p.integrationId,
            environment: a.environment,
            routeId: r.id,
            key: `attempt:${randomUUID()}`,
            fingerprint: a.fingerprint,
          },
        });
        await tx.paymentIntent.update({
          where: { id: a.intentId },
          data: {
            state: "Processing",
            routeId: r.id,
            version: { increment: 1 },
          },
        });
        await queue(
          tx,
          a.intent.orgId,
          "payment-dispatch",
          `dispatch:${second.id}`,
          { attemptId: second.id },
        );
      });
  }
}
export async function poll(attemptId: string, now = new Date()) {
  const a = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { intent: true },
  });
  let fact = await persistentSimulator.status(a.key);
  if (!fact && a.state === "Dispatching") {
    // Simulator lookup is authoritative and create supports the same durable idempotency key.
    const route = await db.paymentRoute.findUniqueOrThrow({
      where: { id: a.routeId },
    });
    try {
      if (route.expiresAt <= now) throw new PortalError("QUOTE_EXPIRED");
      const eligible = await revalidateSelectedMethod(
        a.intent.orgId,
        a.intent.contextId,
        route.evaluationId,
        route.method,
        now,
      );
      if (!eligible.candidateIds.includes(a.profileId))
        throw new PortalError("PROVIDER_RESTRICTED");
    } catch {
      await applyFact(
        a.id,
        {
          reference: `rejected-${a.id}`,
          state: "Rejected",
          amount: a.intent.amount,
          asset: a.intent.asset,
        },
        now,
      );
      return;
    }
    await persistentSimulator.create(a, a.intent);
    fact = await persistentSimulator.status(a.key);
  }
  if (fact)
    await applyFact(
      a.id,
      {
        reference: fact.reference,
        state: fact.state,
        amount: fact.amount,
        asset: fact.asset,
      },
      now,
    );
  else
    await atomic((tx) =>
      exception(
        tx,
        a.intentId,
        "UNKNOWN_PROVIDER_OUTCOME",
        {
          attemptId: a.id,
          nextAction:
            "Inspect provider idempotency lookup; do not create another attempt",
        },
        now,
      ),
    );
}
export async function allocate(
  tx: Tx,
  settlementId: string,
  intentId: string,
  amount: string,
) {
  const s = await tx.paymentSettlement.findUniqueOrThrow({
    where: { id: settlementId },
    include: { allocations: true },
  });
  const i = await tx.paymentIntent.findUniqueOrThrow({
    where: { id: intentId },
  });
  const a = await tx.paymentAttempt.findFirst({
    where: {
      intentId,
      state: "Confirmed",
      integrationId: s.integrationId,
      environment: s.environment,
    },
  });
  if (!a || fingerprint(i.settlement) !== fingerprint(s.asset))
    throw new PortalError("ALLOCATION_SCOPE_MISMATCH");
  const old = s.allocations.find((x) => x.intentId === intentId);
  if (old) {
    if (old.amount !== amount) throw new PortalError("ALLOCATION_CONFLICT");
    return;
  }
  const prior = await tx.settlementAllocation.findMany({ where: { intentId } });
  if (
    !/^\d+$/.test(amount) ||
    BigInt(amount) <= 0n ||
    s.allocations.reduce((n, x) => n + BigInt(x.amount), 0n) + BigInt(amount) >
      BigInt(s.gross) ||
    prior.reduce((n, x) => n + BigInt(x.amount), 0n) + BigInt(amount) >
      minor(i.amount, i.precision)
  )
    throw new PortalError("OVER_ALLOCATION");
  await tx.settlementAllocation.create({
    data: { settlementId, intentId, amount },
  });
}
export type SettlementEvidence = {
  integrationId: string;
  environment: string;
  reference: string;
  asset: { kind: string; identifier: string; network: string };
  gross: string;
  fee: string;
  net: string;
  evidence: string;
  allocations: { intentId: string; amount: string; fee: string }[];
};
export async function recordSettlement(
  input: SettlementEvidence,
  now = new Date(),
) {
  if (
    !input.evidence ||
    !input.allocations.length ||
    input.allocations.length > 100
  )
    throw new PortalError("ALLOCATION_EVIDENCE_REQUIRED");
  for (const n of [
    input.gross,
    input.fee,
    input.net,
    ...input.allocations.flatMap((a) => [a.amount, a.fee]),
  ])
    if (!/^\d+$/.test(n)) throw new PortalError("INVALID_SETTLEMENT_AMOUNT");
  if (
    BigInt(input.gross) !== BigInt(input.fee) + BigInt(input.net) ||
    input.allocations.reduce((n, a) => n + BigInt(a.amount), 0n) !==
      BigInt(input.gross) ||
    input.allocations.reduce((n, a) => n + BigInt(a.fee), 0n) !==
      BigInt(input.fee)
  )
    throw new PortalError("SETTLEMENT_ALLOCATION_TOTAL_MISMATCH");
  return atomic(async (tx) => {
    const integration = await tx.integration.findUniqueOrThrow({
      where: { id: input.integrationId },
    });
    if (integration.environment !== input.environment)
      throw new PortalError("SETTLEMENT_ENVIRONMENT_MISMATCH");
    const prior = await tx.paymentSettlement.findUnique({
      where: {
        integrationId_environment_reference: {
          integrationId: input.integrationId,
          environment: input.environment,
          reference: input.reference,
        },
      },
    });
    if (prior) {
      if (
        prior.gross !== input.gross ||
        prior.fee !== input.fee ||
        fingerprint(prior.asset) !== fingerprint(input.asset)
      )
        throw new PortalError("SETTLEMENT_EVIDENCE_CONFLICT");
      return prior;
    }
    const s = await tx.paymentSettlement.create({
      data: {
        providerOrgId: integration.orgId,
        integrationId: input.integrationId,
        environment: input.environment,
        reference: input.reference,
        asset: json(input.asset),
        gross: input.gross,
        fee: input.fee,
        net: input.net,
        state: "Completed",
        evidence: input.evidence,
      },
    });
    for (const allocation of input.allocations) {
      if (BigInt(allocation.fee) > BigInt(allocation.amount))
        throw new PortalError("FEE_EXCEEDS_ALLOCATION");
      await allocate(tx, s.id, allocation.intentId, allocation.amount);
      await tx.settlementAllocation.update({
        where: {
          settlementId_intentId: {
            settlementId: s.id,
            intentId: allocation.intentId,
          },
        },
        data: { fee: allocation.fee },
      });
      const i = await tx.paymentIntent.findUniqueOrThrow({
        where: { id: allocation.intentId },
      });
      const asset = assetKey(input.asset),
        net = (BigInt(allocation.amount) - BigInt(allocation.fee)).toString();
      await post(
        tx,
        {
          orgId: i.orgId,
          environment: i.environment,
          source: `settlement:${s.id}:${i.id}`,
          asset,
          purpose: "Provider settlement outside PayRouta custody",
          effectiveAt: now,
        },
        [
          {
            account: "merchant-payable",
            debit: allocation.amount,
            credit: "0",
          },
          {
            account: "provider-clearing",
            debit: "0",
            credit: allocation.amount,
          },
        ],
      );
      await post(
        tx,
        {
          orgId: i.orgId,
          environment: i.environment,
          source: `settlement-detail:${s.id}:${i.id}`,
          asset,
          purpose: "Merchant net receipt and provider fee observation",
          effectiveAt: now,
        },
        [
          { account: "merchant-settled", debit: net, credit: "0" },
          { account: "provider-fee", debit: allocation.fee, credit: "0" },
          {
            account: "conversion-clearing",
            debit: "0",
            credit: allocation.amount,
          },
        ],
      );
      const a = await tx.paymentAttempt.findFirstOrThrow({
        where: {
          intentId: i.id,
          state: "Confirmed",
          integrationId: integration.id,
        },
      });
      const transaction = await tx.transaction.findUniqueOrThrow({
        where: {
          orgId_environment_reference: {
            orgId: a.providerOrgId,
            environment: a.environment,
            reference: a.providerReference!,
          },
        },
      });
      const scale = 10n ** BigInt(i.precision);
      const displayNet = `${BigInt(net) / scale}${i.precision ? "." + (BigInt(net) % scale).toString().padStart(i.precision, "0") : ""}`;
      await tx.settlement.create({
        data: {
          orgId: a.providerOrgId,
          transactionId: transaction.id,
          environment: a.environment,
          state: "Completed",
          reference: s.reference,
          amount: displayNet,
          asset: input.asset.identifier,
          completedAt: now,
        },
      });
      await tx.paymentIntent.update({
        where: { id: i.id },
        data: { version: { increment: 1 } },
      });
      const all = await tx.settlementAllocation.findMany({
        where: { intentId: i.id },
      });
      await event(
        tx,
        i.id,
        all.reduce((n, x) => n + BigInt(x.amount), 0n) ===
          minor(i.amount, i.precision)
          ? "settlement.completed"
          : "settlement.pending",
        now,
      );
    }
    return s;
  });
}
export async function settle(attemptId: string, now = new Date()) {
  const a = await db.paymentAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { intent: true },
  });
  if (a.state !== "Confirmed") throw new PortalError("PAYMENT_NOT_CONFIRMED");
  const i = a.intent,
    route = await db.paymentRoute.findUniqueOrThrow({
      where: { id: a.routeId },
    });
  const fee =
      BigInt(
        (route.snapshot as { providerFeeMinor: string }).providerFeeMinor,
      ) + (i.scenario === "fee-mismatch" ? 1n : 0n),
    gross = minor(i.amount, i.precision);
  if (fee > gross) throw new PortalError("FEE_EXCEEDS_GROSS");
  const result = await recordSettlement(
    {
      integrationId: a.integrationId,
      environment: a.environment,
      reference: `test-settle-${a.id}`,
      asset: i.settlement as SettlementEvidence["asset"],
      gross: gross.toString(),
      fee: fee.toString(),
      net: (gross - fee).toString(),
      evidence: `simulator-report:${a.key}`,
      allocations: [
        { intentId: i.id, amount: gross.toString(), fee: fee.toString() },
      ],
    },
    now,
  );
  await db.simulatorPayment.update({
    where: { key: a.key },
    data: { settlementState: "Completed" },
  });
  return result;
}
export async function reconcile(attemptId: string, now = new Date()) {
  await poll(attemptId, now);
  return atomic(async (tx) => {
    const a = await tx.paymentAttempt.findUniqueOrThrow({
      where: { id: attemptId },
      include: { intent: true },
    });
    const s = await tx.settlementAllocation.findMany({
      where: { intentId: a.intentId },
      include: { settlement: true },
    });
    const route = await tx.paymentRoute.findUniqueOrThrow({
      where: { id: a.routeId },
    });
    const entries = await tx.journalEntry.findMany({
      where: { source: `payment:${a.intentId}` },
    });
    const unresolved = await tx.paymentException.findMany({
      where: { intentId: a.intentId, state: "Unresolved" },
    });
    const problems: string[] = unresolved.map((e) => e.code);
    if (a.state === "Confirmed" && entries.length !== 1)
      problems.push("MISSING_JOURNAL");
    if (
      ["Unknown", "Dispatching", "Pending"].includes(a.state) &&
      now.getTime() - a.createdAt.getTime() > 300000
    )
      problems.push("AGED_PENDING");
    for (const x of s)
      if (
        x.fee !==
        (route.snapshot as { providerFeeMinor: string }).providerFeeMinor
      )
        problems.push("FEE_MISMATCH");
    if (
      s.length &&
      s.reduce((n, x) => n + BigInt(x.amount), 0n) <
        minor(a.intent.amount, a.intent.precision)
    )
      problems.push("PARTIAL_SETTLEMENT");
    for (const x of s) {
      const all = await tx.settlementAllocation.findMany({
        where: { settlementId: x.settlementId },
      });
      if (
        all.reduce((n, y) => n + BigInt(y.amount), 0n) !==
        BigInt(x.settlement.gross)
      )
        problems.push("UNALLOCATED_SETTLEMENT");
    }
    const evidence = {
      attemptId,
      state: a.state,
      settlements: s.map((x) => ({
        id: x.settlementId,
        fee: x.fee,
        evidence: x.settlement.evidence,
      })),
      journalIds: entries.map((e) => e.id),
    };
    for (const code of problems)
      await exception(tx, a.intentId, code, evidence, now);
    if (problems.length)
      await event(tx, a.intentId, "settlement.exception", now);
    for (const x of s)
      await tx.paymentSettlement.update({
        where: { id: x.settlementId },
        data: { reconciliation: problems.length ? "Exception" : "Exact match" },
      });
    const f = fingerprint(evidence);
    return tx.paymentReconciliation.upsert({
      where: { fingerprint: f },
      create: {
        intentId: a.intentId,
        fingerprint: f,
        evidence: json(evidence),
        result: problems.length
          ? "Unresolved exception"
          : s.length
            ? "Exact match"
            : "Awaiting settlement evidence",
      },
      update: {},
    });
  });
}
