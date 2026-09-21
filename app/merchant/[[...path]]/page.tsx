import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { identity } from "@/lib/portal/access";
import { merchantMember } from "@/lib/merchant/access";
import { db } from "@/lib/portal/db";
import { intents, settlements } from "@/lib/merchant/service";
import { PortalError, can } from "@/lib/portal/domain";
import { ledger } from "@/lib/payments/ledger";
import { Onboarding } from "./onboarding";
import { merchantMetrics } from "@/lib/merchant/metrics";
import { WebhookControls } from "./webhooks";
import { Keys } from "./keys";
import "@/components/portal/portal.css";
import "./workspace.css";
export const dynamic = "force-dynamic";
const routes = {
  onboarding: "Onboarding",
  overview: "Overview",
  payments: "Payments",
  settlements: "Settlements",
  reconciliation: "Reconciliation",
  analytics: "Analytics",
  "developers/api-keys": "API keys",
  "developers/webhooks": "Webhook deliveries",
  "developers/logs": "API requests",
  settings: "Settings",
  security: "Security",
  team: "Team",
};
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const segments = (await params).path || ["overview"];
  const section =
    segments[0] === "developers" ? segments.slice(0, 2).join("/") : segments[0];
  if (
    !(section in routes) ||
    segments.length > (section.startsWith("developers") ? 2 : 2)
  )
    notFound();
  let user;
  try {
    user = await identity();
  } catch (e) {
    if (e instanceof PortalError && e.status === 401)
      redirect("/provider/sign-in");
    throw e;
  }
  const memberships = await db.membership.findMany({
    where: { userId: user.user.id },
    include: { org: true },
  });
  const configs = await db.merchantConfig.findMany({
    where: { orgId: { in: memberships.map((m) => m.orgId) } },
  });
  const orgId =
    typeof query.orgId === "string" ? query.orgId : configs[0]?.orgId;
  if (!orgId)
    return (
      <div className="portal p-simple">
        <h1>Merchant setup needed</h1>
        <p>Your account has no configured merchant workspace.</p>
        <Link href="/provider/settings">Account settings</Link>
      </div>
    );
  const { config, membership } = await merchantMember(orgId);
  const env =
    typeof query.environment === "string"
      ? query.environment
      : config.environment;
  if (!["sandbox", "production"].includes(env)) notFound();
  const scope = { orgId, environment: env };
  const href = (path: string) =>
    `/merchant/${path}?${new URLSearchParams({ orgId, environment: env })}`;
  const enabled = env === config.environment;
  let content;
  if (!enabled)
    content = (
      <section>
        <h2>
          {env === "production"
            ? "No live access yet"
            : "Sandbox is not configured"}
        </h2>
        <p>
          This merchant is configured for {config.environment}. Contact your
          operator to review the permitted processing scope.
        </p>
      </section>
    );
  else if (section === "onboarding")
    content = can(membership.role, "configure") ? (
      <Onboarding
        orgId={orgId}
        version={config.applicationVersion}
        state={config.applicationState}
        value={config.application as Record<string, unknown>}
      />
    ) : (
      <p>Owner or admin access is required to submit an application.</p>
    );
  else if (section === "payments") {
    const id = segments[1];
    const filters = new URLSearchParams();
    for (const key of ["state", "reference", "cursor"])
      if (typeof query[key] === "string")
        filters.set(key, query[key] as string);
    const result = await intents(scope, filters, id);
    if ("data" in result)
      content = (
        <section>
          <a
            href={`/api/merchant/export?${new URLSearchParams({ orgId, environment: env, from: new Date(Date.now() - 30 * 86400000).toISOString(), to: new Date().toISOString() })}`}
          >
            Export last 30 days (up to 1,000 payments)
          </a>
          <form className="merchant-filters">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="environment" value={env} />
            <label>
              Reference
              <input
                name="reference"
                defaultValue={
                  typeof query.reference === "string" ? query.reference : ""
                }
              />
            </label>
            <label>
              Status
              <select
                name="state"
                defaultValue={
                  typeof query.state === "string" ? query.state : ""
                }
              >
                <option value="">All</option>
                {["Open", "Processing", "Confirmed"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <button>Filter</button>
          </form>
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                  <th>Created (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {result.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={href(`payments/${p.id}`)}>{p.reference}</Link>
                    </td>
                    <td>
                      {p.amount}{" "}
                      {(p.asset as { identifier: string }).identifier}
                    </td>
                    <td>{p.selectedMethod || "Awaiting selection"}</td>
                    <td>
                      {p.state === "Confirmed" ? "Payment confirmed" : p.state}
                    </td>
                    <td>{p.createdAt.toISOString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!result.data.length && <p>No payments match these filters.</p>}
          {result.nextCursor && (
            <Link
              href={`${href("payments")}&${new URLSearchParams({ ...Object.fromEntries(filters), cursor: result.nextCursor })}`}
            >
              Next page
            </Link>
          )}
        </section>
      );
    else {
      const timeline = await db.paymentAttempt.findMany({
        where: { intentId: result.id, intent: scope },
        select: { number: true, state: true, createdAt: true, updatedAt: true },
        orderBy: { number: "asc" },
      });
      content = (
        <section>
          <h2>{result.reference}</h2>
          <p>
            {result.amount}{" "}
            {(result.asset as { identifier: string }).identifier} ·{" "}
            {result.state === "Confirmed" ? "Payment confirmed" : result.state}
          </p>
          <p>Method: {result.selectedMethod || "Awaiting selection"}</p>
          <h3>Execution timeline</h3>
          <ul>
            {timeline.map((a) => (
              <li key={a.number}>
                Attempt {a.number}: {a.state} · {a.updatedAt.toISOString()}
              </li>
            ))}
          </ul>
          <p>
            Payment confirmation and settlement are separate facts. Review
            allocations in Settlements.
          </p>
        </section>
      );
    }
  } else if (section === "settlements") {
    const result = await settlements(
      scope,
      new URLSearchParams(
        typeof query.cursor === "string" ? { cursor: query.cursor } : {},
      ),
      segments[1],
    );
    const rows = "data" in result ? result.data : [result];
    content = (
      <section>
        <p>
          Amounts below are exact minor units for your allocations. Funds are
          handled by the provider.
        </p>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Settlement</th>
                <th>Currency</th>
                <th>Gross</th>
                <th>Fees</th>
                <th>Net</th>
                <th>Status</th>
                <th>Reconciliation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={href(`settlements/${s.id}`)}>{s.id}</Link>
                  </td>
                  <td>{(s.asset as { identifier: string }).identifier}</td>
                  <td>{s.gross}</td>
                  <td>{s.fee}</td>
                  <td>{s.net}</td>
                  <td>{s.state}</td>
                  <td>{s.reconciliation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <p>No settlement records yet.</p>}
        {"nextCursor" in result && result.nextCursor && (
          <Link
            href={`${href("settlements")}&cursor=${encodeURIComponent(result.nextCursor)}`}
          >
            Next page
          </Link>
        )}
        {segments[1] &&
          rows.map((s) => (
            <ul key={s.id}>
              {s.allocations.map((a) => (
                <li key={a.intentId}>
                  <Link href={href(`payments/${a.intentId}`)}>
                    {a.intentId}
                  </Link>{" "}
                  — {a.amount} minor units, fee {a.fee}
                </li>
              ))}
            </ul>
          ))}
      </section>
    );
  } else if (section === "developers/api-keys") {
    if (!can(membership.role, "configure"))
      content = <p>Owner or admin access is required for key management.</p>;
    else {
      const keys = await db.merchantApiKey.findMany({
        where: scope,
        select: { id: true, prefix: true, revokedAt: true, permissions: true },
        take: 100,
        orderBy: { createdAt: "desc" },
      });
      content = (
        <Keys
          orgId={orgId}
          environment={env}
          keys={keys.map((k) => ({
            ...k,
            permissions: k.permissions as string[],
            revokedAt: k.revokedAt?.toISOString() || null,
          }))}
        />
      );
    }
  } else if (section === "developers/logs") {
    const logs = await db.merchantRequest.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    content = (
      <section>
        <p>
          Latest 100 requests. Bodies, credentials, and customer data are
          excluded.
        </p>
        <ul>
          {logs.map((l) => (
            <li key={l.id}>
              {l.createdAt.toISOString()} · {l.operation} · HTTP {l.status} ·{" "}
              {l.durationMs} ms · <code>{l.id}</code>
            </li>
          ))}
        </ul>
        {!logs.length && <p>No API requests yet.</p>}
      </section>
    );
  } else if (section === "developers/webhooks") {
    const events = await db.merchantEvent.findMany({
      where: scope,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const deliveries = await db.merchantDelivery.findMany({
      where: { eventId: { in: events.map((e) => e.id) } },
    });
    content = (
      <WebhookControls
        orgId={orgId}
        url={config.webhookUrl}
        keyId={config.webhookKeyId}
        canManage={can(membership.role, "configure")}
        events={events.map((e) => ({
          id: e.id,
          type: e.type,
          state: deliveries.find((d) => d.eventId === e.id)?.state || "Pending",
        }))}
      />
    );
  } else if (section === "reconciliation") {
    const exceptions = await db.paymentException.findMany({
      where: { intent: scope },
      select: { id: true, intentId: true, state: true, createdAt: true },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    content = (
      <section>
        <p>
          Provider evidence is being checked for these payments. Investigation
          notes remain private.
        </p>
        <ul>
          {exceptions.map((e) => (
            <li key={e.id}>
              <Link href={href(`payments/${e.intentId}`)}>{e.intentId}</Link> ·{" "}
              {e.state} · {e.createdAt.toISOString()}
            </li>
          ))}
        </ul>
        {!exceptions.length && <p>No reconciliation exceptions.</p>}
      </section>
    );
  } else if (section === "analytics") {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    const metrics = await merchantMetrics(orgId, env, from, to);
    content = (
      <section>
        <h2>Last 30 days</h2>
        <p>
          Intent creation cohort: {metrics.from} to {metrics.to}. Current known
          outcomes as of {metrics.reportedAt}.
        </p>
        <p>
          {metrics.confirmed} payment-confirmed intents / {metrics.checkout}{" "}
          intents with a checkout session.
        </p>
        <p>
          {metrics.selected} selected a method. {metrics.fallback} intents used
          an alternate attempt.
        </p>
        <h3>Attempt outcomes</h3>
        <ul>
          {metrics.attempts.map((a) => (
            <li key={a.state}>
              {a.state}: {a.count}
            </li>
          ))}
        </ul>
        <p>
          Each intent counts once for conversion, even if it has multiple
          sessions. Pending and unknown attempts are not failures. Late evidence
          updates these results.
        </p>
        <p>Recognized PayRouta revenue: Not configured.</p>
      </section>
    );
  } else if (section === "team") {
    const team = can(membership.role, "team")
      ? await db.membership.findMany({
          where: { orgId },
          include: { user: { select: { name: true, email: true } } },
          take: 100,
        })
      : [];
    content = (
      <section>
        <h2>Organization membership</h2>
        {can(membership.role, "team") ? (
          <>
            <ul>
              {team.map((m) => (
                <li key={m.id}>
                  {m.user.name} · {m.user.email} · {m.role}
                </li>
              ))}
            </ul>
            <p>
              Membership and invitations use the existing organization team
              controls.
            </p>
            <Link href="/provider/team">Open organization team management</Link>
          </>
        ) : (
          <p>Owner or admin access is required.</p>
        )}
      </section>
    );
  } else if (section === "settings" || section === "security")
    content = (
      <section>
        <h2>{membership.org.name}</h2>
        <p>Operating country: {config.country}</p>
        <p>Registered return origin: {config.returnOrigin}</p>
        <p>Your role: {membership.role}</p>
        <Link href="/provider/settings">
          Manage your session and authenticator
        </Link>
      </section>
    );
  else {
    const balances = await ledger(orgId, env);
    const count = await db.paymentIntent.count({ where: scope });
    content = (
      <section>
        <h2>{env === "sandbox" ? "Sandbox progress" : "Payment overview"}</h2>
        <p>{count} payment intents in this environment.</p>
        <h3>Operational journal totals</h3>
        <p>
          Exact minor units, grouped by original asset and account. These are
          provider-held payment records, not a withdrawable PayRouta balance.
        </p>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th>Account</th>
                <th>Net debit (minor units)</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b) => (
                <tr key={`${b.book}:${b.asset}:${b.account}`}>
                  <td>{b.asset}</td>
                  <td>{b.account}</td>
                  <td>{b.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!balances.length && <p>No posted financial records yet.</p>}
        <p>PayRouta revenue: Not configured.</p>
      </section>
    );
  }
  return (
    <div className="portal merchant-workspace">
      <header>
        <Link href={href("overview")}>PayRouta / {membership.org.name}</Link>
        <strong>{env === "sandbox" ? "Sandbox" : "Live"}</strong>
        <form>
          <input type="hidden" name="orgId" value={orgId} />
          <label>
            Environment
            <select name="environment" defaultValue={env}>
              <option value="sandbox">Sandbox</option>
              <option value="production">Live</option>
            </select>
          </label>
          <button>Switch</button>
        </form>
      </header>
      <div className="merchant-body">
        <nav aria-label="Merchant workspace">
          {Object.entries(routes).map(([path, label]) => (
            <Link
              key={path}
              href={href(path)}
              aria-current={section === path ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <article>
          <h1>{routes[section as keyof typeof routes]}</h1>
          {content}
        </article>
      </div>
    </div>
  );
}
