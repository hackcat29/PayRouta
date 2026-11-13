import { relayWalletSubmission } from "../blockchain/wallet-submissions";
import { simulatedIntegration } from "../providers/adapters/native/registry";
import { importSimulatorReport } from "./reports";
import { db } from "../portal/db";
import { dispatch, poll, settle, reconcile, applyFact } from "./processing";
import { deliver } from "./delivery";
import { processRefund, resolveGroup } from "../integrations/shopify";
import { cancelUnpaid, markOrderPaid } from "../integrations/shopify-lite";
export async function paymentJob(kind: string, p: Record<string, string>) {
  if(kind==='payment-wallet-relay') await relayWalletSubmission(p.submissionId);
  else if (kind === "payment-report") await importSimulatorReport(p.integrationId);
  else if (kind === "payment-dispatch") await dispatch(p.attemptId);
  else if (kind === "payment-poll") await poll(p.attemptId);
  else if (kind === "payment-settle") await settle(p.attemptId);
  else if (kind === "payment-reconcile") await reconcile(p.attemptId);
  else if (kind === "payment-delivery") await deliver(p.eventId);
  // A checkout group belongs to a payments-app session or a Lite order.
  else if (kind === "payment-shopify-resolve") {
    if (!(await resolveGroup(p.checkoutGroup))) await markOrderPaid(p.checkoutGroup);
  }
  else if (kind === "payment-shopify-lite-cancel") await cancelUnpaid(p.orderRowId);
  else if (kind === "payment-shopify-refund") await processRefund(p.refundSessionId);
  else if (kind === "payment-inbox") {
    const inbox = await db.paymentInbox.findUniqueOrThrow({
      where: { id: p.inboxId },
    });
    if (inbox.state === "Processed") return;
    const payload = inbox.payload as {
      reference: string;
      type: string;
      attemptKey?: string;
    };
    if (payload.type === "native.capture") {
      const integration = await db.integration.findUniqueOrThrow({
        where: { id: inbox.integrationId },
      });
      if (
        (integration.config as { adapter?: string }).adapter !== "adyen" ||
        integration.environment !== inbox.environment ||
        typeof payload.attemptKey !== "string" ||
        !payload.attemptKey
      )
        throw new Error("NATIVE_CAPTURE_SCOPE_MISMATCH");
      const a = await db.paymentAttempt.findFirst({
        where: {
          integrationId: inbox.integrationId,
          environment: inbox.environment,
          key: payload.attemptKey,
        },
      });
      if (!a?.providerReference)
        throw new Error("NATIVE_CAPTURE_ATTEMPT_NOT_READY");
      const fact = inbox.payload as Record<string, unknown>;
      await applyFact(a.id, {
        reference: a.providerReference,
        state: fact.state,
        amount: fact.amount,
        asset: fact.asset,
      });
      await db.paymentInbox.update({
        where: { id: inbox.id },
        data: { state: "Processed" },
      });
      return;
    }
    const a = await db.paymentAttempt.findFirst({
      where: {
        integrationId: inbox.integrationId,
        environment: inbox.environment,
        providerReference: payload.reference,
      },
    });
    if (a && payload.type === "payment.status") {
      const { type: _, ...fact } = inbox.payload as Record<string, unknown>;
      void _;
      await applyFact(a.id, fact);
      await db.paymentInbox.update({
        where: { id: inbox.id },
        data: { state: "Processed" },
      });
    } else
      await db.paymentInbox.update({
        where: { id: inbox.id },
        data: { state: "Needs inspection" },
      });
  } else throw new Error("UNKNOWN_PAYMENT_JOB");
}

// Periodic recovery is independent of the browser and survives missed webhooks.
export async function sweepPayments(now = new Date()) {
  const attempts = await db.paymentAttempt.findMany({
    where: {
      state: {
        in: [
          "Dispatching",
          "Unknown",
          "Pending",
          "Requires action",
          "Confirmed",
        ],
      },
    },
    orderBy: { updatedAt: "asc" },
    take: 100,
    include: { intent: true },
  });
  const bucket = Math.floor(now.getTime() / 60000);
  for (const integrationId of new Set(attempts.map((a) => a.integrationId))) {
    const integration = await db.integration.findUniqueOrThrow({
      where: { id: integrationId },
    });
    if (!simulatedIntegration(integration)) continue;
    const a = attempts.find((a) => a.integrationId === integrationId)!;
    await db.job.upsert({
      where: { key: `report:${integrationId}:${bucket}` },
      create: {
        orgId: a.providerOrgId,
        kind: "payment-report",
        key: `report:${integrationId}:${bucket}`,
        payload: { integrationId },
      },
      update: {},
    });
  }
  for (const a of attempts) {
    await db.paymentAttempt.update({
      where: { id: a.id },
      data: { updatedAt: now },
    });
    if (
      a.state === "Confirmed" &&
      (await db.paymentReconciliation.findFirst({
        where: { intentId: a.intentId, result: "Exact match" },
      }))
    )
      continue;
    if (now.getTime() - a.createdAt.getTime() > 86400000) continue; // Exhaustion is visible; never infer failure.
    // One reconcile per attempt in the queue: while one waits or retries,
    // another each minute would only queue up ahead of other work.
    if (
      await db.job.count({
        where: { kind: "payment-reconcile", state: { in: ["Pending", "Running"] }, payload: { path: ["attemptId"], equals: a.id } },
      })
    )
      continue;
    await db.job.upsert({
      where: { key: `scheduled-reconcile:${a.id}:${bucket}` },
      create: {
        orgId: a.intent.orgId,
        kind: "payment-reconcile",
        key: `scheduled-reconcile:${a.id}:${bucket}`,
        payload: { attemptId: a.id },
      },
      update: {},
    });
  }
}
