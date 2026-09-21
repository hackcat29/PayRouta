import Link from "next/link";
import { internal } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import { operationalMetrics } from "@/lib/merchant/telemetry";
import "@/components/portal/portal.css";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ environment?: string }>;
}) {
  try {
    await internal();
  } catch (error) {
    if (error instanceof PortalError)
      return (
        <div className="portal p-simple">
          <h1>Operations verification required</h1>
          <Link href="/provider/settings">Verify your authenticator</Link>
        </div>
      );
    throw error;
  }
  const environment =
    (await searchParams).environment === "production"
      ? "production"
      : "sandbox";
  const data = await operationalMetrics(environment);
  return (
    <div className="portal p-simple">
      <Link href="/ops/payments">Payment operations</Link>
      <h1>Operational health · {environment}</h1>
      <form>
        <label htmlFor="ops-environment">Environment</label>
        <select
          id="ops-environment"
          name="environment"
          defaultValue={environment}
        >
          <option value="sandbox">Sandbox</option>
          <option value="production">Live</option>
        </select>
        <button>Switch</button>
      </form>
      <p>
        API observation window: {data.from} to {data.to}. Empty samples do not
        establish reliability.
      </p>
      <h2>API requests</h2>
      <ul>
        {data.requests.map((r) => (
          <li key={r.status}>
            HTTP {r.status}: {r.count} requests; mean {r.averageMs?.toFixed(0)}{" "}
            ms
          </li>
        ))}
      </ul>
      <h2>Investigation signals</h2>
      <p>
        {data.unknownOverFiveMinutes} unknown attempts older than five minutes.{" "}
        {data.unbalancedEntries} unbalanced posted journal entries.
      </p>
      <p>
        {data.inbox.pending} pending provider inbox records. Oldest:{" "}
        {data.inbox.oldestAt || "None"}.
      </p>
      <h2>Webhook delivery</h2>
      <ul>
        {data.deliveries.map((d) => (
          <li key={d.state}>
            {d.state}: {d.count}
          </li>
        ))}
      </ul>
      <h2>Reconciliation</h2>
      <ul>
        {data.exceptions.map((e) => (
          <li key={e.code}>
            {e.code}: {e.count}; oldest {e.oldestAt}
          </li>
        ))}
      </ul>
      <h2>Worker queue</h2>
      <p>{data.queueScope}</p>
      <ul>
        {data.queue.map((q) => (
          <li key={`${q.kind}:${q.state}`}>
            {q.kind} · {q.state}: {q.count}; oldest {q.oldestAt}
          </li>
        ))}
      </ul>
      <p>
        Database diagnostic query duration: {data.databaseQueryMs} ms. Runbooks:
        docs/MERCHANT-OPERATIONS.md.
      </p>
    </div>
  );
}
