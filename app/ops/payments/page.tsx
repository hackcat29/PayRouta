import Link from "next/link";
import { redirect } from "next/navigation";
import { PortalError } from "@/lib/portal/domain";
import { internal } from "@/lib/portal/access";
import { db } from "@/lib/portal/db";
import { PaymentOperations } from "./view";
import "@/components/portal/portal.css";
export const dynamic = "force-dynamic";
export default async function Page() {
  try {
    await internal();
  } catch (error) {
    if (error instanceof PortalError && error.status === 401)
      redirect("/provider/sign-in");
    if (error instanceof PortalError)
      return (
        <div className="portal p-simple">
          <h1>Operations verification required</h1>
          <p>{error.message}</p>
          <Link href="/provider/settings">Open account security</Link>
        </div>
      );
    throw error;
  }
  const [attempts, exceptions, deliveries, journal, routes, runs] =
    await Promise.all([
      db.paymentAttempt.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
        include: { intent: { select: { reference: true, orgId: true } } },
      }),
      db.paymentException.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
      }),
      db.merchantDelivery.findMany({
        take: 50,
        orderBy: { updatedAt: "desc" },
      }),
      db.journalEntry.findMany({
        take: 50,
        orderBy: { createdAt: "desc" },
        include: { postings: true },
      }),
      db.paymentRoute.findMany({ take: 20, orderBy: { createdAt: "desc" } }),
      db.paymentReconciliation.findMany({
        take: 20,
        orderBy: { createdAt: "desc" },
      }),
    ]);
  return (
    <div className="portal p-simple">
      <Link href="/ops/applications">← Operations</Link>
      <h1>Payments and settlement</h1>
      <PaymentOperations
        attempts={attempts.map((a) => ({
          id: a.id,
          reference: a.intent.reference,
          state: a.state,
          provider: a.providerOrgId,
        }))}
        exceptions={exceptions.map((e) => ({
          id: e.id,
          code: e.code,
          state: e.state,
          evidence: JSON.stringify(e.evidence),
        }))}
        deliveries={deliveries.map((d) => ({
          eventId: d.eventId,
          state: d.state,
          attempts: d.attempts,
        }))}
      />
      <h2>Route explanations</h2>
      {routes.map((r) => (
        <details key={r.id}>
          <summary>
            {r.method} · {r.policy} · {r.id}
          </summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(r.snapshot, null, 2)}
          </pre>
        </details>
      ))}
      <h2>Reconciliation evidence</h2>
      {runs.map((r) => (
        <details key={r.id}>
          <summary>
            {r.intentId} · {r.result}
          </summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {JSON.stringify(r.evidence, null, 2)}
          </pre>
        </details>
      ))}
      <h2>Immutable operational journal</h2>
      <p>
        Provider and merchant movements outside PayRouta custody. Amounts are
        exact minor units.
      </p>
      {journal.map((e) => (
        <details key={e.id}>
          <summary>
            {e.purpose} · {e.asset}
          </summary>
          <p>
            {e.source} · {e.book}
          </p>
          {e.postings.map((p) => (
            <p key={p.id}>
              {p.account}: debit {p.debit.toString()}, credit{" "}
              {p.credit.toString()}
            </p>
          ))}
        </details>
      ))}
    </div>
  );
}
