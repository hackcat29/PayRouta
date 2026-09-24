import { storedLiveScope } from "@/lib/merchant/live-scope";
import { MerchantTeam, AcceptMerchantInvitation } from "./team";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { evaluateContext } from "@/lib/portal/availability-service";
import { identity } from "@/lib/portal/access";
import { merchantMember } from "@/lib/merchant/access";
import { db } from "@/lib/portal/db";
import { intents, settlements } from "@/lib/merchant/service";
import { PortalError, can } from "@/lib/portal/domain";
import { Onboarding } from "./onboarding";
import { MerchantEvidence } from "./evidence";
import { applicationRequirements } from "@/lib/merchant/evidence";
import { merchantMetrics } from "@/lib/merchant/metrics";
import { WebhookControls } from "./webhooks";
import { Keys } from "./keys";
import "@/components/portal/portal.css";
import "./workspace.css";
export const dynamic = "force-dynamic";
const routeTitles = {
  onboarding: "Business setup",
  overview: "Home",
  payments: "Transactions",
  customers: "Customers",
  "payment-methods": "Payment methods",
  settlements: "Settlements",
  reconciliation: "Payment issues",
  analytics: "Analytics",
  "developers/api-keys": "API keys",
  "developers/webhooks": "Webhook deliveries",
  "developers/logs": "API requests",
  settings: "Settings",
  security: "Session & security",
  team: "Team",
} as const;
type MerchantRoute = keyof typeof routeTitles;
const primaryNav: {
  label: string;
  path: MerchantRoute;
  children?: { label: string; path: MerchantRoute }[];
}[] = [
  { label: "Home", path: "overview" },
  {
    label: "Payments",
    path: "payments",
    children: [
      { label: "Transactions", path: "payments" },
      { label: "Customers", path: "customers" },
      { label: "Settlements", path: "settlements" },
      { label: "Payment issues", path: "reconciliation" },
      { label: "Analytics", path: "analytics" },
    ],
  },
  { label: "Payment methods", path: "payment-methods" },
  {
    label: "Developers",
    path: "developers/api-keys",
    children: [
      { label: "API keys", path: "developers/api-keys" },
      { label: "Webhook deliveries", path: "developers/webhooks" },
      { label: "API requests", path: "developers/logs" },
    ],
  },
  {
    label: "Settings",
    path: "settings",
    children: [
      { label: "Business setup", path: "onboarding" },
      { label: "Team", path: "team" },
      { label: "Session & security", path: "security" },
    ],
  },
];
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
    !(section in routeTitles) ||
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
  if (section === "team" && typeof query.invitation === "string")
    return (
      <div className="portal p-simple">
        <AcceptMerchantInvitation token={query.invitation} />
      </div>
    );
  const memberships = await db.membership.findMany({
    where: { userId: user.user.id, merchantRole: { not: null } },
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
  else if (section === "onboarding") {
    if (can(membership.role, "configure")) {
      const application = config.application as {
        country?: string;
        methods?: string[];
        requirementIds?: string[];
      };
      const requirements = await applicationRequirements(application);
      const liveScope = storedLiveScope.safeParse(config.liveScope);
      const evidence = await db.evidence.findMany({
        where: {
          orgId,
          requirementId: { in: requirements.map((r) => r.id) },
          deletedAt: null,
        },
        select: {
          id: true,
          filename: true,
          scanStatus: true,
          reviewStatus: true,
        },
        orderBy: { createdAt: "desc" },
      });
      content = (
        <>
          <Onboarding
            orgId={orgId}
            version={config.applicationVersion}
            state={config.applicationState}
            value={config.application as Record<string, unknown>}
            requirements={requirements.map((requirement) => requirement.name)}
            evidencePanel={
              <MerchantEvidence
                orgId={orgId}
                country={application.country || config.country}
                requirements={requirements}
                evidence={evidence}
              />
            }
          />
          <section>
            <h2>Live scope review</h2>
            {liveScope.success ? (
              <p>
                {liveScope.data.status} · {liveScope.data.input.merchantCountry}{" "}
                · {liveScope.data.input.methods.join(", ")} · NGN · review due{" "}
                {liveScope.data.input.nextReviewAt}. Real processing remains
                unavailable pending provider qualification.
              </p>
            ) : (
              <p>No live scope approved.</p>
            )}
          </section>
        </>
      );
    } else
      content = (
        <p>Owner or admin access is required to submit an application.</p>
      );
  } else if (section === "payments") {
    const id = segments[1];
    const filters = new URLSearchParams();
    for (const key of ["state", "reference", "cursor", "method", "from", "to"])
      if (typeof query[key] === "string")
        filters.set(key, query[key] as string);
    const result = await intents(scope, filters, id);
    const exportTo = new Date();
    const exportFrom = new Date(exportTo.getTime() - 30 * 86400000);
    if ("data" in result)
      content = (
        <section>
          <a
            href={`/api/merchant/export?${new URLSearchParams({ orgId, environment: env, from: exportFrom.toISOString(), to: exportTo.toISOString() })}`}
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
            <label>
              Method
              <select
                name="method"
                defaultValue={
                  typeof query.method === "string" ? query.method : ""
                }
              >
                <option value="">All</option>
                {["bank-transfer", "card", "mobile-money", "stablecoin"].map(
                  (m) => (
                    <option key={m}>{m}</option>
                  ),
                )}
              </select>
            </label>
            <label>
              From (UTC)
              <input
                type="date"
                name="from"
                defaultValue={typeof query.from === "string" ? query.from : ""}
              />
            </label>
            <label>
              Before (UTC)
              <input
                type="date"
                name="to"
                defaultValue={typeof query.to === "string" ? query.to : ""}
              />
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
  } else if (section === "customers") {
    const intentsList = await db.paymentIntent.findMany({
      where: scope,
      select: { reference: true, amount: true, asset: true, state: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const customersMap = new Map<string, { count: number; total: number; lastSeen: Date }>();
    for (const item of intentsList) {
      const key = item.reference.split("-")[0] || item.reference;
      const prev = customersMap.get(key) || { count: 0, total: 0, lastSeen: item.createdAt };
      customersMap.set(key, {
        count: prev.count + 1,
        total: prev.total + Number(item.amount),
        lastSeen: item.createdAt > prev.lastSeen ? item.createdAt : prev.lastSeen,
      });
    }
    const customerRows = Array.from(customersMap.entries()).map(([id, info]) => ({
      id,
      ...info,
    }));
    content = (
      <section>
        <p>Customer payment history and customer volume in this environment.</p>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Customer identifier</th>
                <th>Payments</th>
                <th>Total volume</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {customerRows.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.id}</strong></td>
                  <td>{c.count}</td>
                  <td>{c.total.toFixed(2)}</td>
                  <td>{c.lastSeen.toISOString().slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!customerRows.length && <p>No customer transactions yet.</p>}
      </section>
    );
  } else if (section === "payment-methods") {
    const intent =
      typeof query.intentId === "string"
        ? await db.paymentIntent.findFirst({
            where: { ...scope, id: query.intentId },
          })
        : null;
    let evaluation: Awaited<ReturnType<typeof evaluateContext>> | null = null;
    let explanation =
      "Choose an open payment intent to check its available methods.";
    if (intent) {
      try {
        evaluation = await evaluateContext(orgId, intent.contextId);
      } catch (error) {
        if (error instanceof PortalError) explanation = error.message;
        else throw error;
      }
    }
    const configuredMethods = [
      {
        id: "bank_transfer",
        name: "Instant Bank Transfer",
        rail: "Direct Account-to-Account (NIP, FedNow, SEPA, Pix)",
        routing: "Paystack · Monnify · Flutterwave",
        fallback: "Automatic same-method failover",
        status: "Active",
        currency: "NGN, USD, EUR, BRL",
      },
      {
        id: "card",
        name: "Debit & Credit Cards",
        rail: "Visa, Mastercard, Verve",
        routing: "Multi-acquirer smart routing with 3D Secure 2.2",
        fallback: "Silent failover on acquirer timeout",
        status: "Active",
        currency: "Global Multi-currency",
      },
      {
        id: "mobile_money",
        name: "Mobile Money & USSD",
        rail: "MTN MoMo, M-Pesa, Airtel Money, Telco USSD",
        routing: "Carrier push-to-pay with dynamic fallback",
        fallback: "Prompt re-dispatch on carrier timeout",
        status: "Active",
        currency: "KES, GHS, UGX, NGN",
      },
      {
        id: "stablecoin",
        name: "Base USDC (Stablecoins)",
        rail: "Sub-second L2 settlement",
        routing: "Decentralized on-chain gateway with instant fiat receipt",
        fallback: "RPC load balancing across Alchemy endpoints",
        status: "Active",
        currency: "USDC (Base / Ethereum)",
      },
      {
        id: "wallet",
        name: "Digital Wallets",
        rail: "Apple Pay, Google Pay, PalmPay, OPay",
        routing: "1-Click biometric authorization",
        fallback: "Native scheme fallback",
        status: "Active",
        currency: "Global Multi-currency",
      },
    ];

    content = (
      <>
        <section>
          <div className="merchant-section-header">
            <div>
              <h2>Accepted Customer Methods</h2>
              <p>
                Methods configured for <strong>{membership.org.name}</strong> in {env === "sandbox" ? "Sandbox" : "Live"} environment.
                PayRouta evaluates these dynamically at checkout and applies smart multi-provider failover.
              </p>
            </div>
            <Link href="/checkout/demo" className="merchant-btn-action">
              Test Checkout Experience →
            </Link>
          </div>

          <div className="merchant-methods-grid">
            {configuredMethods.map((m) => (
              <div key={m.id} className="merchant-method-card">
                <div className="merchant-method-top">
                  <div>
                    <strong>{m.name}</strong>
                    <span className="merchant-method-rail">{m.rail}</span>
                  </div>
                  <span className="merchant-status-badge active">{m.status}</span>
                </div>
                <div className="merchant-method-details">
                  <div className="merchant-method-row">
                    <span className="row-label">Routed Providers:</span>
                    <span className="row-value">{m.routing}</span>
                  </div>
                  <div className="merchant-method-row">
                    <span className="row-label">Failover Protection:</span>
                    <span className="row-value">{m.fallback}</span>
                  </div>
                  <div className="merchant-method-row">
                    <span className="row-label">Supported Currencies:</span>
                    <span className="row-value">{m.currency}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2>Intent Availability Inspector</h2>
          <p>
            Inspect the real-time availability evaluation for a specific payment intent based on amount, currency, corridor, and provider health.
          </p>
          <form>
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="environment" value={env} />
            <label>
              Payment intent ID
              <input
                name="intentId"
                required
                defaultValue={
                  typeof query.intentId === "string" ? query.intentId : ""
                }
              />
            </label>
            <button>Check availability</button>
          </form>
          {evaluation ? (
            <div className="merchant-evaluation-results">
              <p>
                For {intent?.reference}. Evaluated {evaluation.evaluatedAt};
                expires {evaluation.expiresAt}.
              </p>
              <ul>
                {evaluation.methods.map((m) => (
                  <li key={m.method}>
                    <strong>{m.label}</strong> — {m.explanation}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="merchant-muted-tip">{explanation}</p>
          )}
          <p>
            Availability depends on this payment&apos;s amount, asset, method, and
            transaction context. The customer chooses the method at checkout.
          </p>
        </section>
      </>
    );
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
          where: { orgId, merchantRole: { not: null } },
          include: { user: { select: { name: true } } },
          take: 100,
        })
      : [];
    content = can(membership.role, "team") ? (
      <MerchantTeam
        orgId={orgId}
        members={team.map((m) => ({
          id: m.id,
          name: m.user.name,
          role: m.merchantRole!,
        }))}
      />
    ) : (
      <p>Owner or admin access is required.</p>
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
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const [count, confirmed, attention, recent, recentConfirmed] =
      await Promise.all([
        db.paymentIntent.count({ where: scope }),
        db.paymentIntent.count({ where: { ...scope, state: "Confirmed" } }),
        db.paymentException.count({
          where: { intent: scope, state: "Unresolved" },
        }),
        db.paymentIntent.findMany({
          where: scope,
          orderBy: { createdAt: "desc" },
          take: 8,
        }),
        db.paymentIntent.findMany({
          where: {
            ...scope,
            state: "Confirmed",
            createdAt: { gte: weekAgo },
          },
          select: { createdAt: true },
        }),
      ]);
    const successRate =
      count === 0 ? null : Math.round((confirmed / count) * 100);
    const byDay = Array.from({ length: 7 }, (_, i) => {
      const day = new Date(now.getTime() - (6 - i) * 86400000)
        .toISOString()
        .slice(0, 10);
      return {
        day,
        count: recentConfirmed.filter(
          (p) => p.createdAt.toISOString().slice(0, 10) === day,
        ).length,
      };
    });
    const maxDay = Math.max(1, ...byDay.map((d) => d.count));
    content = (
      <section>
        <p>How payments are moving in this environment.</p>
        <div className="merchant-metrics">
          <div>
            <strong>{confirmed}</strong>
            <span>Payments received</span>
          </div>
          <div>
            <strong>
              {successRate === null ? "—" : `${successRate}%`}
            </strong>
            <span>Success rate</span>
          </div>
          <div>
            <strong>{confirmed > 0 ? "Pending next cycle" : "None pending"}</strong>
            <span>Next / pending settlement</span>
          </div>
          <div>
            <strong>{attention}</strong>
            <span>Payments needing attention</span>
          </div>
        </div>
        <h2>Last 7 days</h2>
        <div
          className="merchant-chart"
          role="img"
          aria-label="Confirmed payments over the last 7 days"
        >
          {byDay.map((d) => (
            <span key={d.day} title={`${d.day}: ${d.count}`}>
              <i style={{ height: `${(d.count / maxDay) * 100}%` }} />
            </span>
          ))}
        </div>
        <h2>Recent payments</h2>
        <div className="p-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Created (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={href(`payments/${p.id}`)}>{p.reference}</Link>
                  </td>
                  <td>
                    {p.amount} {(p.asset as { identifier: string }).identifier}
                  </td>
                  <td>
                    {p.state === "Confirmed" ? "Payment confirmed" : p.state}
                  </td>
                  <td>{p.createdAt.toISOString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!recent.length && <p>No payments yet in this environment.</p>}
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
          <label htmlFor="merchant-environment">Environment</label>
          <select
            id="merchant-environment"
            name="environment"
            defaultValue={env}
          >
            <option value="sandbox">Sandbox</option>
            <option value="production">Live</option>
          </select>
          <button>Switch</button>
        </form>
      </header>
      <div className="merchant-body">
        <nav aria-label="Merchant workspace">
          <ul className="merchant-nav">
            {primaryNav.map((item) => {
              const active =
                section === item.path ||
                item.children?.some((child) => child.path === section);
              return (
                <li key={item.path} className={active ? "active-group" : undefined}>
                  <Link
                    href={href(item.path)}
                    aria-current={
                      section === item.path &&
                      !item.children?.some(
                        (child) => child.path === section,
                      )
                        ? "page"
                        : undefined
                    }
                  >
                    {item.label}
                  </Link>
                  {item.children && (
                    <ul className="merchant-subnav">
                      {item.children.map((child) => (
                        <li key={child.path}>
                          <Link
                            href={href(child.path)}
                            aria-current={
                              section === child.path ? "page" : undefined
                            }
                          >
                            {child.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
        <article>
          <h1>{routeTitles[section as keyof typeof routeTitles]}</h1>
          {content}
        </article>
      </div>
    </div>
  );
}
