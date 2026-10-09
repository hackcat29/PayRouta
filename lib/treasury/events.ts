// Provider events for PayRouta platform accounts. Each event is verified with
// the provider's own scheme, deduplicated per platform account and then only
// prompts a re-read from the provider's authenticated API: account events
// refresh the sub-account, payment events poll the payment (and its funds
// availability), payout events refresh the payout.
import { db } from "../portal/db";
import { PortalError } from "../portal/domain";
import { atomic } from "../portal/service";
import { hash } from "../payments/contracts";
import { queue } from "../payments/service";
import { platformAdapter } from "./platforms/registry";
import type { PlatformEvent } from "./platforms/contract";
import { refreshDispute } from "./disputes";

async function owner(platformAccountId: string, environment: string, event: PlatformEvent) {
  if (event.kind === "account" && event.accountRef) {
    const link = await db.merchantPlatformLink.findFirst({
      where: { platformAccountId, providerAccountId: event.accountRef },
    });
    return link?.orgId ?? null;
  }
  if (event.kind === "payment" && event.objectRef) {
    const attempt = await db.paymentAttempt.findFirst({
      where: { providerReference: event.objectRef, environment },
      select: { intent: { select: { orgId: true } } },
    });
    return attempt?.intent.orgId ?? null;
  }
  if (event.kind === "payout" && event.objectRef) {
    const payout = await db.payout.findUnique({
      where: { platformAccountId_providerPayoutRef: { platformAccountId, providerPayoutRef: event.objectRef } },
    });
    return payout?.orgId ?? null;
  }
  if (event.kind === "refund" && event.objectRef) {
    const refund = await db.platformRefund.findUnique({
      where: { platformAccountId_providerRefundRef: { platformAccountId, providerRefundRef: event.objectRef } },
    });
    return refund?.orgId ?? null;
  }
  if (event.kind === "dispute" && event.objectRef) {
    const dispute = await db.platformDispute.findUnique({
      where: { platformAccountId_providerDisputeRef: { platformAccountId, providerDisputeRef: event.objectRef } },
    });
    return dispute?.orgId ?? null;
  }
  return null;
}

// Tries each enabled platform account for this provider and environment
// (several PayRouta companies may hold one); the first that verifies owns it.
export async function receivePlatformEvent(provider: string, environment: string, rawBody: string, headers: Headers) {
  const accounts = await db.platformAccount.findMany({ where: { provider, environment, enabled: true } });
  for (const account of accounts) {
    const adapter = platformAdapter(account);
    const event = adapter.verifyEvent ? await adapter.verifyEvent({ rawBody, headers }) : null;
    if (!event) continue;
    const fingerprint = hash(rawBody);
    const org = await owner(account.id, environment, event);
    return atomic(async (tx) => {
      const old = await tx.platformEvent.findUnique({
        where: { platformAccountId_eventId: { platformAccountId: account.id, eventId: event.eventId } },
      });
      if (old) {
        if (old.fingerprint !== fingerprint) throw new PortalError("EVENT_ID_CONFLICT", 409);
        return { accepted: true, duplicate: true };
      }
      const row = await tx.platformEvent.create({
        data: {
          platformAccountId: account.id,
          eventId: event.eventId.slice(0, 200),
          fingerprint,
          type: event.type.slice(0, 100),
          kind: event.kind,
          accountRef: event.accountRef?.slice(0, 200),
          objectRef: event.objectRef?.slice(0, 200),
          // A first dispute event has no owner until the provider's dispute
          // record is read; the worker's sweep processes it directly.
          state: event.kind === "other" ? "Ignored" : org || event.kind === "dispute" ? "Received" : "Unmatched",
        },
      });
      // Unmatched events are kept for inspection; jobs need an owning org.
      if (org && event.kind !== "other")
        await queue(tx, org, "treasury-event", `treasury-event:${row.id}`, { eventId: row.id });
      return { accepted: true };
    });
  }
  throw new PortalError("INVALID_SIGNATURE", 401);
}

export async function processPlatformEvent(eventRowId: string) {
  const e = await db.platformEvent.findUniqueOrThrow({ where: { id: eventRowId } });
  if (e.state !== "Received") return;
  const platform = await db.platformAccount.findUniqueOrThrow({ where: { id: e.platformAccountId } });
  if (e.kind === "dispute" && e.objectRef) {
    await refreshDispute(e.platformAccountId, e.objectRef);
    await db.platformEvent.update({ where: { id: e.id }, data: { state: "Processed" } });
    return;
  }
  await atomic(async (tx) => {
    if (e.kind === "account" && e.accountRef) {
      const link = await tx.merchantPlatformLink.findFirst({
        where: { platformAccountId: e.platformAccountId, providerAccountId: e.accountRef },
      });
      if (link) await queue(tx, link.orgId, "treasury-link-status", `treasury-link-status:${link.id}:event:${e.id}`, { linkId: link.id });
    }
    if (e.kind === "payment" && e.objectRef) {
      const attempt = await tx.paymentAttempt.findFirst({
        where: { providerReference: e.objectRef, environment: platform.environment },
        include: { intent: true },
      });
      if (attempt) {
        await queue(tx, attempt.intent.orgId, "payment-poll", `payment-poll:${attempt.id}:event:${e.id}`, { attemptId: attempt.id });
        const funds = await tx.platformPayment.findUnique({ where: { attemptId: attempt.id } });
        if (funds?.state === "Pending")
          await queue(tx, funds.orgId, "treasury-availability", `treasury-availability:${attempt.id}:event:${e.id}`, { attemptId: attempt.id });
      }
    }
    if (e.kind === "payout" && e.objectRef) {
      const payout = await tx.payout.findUnique({
        where: { platformAccountId_providerPayoutRef: { platformAccountId: e.platformAccountId, providerPayoutRef: e.objectRef } },
      });
      if (payout) await queue(tx, payout.orgId, "treasury-payout-status", `treasury-payout-status:${payout.id}:event:${e.id}`, { payoutId: payout.id });
    }
    if (e.kind === "refund" && e.objectRef) {
      const refund = await tx.platformRefund.findUnique({
        where: { platformAccountId_providerRefundRef: { platformAccountId: e.platformAccountId, providerRefundRef: e.objectRef } },
      });
      if (refund) await queue(tx, refund.orgId, "treasury-refund-status", `treasury-refund-status:${refund.id}:event:${e.id}`, { refundId: refund.id });
    }
    await tx.platformEvent.update({ where: { id: e.id }, data: { state: "Processed" } });
  });
}

// Dispute events received before PayRouta knows the dispute, and periodic
// re-reads of open disputes and pending refunds (webhooks may be missed).
export async function sweepDisputesAndRefunds(now = new Date()) {
  const fresh = await db.platformEvent.findMany({ where: { state: "Received", kind: "dispute" }, take: 50 });
  for (const e of fresh)
    try {
      await processPlatformEvent(e.id);
    } catch (error) {
      // Stays Received (for example the disputed payment's funds are not yet
      // matched) and is retried at the next sweep.
      console.error(JSON.stringify({ event: "treasury.dispute.event-failed", eventId: e.id, error: String(error) }));
    }
  const bucket = Math.floor(now.getTime() / 3600000);
  const open = await db.platformDispute.findMany({ where: { state: "Open", updatedAt: { lt: new Date(now.getTime() - 6 * 3600000) } }, take: 100 });
  for (const d of open)
    await queue(db, d.orgId, "treasury-dispute", `treasury-dispute:${d.id}:${bucket}`, { platformAccountId: d.platformAccountId, reference: d.providerDisputeRef });
  const pending = await db.platformRefund.findMany({ where: { state: "Pending", updatedAt: { lt: new Date(now.getTime() - 30 * 60000) } }, take: 100 });
  for (const r of pending)
    await queue(db, r.orgId, "treasury-refund-status", `treasury-refund-status:${r.id}:${bucket}`, { refundId: r.id });
}
