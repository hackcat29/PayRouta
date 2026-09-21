import { db } from "../portal/db";
export async function operationalMetrics(
  environment: "sandbox" | "production",
  now = new Date(),
) {
  const from = new Date(now.getTime() - 3600000);
  const started = performance.now();
  const [
    requests,
    unknown,
    deliveries,
    inbox,
    exceptions,
    queue,
    journalViolations,
  ] = await Promise.all([
    db.merchantRequest.groupBy({
      by: ["status"],
      where: { environment, createdAt: { gte: from } },
      _count: true,
      _avg: { durationMs: true },
    }),
    db.paymentAttempt.count({
      where: {
        environment,
        state: "Unknown",
        updatedAt: { lt: new Date(now.getTime() - 5 * 60000) },
      },
    }),
    db.$queryRaw<
      { state: string; count: string }[]
    >`SELECT d.state,COUNT(*)::text AS count FROM "MerchantDelivery" d JOIN "MerchantEvent" e ON e.id=d."eventId" WHERE e.environment=${environment} GROUP BY d.state`,
    db.paymentInbox.aggregate({
      where: { environment, state: "Pending" },
      _count: true,
      _min: { createdAt: true },
    }),
    db.paymentException.groupBy({
      by: ["code"],
      where: { intent: { environment }, state: { not: "Resolved" } },
      _count: true,
      _min: { createdAt: true },
    }),
    db.job.groupBy({
      by: ["kind", "state"],
      _count: true,
      _min: { createdAt: true },
    }),
    db.$queryRaw<
      { count: string }[]
    >`SELECT COUNT(*)::text AS count FROM (SELECT e.id FROM "JournalEntry" e JOIN "JournalPosting" p ON p."entryId"=e.id WHERE e.environment=${environment} GROUP BY e.id HAVING SUM(p.debit)<>SUM(p.credit)) invalid`,
  ]);
  return {
    environment,
    from: from.toISOString(),
    to: now.toISOString(),
    requests: requests.map((r) => ({
      status: r.status,
      count: r._count,
      averageMs: r._avg.durationMs,
    })),
    unknownOverFiveMinutes: unknown,
    deliveries,
    inbox: {
      pending: inbox._count,
      oldestAt: inbox._min.createdAt?.toISOString() || null,
    },
    exceptions: exceptions.map((e) => ({
      code: e.code,
      count: e._count,
      oldestAt: e._min.createdAt?.toISOString() || null,
    })),
    queue: queue.map((q) => ({
      kind: q.kind,
      state: q.state,
      count: q._count,
      oldestAt: q._min.createdAt?.toISOString() || null,
    })),
    queueScope: "All environments; jobs do not have an environment column",
    unbalancedEntries: journalViolations[0]?.count || "0",
    databaseQueryMs: Math.round(performance.now() - started),
  };
}
