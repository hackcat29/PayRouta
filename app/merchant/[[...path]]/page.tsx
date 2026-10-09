import { merchantConfiguration } from "@/lib/merchant/configuration";
import { transactionExplorer } from "@/lib/blockchain/chains";
import { Providers } from "./providers";
import { partnerOverview } from "@/lib/partners/service";
import { paymentAsset as tokenAsset } from "@/lib/blockchain/crypto-assets";
import { labelOf } from "@/lib/providers/normalized";
import { CryptoPayments } from "./crypto-payments";
import { onchainMethod } from "@/lib/blockchain/crypto-assets";
import { Stablecoins } from "./stablecoins";
import { stablecoinOverview } from "@/lib/merchant/stablecoins";
import { feeTotals } from "@/lib/payments/billing";
import { formatFee } from "@/lib/payments/pricing";
import { storedLiveScope } from "@/lib/merchant/live-scope";
import { MerchantTeam, AcceptMerchantInvitation } from "./team";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

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

import { CreateWorkspace } from "./create-workspace";
import { merchantTreasury, paymentFunds } from "@/lib/treasury/views";
import {
  ActivationSection,
  BalancesSection,
  DisputesSection,
  PaymentFundsPanel,
  TreasuryBanner,
} from "./treasury-sections";

import "@/components/portal/portal.css";
import "./workspace.css";
import "./treasury.css";
const assetLabel = (raw: unknown) => {
  const a = raw as { identifier: string; network?: string };
  return tokenAsset(a.network || "", a.identifier)?.symbol || a.identifier;
};
export const dynamic = "force-dynamic";
const routeTitles = {
  onboarding: "Business setup",
  activation: "Activate payments",
  balances: "Balances & payouts",
  disputes: "Disputes",
  overview: "Home",
  payments: "Transactions",
  customers: "Customers",
  "payment-methods": "Payment methods",
  providers: "Payment providers",
  settlements: "Settlements",
  reconciliation: "Payment issues",
  analytics: "Analytics",
  billing: "Billing",
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
      { label: "Balances & payouts", path: "balances" },
      { label: "Disputes", path: "disputes" },
      { label: "Customers", path: "customers" },
      { label: "Settlements", path: "settlements" },
      { label: "Payment issues", path: "reconciliation" },
      { label: "Analytics", path: "analytics" },
    ],
  },
  { label: "Payment methods", path: "payment-methods" },
  { label: "Payment providers", path: "providers" },
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
      { label: "Activate payments", path: "activation" },
      { label: "Business setup", path: "onboarding" },
      { label: "Billing", path: "billing" },
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
      redirect("/provider/sign-in?next=/merchant");
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
        <CreateWorkspace />
      </div>
    );
  const { config, membership } = await merchantMember(orgId);
  const providerMember = memberships.length
    ? await db.membership.findFirst({
        where: { userId: user.user.id, merchantRole: null },
        select: { id: true },
      })
    : null;
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
                · {liveScope.data.input.methods.map(labelOf).join(", ")} ·{" "}
                {liveScope.data.input.asset} · review due{" "}
                {liveScope.data.input.nextReviewAt}. Live processing also
                requires current screening, evidence, billing terms and unused
                receive addresses.
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
                    <option key={m} value={m}>
                      {labelOf(m)}
                    </option>
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
                      {p.amount} {assetLabel(p.asset)}
                    </td>
                    <td>
                      {p.selectedMethod
                        ? labelOf(p.selectedMethod)
                        : "Awaiting selection"}
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
      const chainClaims = await db.depositClaim.findMany({
        where: {
          attemptId: {
            in: (
              await db.paymentAttempt.findMany({
                where: { intentId: result.id, intent: scope },
                select: { id: true },
              })
            ).map((a) => a.id),
          },
        },
      });
      content = (
        <section>
          <h2>{result.reference}</h2>
          {chainClaims.map((c) => (
            <p key={c.id}>
              Verified transfer:{" "}
              <a
                href={transactionExplorer(c.network, c.txHash)}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on the explorer
              </a>
            </p>
          ))}
          <p>
            {result.amount} {assetLabel(result.asset)} ·{" "}
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
          {await paymentFunds(result.id).then(
            (funds) =>
              funds && (
                <PaymentFundsPanel
                  orgId={orgId}
                  intentId={result.id}
                  funds={funds}
                  canRefund={can(membership.role, "configure")}
                />
              ),
          )}
        </section>
      );
    }
  } else if (section === "activation") {
    const view = await merchantTreasury(orgId, env);
    const overview = await partnerOverview(orgId, env);
    const profile = (overview.profile?.data ?? overview.draft ?? {}) as {
      country?: string;
      settlementCurrency?: string;
      owners?: { givenName: string; familyName: string }[];
    };
    content = can(membership.role, "configure") ? (
      <ActivationSection
        orgId={orgId}
        view={view}
        country={profile.country ?? config.country}
        currency={profile.settlementCurrency}
        ownerNames={(overview.profile?.data.owners ?? []).map((o) => `${o.givenName} ${o.familyName}`)}
        profilePanel={
          <Providers profileOnly orgId={orgId} overview={overview} canConfigure={can(membership.role, "configure")} />
        }
      />
    ) : (
      <p>Owner or admin access is required to activate payments.</p>
    );
  } else if (section === "balances") {
    content = <BalancesSection orgId={orgId} view={await merchantTreasury(orgId, env)} href={href} />;
  } else if (section === "disputes") {
    content = (
      <DisputesSection
        orgId={orgId}
        view={await merchantTreasury(orgId, env)}
        href={href}
        canRespond={can(membership.role, "configure")}
      />
    );
  } else if (section === "customers") {
    const intentsList = await db.paymentIntent.findMany({
      where: scope,
      select: {
        reference: true,
        amount: true,
        asset: true,
        state: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const customersMap = new Map<
      string,
      { count: number; total: number; lastSeen: Date }
    >();
    for (const item of intentsList) {
      const key = item.reference.split("-")[0] || item.reference;
      const prev = customersMap.get(key) || {
        count: 0,
        total: 0,
        lastSeen: item.createdAt,
      };
      customersMap.set(key, {
        count: prev.count + 1,
        total: prev.total + Number(item.amount),
        lastSeen:
          item.createdAt > prev.lastSeen ? item.createdAt : prev.lastSeen,
      });
    }
    const customerRows = Array.from(customersMap.entries()).map(
      ([id, info]) => ({
        id,
        ...info,
      }),
    );
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
                  <td>
                    <strong>{c.id}</strong>
                  </td>
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
  } else if (section === "providers" || section === "payment-methods") {
    content = (
      <>
        <Stablecoins
          orgId={orgId}
          environment={env}
          accounts={(await stablecoinOverview(orgId, env)).filter(
            (a) => onchainMethod(a.network, a.identifier) === "stablecoin",
          )}
          country={config.country}
          readiness={(await merchantConfiguration(orgId, env)).stablecoinAssets}
          canConfigure={can(membership.role, "configure")}
        />
        <CryptoPayments
          orgId={orgId}
          environment={env}
          country={config.country}
          assets={(await merchantConfiguration(orgId, env)).cryptoAssets}
          stablecoinAssets={
            (await merchantConfiguration(orgId, env)).stablecoinAssets
          }
          accounts={(await stablecoinOverview(orgId, env)).filter(
            (a) => onchainMethod(a.network, a.identifier) === "crypto-app",
          )}
          canConfigure={can(membership.role, "configure")}
        />
        {section === "providers" && (
          <Providers
            profileOnly
            orgId={orgId}
            overview={await partnerOverview(orgId, env)}
            canConfigure={can(membership.role, "configure")}
          />
        )}
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
  } else if (section === "billing") {
    const month =
      typeof query.month === "string" &&
      /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)
        ? query.month
        : new Date().toISOString().slice(0, 7);
    const totals = await feeTotals(orgId, env, month);
    const statements = await db.billingStatement.findMany({
      where: { orgId, environment: env, month },
      orderBy: { currency: "asc" },
    });
    content = (
      <section>
        <h2>Platform fees</h2>
        <p>
          0.25% for cards, digital wallets and buy now, pay later; 0.10% for
          bank payments, USSD, mobile money and crypto. USD caps are $2 and $1
          respectively. Other currency caps and any fiat valuation follow your
          agreed fee schedule.
        </p>
        <p>
          Billed once per successful payment, separately from provider
          processing fees and settlements. Monthly periods use UTC. Amounts
          below exclude tax.
        </p>
        <form method="get">
          <input type="hidden" name="orgId" value={orgId} />
          <label>
            Month{" "}
            <input type="month" name="month" defaultValue={month} required />
          </label>
          <button type="submit">View month</button>
        </form>
        <h3>{month}</h3>
        {env === "sandbox" ? (
          <p>Your sandbox is free. Test payments do not create payable fees.</p>
        ) : totals.length ? (
          <ul>
            {totals.map((t) => (
              <li key={`${t.currency}:${t.precision}`}>
                {t.currency} {formatFee(t.amountMinor, t.precision)} across{" "}
                {t.payments} successful payments
              </li>
            ))}
          </ul>
        ) : (
          <p>No platform fees for this month.</p>
        )}
        <a
          href={`/api/merchant/billing?orgId=${encodeURIComponent(orgId)}&environment=${env}&month=${month}`}
        >
          Download fee details
        </a>
        <h3>Closed monthly statements</h3>
        {statements.length ? (
          <ul>
            {statements.map((s) => (
              <li key={s.id}>
                {s.currency} {formatFee(s.amountMinor.toFixed(0), s.precision)}{" "}
                — statement {s.id}
              </li>
            ))}
          </ul>
        ) : (
          <p>No closed usage statement for this month.</p>
        )}
        <p>
          Usage statements record platform charges. Your tax invoice and payment
          instructions are issued separately under your agreement. A statement
          is not proof of payment.
        </p>
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
        <p>
          <Link
            href={`/merchant/billing?orgId=${encodeURIComponent(orgId)}&environment=${env}`}
          >
            View platform fees and monthly billing statements
          </Link>
        </p>
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
    const [
      count,
      confirmed,
      attention,
      recent,
      recentConfirmed,
      approvedAccounts,
      keyCount,
    ] = await Promise.all([
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
      db.partnerApplication.count({
        where: { orgId, environment: env, state: "Approved" },
      }),
      db.merchantApiKey.count({
        where: { orgId, environment: env, revokedAt: null },
      }),
    ]);
    const setup = [
      {
        done: ["Under review", "Approved"].includes(config.applicationState),
        label: "Business setup submitted",
        path: "onboarding",
      },
      {
        done: approvedAccounts > 0,
        label: "At least one provider account approved",
        path: "providers",
      },
      {
        done: keyCount > 0,
        label: "API key created",
        path: "developers/api-keys",
      },
      {
        done: !!config.webhookUrl,
        label: "Webhook endpoint configured",
        path: "developers/webhooks",
      },
    ];
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
    const treasury = await merchantTreasury(orgId, env);
    content = (
      <section>
        <TreasuryBanner view={treasury} href={href} />
        <p>How payments are moving in this environment.</p>
        <div className="merchant-metrics">
          <div>
            <strong>{confirmed}</strong>
            <span>Payments received</span>
          </div>
          <div>
            <strong>{successRate === null ? "—" : `${successRate}%`}</strong>
            <span>Success rate</span>
          </div>
          <div>
            <strong>{approvedAccounts}</strong>
            <span>Approved provider accounts</span>
          </div>
          <div>
            <strong>{attention}</strong>
            <span>Payments needing attention</span>
          </div>
        </div>
        {setup.some((s) => !s.done) && (
          <>
            <h2 className="merchant-setup-heading">Getting set up</h2>
            <ul className="merchant-setup">
              {setup.map((s) => (
                <li key={s.label}>
                  {s.done ? "✓" : "○"}{" "}
                  {s.done ? (
                    s.label
                  ) : (
                    <Link href={href(s.path)}>{s.label}</Link>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
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
                    {p.amount} {assetLabel(p.asset)}
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
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link href={href("overview")}>PayRouta / {membership.org.name}</Link>
          {providerMember && (
            <Link
              href="/provider/overview"
              style={{
                fontSize: "0.8125rem",
                fontWeight: 500,
                color: "inherit",
                textDecoration: "none",
                padding: "3px 8px",
                borderRadius: "4px",
                border: "1px solid currentColor",
                opacity: 0.8,
              }}
            >
              Provider workspace →
            </Link>
          )}
        </div>
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
                <li
                  key={item.path}
                  className={active ? "active-group" : undefined}
                >
                  <Link
                    href={href(item.path)}
                    aria-current={
                      section === item.path &&
                      !item.children?.some((child) => child.path === section)
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
