import { db } from "../portal/db";
export const metricDictionary = {
  checkoutConversion:
    "Distinct confirmed intents / distinct intents with a session created in the intent creation cohort. Current known state at reporting time; late confirmation changes the numerator.",
  methodSelection:
    "Distinct cohort intents with a selected method / distinct cohort intents with at least one checkout session.",
  attemptOutcomes:
    "Attempt counts grouped by current state for intents created in the cohort. Unknown and pending remain separate; not a percentage of only completed attempts.",
  volume:
    "Confirmed original amounts grouped by original asset and precision. Financial accounting totals come from journal postings; no currency conversion.",
  revenue:
    "Recognized PayRouta fees from the journal. Not configured; never equated with payment volume or provider fees.",
  settlementTime:
    "Payment-confirmed event time to completed settlement evidence time; unavailable until both milestones exist.",
  availability:
    "Eligible method evaluations / applicable evaluations with context and unknown outcomes retained. Current aggregate not implemented.",
  fallback:
    "Distinct routed intents with attempt number > 1 / distinct routed intents. Recovery: confirmed among fallback intents; unknown and pending separate.",
  routingLatency:
    "Routing decision duration only; excludes customer and provider wait. Instrumentation pending.",
  webhookDelivery:
    "Delivery state and attempts for merchant events in the event creation window; retries are not new events.",
  reconciliationExceptions:
    "Open exceptions by category and age; amount totals grouped by original asset, not mixed currencies.",
} as const;
// Financial journal remains authoritative; this module measures execution cohorts only.
export async function merchantMetrics(
  orgId: string,
  environment: string,
  from: Date,
  to: Date,
) {
  if (
    !Number.isFinite(from.getTime()) ||
    !Number.isFinite(to.getTime()) ||
    to <= from ||
    to.getTime() - from.getTime() > 31 * 86400000
  )
    throw new Error("INVALID_METRIC_WINDOW");
  const where = {
    pilotBatchId: null,
    orgId,
    environment,
    createdAt: { gte: from, lt: to },
  };
  const [intents, checkout, confirmed, selected, attempts, fallback] =
    await Promise.all([
      db.paymentIntent.count({ where }),
      db.paymentIntent.count({ where: { ...where, sessions: { some: {} } } }),
      db.paymentIntent.count({
        where: { ...where, state: "Confirmed", sessions: { some: {} } },
      }),
      db.paymentIntent.count({
        where: {
          ...where,
          selectedMethod: { not: null },
          sessions: { some: {} },
        },
      }),
      db.paymentAttempt.groupBy({
        by: ["state"],
        where: { intent: where },
        _count: true,
      }),
      db.paymentIntent.count({
        where: { ...where, attempts: { some: { number: { gt: 1 } } } },
      }),
    ]);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    reportedAt: new Date().toISOString(),
    environment,
    intents,
    checkout,
    confirmed,
    selected,
    attempts: attempts.map((a) => ({ state: a.state, count: a._count })),
    fallback,
    revenue: null,
  };
}
