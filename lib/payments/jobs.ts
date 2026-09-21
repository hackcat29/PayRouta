import { importSimulatorReport } from "./reports";
import { db } from "../portal/db";
import { dispatch, poll, settle, reconcile, applyFact } from "./processing";
import { deliver } from "./delivery";
export async function paymentJob(kind: string, p: Record<string, string>) {
  if (kind === "payment-report") await importSimulatorReport(p.integrationId);
  else if (kind === "payment-dispatch") await dispatch(p.attemptId);
  else if (kind === "payment-poll") await poll(p.attemptId);
  else if (kind === "payment-settle") await settle(p.attemptId);
  else if (kind === "payment-reconcile") await reconcile(p.attemptId);
  else if (kind === "payment-delivery") await deliver(p.eventId);
  else if (kind === "payment-inbox") {
    const inbox = await db.paymentInbox.findUniqueOrThrow({
      where: { id: p.inboxId },
    });
    if (inbox.state === "Processed") return;
    const payload = inbox.payload as { reference: string; type: string };
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
    if (
      a.state === "Confirmed" &&
      (await db.paymentReconciliation.findFirst({
        where: { intentId: a.intentId, result: "Exact match" },
      }))
    )
      continue;
    if (now.getTime() - a.createdAt.getTime() > 86400000) continue; // Exhaustion is visible; never infer failure.
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
