import { merchantConfiguration } from "@/lib/merchant/configuration";
import { transactionExplorer } from "@/lib/blockchain/chains";
import { Providers } from "./providers";
import { partnerOverview } from "@/lib/partners/service";
import { labelOf } from "@/lib/providers/normalized";
import { CryptoPayments } from "./crypto-payments";
import { onchainMethod } from "@/lib/blockchain/crypto-assets";
import { Stablecoins } from "./stablecoins";
import { stablecoinOverview } from "@/lib/merchant/stablecoins";
import { feeTotals } from "@/lib/payments/billing";
import { formatFee } from "@/lib/payments/pricing";
import { createSpliceQuote } from "@/lib/payments/fx-splicing";
import { calculateCheckoutTax } from "@/lib/payments/tax";
import { scheduleSmartDunning } from "@/lib/payments/subscriptions";
import { pricing } from "@/content/claims";
import { storedLiveScope } from "@/lib/merchant/live-scope";
import { MerchantTeam, AcceptMerchantInvitation } from "./team";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { Download } from "lucide-react";

import { identity } from "@/lib/portal/access";
import { merchantMember } from "@/lib/merchant/access";
import { db } from "@/lib/portal/db";
import { intents, settlements } from "@/lib/merchant/service";
import { PortalError, can, countries } from "@/lib/portal/domain";
import { Onboarding } from "./onboarding";
import { MerchantEvidence } from "./evidence";
import { applicationRequirements } from "@/lib/merchant/evidence";
import { merchantMetrics } from "@/lib/merchant/metrics";
import { WebhookControls } from "./webhooks";
import { PaymentLinks } from "./payment-links";
import { linkMethodsOn } from "@/lib/merchant/payment-links";
import { platformCandidates } from "@/lib/treasury/routes";
import { Keys } from "./keys";
import { BrandLogo } from "@/components/brand-logo";
import { CreateWorkspace } from "./create-workspace";
import { SignOutButton } from "@/components/portal/sign-out";
import { PasskeySettings } from "@/components/portal/auth-screen";
import { FeeBearerSetting } from "./fees";
import { SsoSettings } from "./sso";
import { surchargeBannedCountry } from "@/lib/payments/fee-bearer";
import { safeNext } from "@/lib/portal/next-path";
import { merchantTreasury, paymentFunds } from "@/lib/treasury/views";
import { money } from "@/lib/treasury/labels";
import {
  ActivationSection,
  BalancesSection,
  DisputesSection,
  PaymentFundsPanel,
  TreasuryBanner,
} from "./treasury-sections";
import { MerchantShell, routeTitles } from "./shell";
import { Empty, Pill, StatePill, amountText, currencyCode, day, when } from "./format";

import "@/components/portal/portal.css";
import "./workspace.css";
import "./treasury.css";
import { docsUrl } from "@/lib/site-config";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

function Solo({ children }: { children: ReactNode }) {
  return (
    <div className="portal ms-solo">
      <div>
        <BrandLogo />
        {children}
      </div>
    </div>
  );
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const segments = (await params).path || ["overview"];
  const section = (
    segments[0] === "developers" ? segments.slice(0, 2).join("/") : segments[0]
  ) as keyof typeof routeTitles;
  if (!(section in routeTitles) || segments.length > 2) notFound();
  let user;
  try {
    user = await identity();
  } catch (e) {
    if (e instanceof PortalError && e.status === 401) {
      // Keep the page (and any invitation token) so sign-in can return here.
      const qs = new URLSearchParams(
        Object.entries(query).filter((q): q is [string, string] => typeof q[1] === "string"),
      ).toString();
      const back = safeNext(`/merchant/${segments.join("/")}${qs ? `?${qs}` : ""}`) ?? "/merchant";
      redirect(`/sign-in?next=${encodeURIComponent(back)}`);
    }
    throw e;
  }
  if (section === "team" && typeof query.invitation === "string")
    return (
      <Solo>
        <AcceptMerchantInvitation token={query.invitation} />
      </Solo>
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
  if (!orgId || query.new === "1")
    return (
      <Solo>
        <CreateWorkspace />
        <p className="ms-solo-foot">
          {orgId ? (
            <>
              <Link href="/merchant/overview">Back to your dashboard</Link> ·{" "}
            </>
          ) : (
            <>Signed in as {user.user.email} · </>
          )}
          <SignOutButton />
        </p>
      </Solo>
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
  const configure = can(membership.role, "configure");
  const ownerOnly = (what: string) => (
    <section>
      <Empty title="Owner or admin access needed">
        Ask an owner or admin of {membership.org.name} to {what}.
      </Empty>
    </section>
  );
  let content: ReactNode;
  let actions: ReactNode;
  let backLink: { href: string; label: string } | undefined;
  let title: ReactNode;
  if (!enabled)
    content = (
      <section>
        <h2>
          {env === "production"
            ? "No live access yet"
            : "Sandbox is not configured"}
        </h2>
        <p>
          {env === "production"
            ? "Live payments open once your business is activated. Until then, everything runs in test mode."
            : `This business is set up for ${config.environment}. Contact support to review it.`}
        </p>
        {env === "production" && (
          <p>
            <Link className="ms-btn primary" href={`/merchant/activation?${new URLSearchParams({ orgId, environment: config.environment })}`}>
              Activate payments
            </Link>
          </p>
        )}
      </section>
    );
  else if (section === "onboarding") {
    if (configure) {
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
              <dl className="ms-props">
                <dt>Status</dt>
                <dd>
                  <Pill tone={liveScope.data.status === "Approved" ? "good" : "neutral"}>{liveScope.data.status}</Pill>
                </dd>
                <dt>Country</dt>
                <dd>{liveScope.data.input.merchantCountry}</dd>
                <dt>Methods</dt>
                <dd>{liveScope.data.input.methods.map(labelOf).join(", ")}</dd>
                <dt>Asset</dt>
                <dd>{liveScope.data.input.asset}</dd>
                <dt>Next review</dt>
                <dd>{liveScope.data.input.nextReviewAt}</dd>
              </dl>
            ) : (
              <p>No live scope approved yet.</p>
            )}
            <p>
              Live processing also needs current screening, documents, billing
              terms and unused receive addresses.
            </p>
          </section>
        </>
      );
    } else content = ownerOnly("complete the business setup");
  } else if (section === "payments") {
    const id = segments[1];
    const filters = new URLSearchParams();
    for (const key of ["state", "reference", "cursor", "method", "from", "to"])
      if (typeof query[key] === "string")
        filters.set(key, query[key] as string);
    const result = await intents(scope, filters, id);
    const exportTo = new Date();
    const exportFrom = new Date(exportTo.getTime() - 30 * 86400000);
    if ("data" in result) {
      const filtered = ["state", "reference", "method", "from", "to"].some((k) => filters.get(k));
      actions = (
        <a
          className="ms-btn"
          href={`/api/merchant/export?${new URLSearchParams({ orgId, environment: env, from: exportFrom.toISOString(), to: exportTo.toISOString() })}`}
        >
          <Download size={15} aria-hidden /> Export last 30 days
        </a>
      );
      content = (
        <section className="ms-flush">
          <div className="ms-card-head">
            <form className="merchant-filters">
              <input type="hidden" name="orgId" value={orgId} />
              <input type="hidden" name="environment" value={env} />
              <label>
                Reference
                <input
                  name="reference"
                  placeholder="Order ID"
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
                  <option value="Confirmed">Succeeded</option>
                  <option value="Processing">Processing</option>
                  <option value="Open">Incomplete</option>
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
                  {["card", "digital-wallet", "bank-transfer", "direct-debit", "mobile-money", "ussd", "bnpl", "stablecoin", "crypto-app"].map(
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
              <button className="tr-secondary">Filter</button>
              {filtered && (
                <Link className="ms-btn" href={href("payments")}>
                  Clear
                </Link>
              )}
            </form>
          </div>
          {result.data.length ? (
            <div className="p-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Method</th>
                    <th scope="col">Date (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.map((p) => (
                    <tr key={p.id}>
                      <td className="ms-amount">
                        {amountText(p.amount, p.asset)}
                        <small>{currencyCode(p.asset)}</small>
                      </td>
                      <td>
                        <StatePill state={p.state} />
                      </td>
                      <td>
                        <Link className="ms-rowlink" href={href(`payments/${p.id}`)}>
                          {p.reference}
                        </Link>
                      </td>
                      <td className="ms-dim">
                        {p.selectedMethod ? labelOf(p.selectedMethod) : "Not chosen yet"}
                      </td>
                      <td className="ms-dim">{when(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title={filtered ? "No payments match these filters" : "No payments yet"}>
              {filtered
                ? "Try a wider date range or clear the filters."
                : "Payments you create with the API or a checkout link appear here."}
            </Empty>
          )}
          {result.nextCursor && (
            <div className="ms-foot">
              <Link
                className="ms-btn"
                href={`${href("payments")}&${new URLSearchParams({ ...Object.fromEntries(filters), cursor: result.nextCursor })}`}
              >
                Next page →
              </Link>
            </div>
          )}
        </section>
      );
    } else {
      backLink = { href: href("payments"), label: "Transactions" };
      title = result.reference;
      const attempts = await db.paymentAttempt.findMany({
        where: { intentId: result.id, intent: scope },
        select: { id: true, number: true, state: true, createdAt: true, updatedAt: true },
        orderBy: { number: "asc" },
      });
      const chainClaims = await db.depositClaim.findMany({
        where: { attemptId: { in: attempts.map((a) => a.id) } },
      });
      const funds = await paymentFunds(result.id);
      const presentmentCode = currencyCode(result.asset) || "USD";
      const minorAmount = BigInt(Math.max(1, Math.round(Number(result.amount) * 100)));
      const fxPreview = createSpliceQuote({
        presentmentAmountMinor: minorAmount,
        presentmentCurrency: presentmentCode,
        settlementCurrency: "USDC",
      });
      content = (
        <>
          <section>
            <div className="ms-detail-head">
              <strong>
                {amountText(result.amount, result.asset)}
                <small>{currencyCode(result.asset)}</small>
              </strong>
              <StatePill state={result.state} />
            </div>
            <dl className="ms-props" style={{ marginTop: 18 }}>
              <dt>Reference</dt>
              <dd>{result.reference}</dd>
              <dt>Payment method</dt>
              <dd>{result.selectedMethod ? labelOf(result.selectedMethod) : "Not chosen yet"}</dd>
              <dt>Created</dt>
              <dd>{when(result.createdAt)} UTC</dd>
              {result.feeBearer === "customer" && (
                <>
                  <dt>Fees</dt>
                  <dd>Paid by the customer{result.customerFee ? ` (${amountText(result.customerFee, result.asset)})` : ""}</dd>
                </>
              )}
              <dt>Payment ID</dt>
              <dd>
                <code>{result.id}</code>
              </dd>
              <dt>Triple-entry ledger</dt>
              <dd>
                <code>{presentmentCode} {fxPreview.tripleEntry.presentment.formatted}</code> →{" "}
                <code>USDC {fxPreview.tripleEntry.settlement.formattedNet}</code> (Base:{" "}
                <code>USD {fxPreview.tripleEntry.systemBase.formattedPresentmentUsd}</code>)
              </dd>
              {chainClaims.map((c) => (
                <div key={c.id} style={{ display: "contents" }}>
                  <dt>On-chain transfer</dt>
                  <dd>
                    <a href={transactionExplorer(c.network, c.txHash)} target="_blank" rel="noreferrer">
                      View on the explorer ↗
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <div className="ms-grid-2">
            <section>
              {funds ? (
                <PaymentFundsPanel
                  orgId={orgId}
                  intentId={result.id}
                  funds={funds}
                  canRefund={configure}
                />
              ) : (
                <>
                  <h2>Money</h2>
                  <p>
                    {result.state === "Confirmed"
                      ? "This payment settles through Settlements."
                      : "Amounts appear here once the payment succeeds."}
                  </p>
                </>
              )}
            </section>
            <section>
              <h2>Timeline</h2>
              <ol className="ms-timeline">
                <li className="wait">
                  Payment created
                  <small>{when(result.createdAt)}</small>
                </li>
                {attempts.map((a) => (
                  <li
                    key={a.number}
                    className={a.state === "Rejected" ? "bad" : a.state === "Confirmed" ? "" : "wait"}
                  >
                    {a.number > 1 ? `Backup attempt ${a.number}` : "Attempt 1"}:{" "}
                    {a.state === "Confirmed" ? "succeeded" : a.state.toLowerCase()}
                    <small>{when(a.updatedAt)}</small>
                  </li>
                ))}
              </ol>
            </section>
          </div>
        </>
      );
    }
  } else if (section === "activation") {
    if (!configure) content = ownerOnly("activate payments");
    else {
      const view = await merchantTreasury(orgId, env);
      const overview = await partnerOverview(orgId, env);
      const profile = (overview.profile?.data ?? overview.draft ?? {}) as {
        country?: string;
        settlementCurrency?: string;
      };
      content = (
        <ActivationSection
          orgId={orgId}
          view={view}
          country={profile.country ?? config.country}
          currency={profile.settlementCurrency}
          ownerNames={(overview.profile?.data.owners ?? []).map((o) => `${o.givenName} ${o.familyName}`)}
          profilePanel={
            <Providers profileOnly orgId={orgId} overview={overview} canConfigure={configure} />
          }
        />
      );
    }
  } else if (section === "balances") {
    content = <BalancesSection orgId={orgId} view={await merchantTreasury(orgId, env)} href={href} />;
  } else if (section === "disputes") {
    content = (
      <DisputesSection
        orgId={orgId}
        view={await merchantTreasury(orgId, env)}
        href={href}
        canRespond={configure}
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
      { count: number; total: number; lastSeen: Date; asset: unknown }
    >();
    for (const item of intentsList) {
      const key = item.reference.split("-")[0] || item.reference;
      const prev = customersMap.get(key) || {
        count: 0,
        total: 0,
        lastSeen: item.createdAt,
        asset: item.asset,
      };
      customersMap.set(key, {
        count: prev.count + 1,
        total: prev.total + Number(item.amount),
        lastSeen:
          item.createdAt > prev.lastSeen ? item.createdAt : prev.lastSeen,
        asset: prev.asset,
      });
    }
    const customerRows = Array.from(customersMap.entries()).map(
      ([id, info]) => ({
        id,
        ...info,
      }),
    );
    content = (
      <section className="ms-flush">
        {customerRows.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Customer reference</th>
                  <th scope="col" className="ms-num">Payments</th>
                  <th scope="col" className="ms-num">Total</th>
                  <th scope="col">Last payment</th>
                </tr>
              </thead>
              <tbody>
                {customerRows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.id}</strong>
                    </td>
                    <td className="ms-num">{c.count}</td>
                    <td className="ms-num ms-amount">{amountText(c.total.toFixed(2), c.asset)}</td>
                    <td className="ms-dim">{day(c.lastSeen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No customers yet">Customers appear after their first payment.</Empty>
        )}
      </section>
    );
  } else if (section === "providers" || section === "payment-methods") {
    const configuration = await merchantConfiguration(orgId, env);
    const accounts = await stablecoinOverview(orgId, env);
    const offered = new Set((await platformCandidates(orgId, env)).map((c) => c.method));
    const stableNetworks = configuration.stablecoinAssets.filter((a) => a.configured).length;
    const activate = <Link href={href("activation")}>Activate payments →</Link>;
    const methodsOverview: { name: string; detail: string; on: boolean; next: ReactNode }[] = [
      { name: "Cards", detail: "Visa, Mastercard, Amex, Verve and local schemes", on: offered.has("card"), next: activate },
      { name: "Digital wallets", detail: "Apple Pay, Google Pay, PayPal and local wallets", on: offered.has("digital-wallet"), next: activate },
      { name: "Bank transfer", detail: "Bank apps, pay by bank, Pix, UPI", on: offered.has("bank-transfer"), next: activate },
      { name: "Mobile money", detail: "M-Pesa, MTN MoMo, Airtel Money", on: offered.has("mobile-money"), next: activate },
      { name: "USSD", detail: "A short code, no data needed", on: offered.has("ussd"), next: activate },
      {
        name: "Pay with credit",
        detail: "Instalments from a licensed lender; you're paid in full",
        on: offered.has("bnpl"),
        next: <a href={docsUrl("credit")}>Lenders are joining country by country →</a>,
      },
      {
        name: "Stablecoins",
        detail: stableNetworks ? `USDC, USDT, EURC · ${stableNetworks} networks set up` : "USDC, USDT, EURC to your own wallet",
        on: stableNetworks > 0,
        next: <a href="#receive">Add receive addresses ↓</a>,
      },
      {
        name: "Any token, any chain",
        detail: "125+ assets on 36+ chains through NEAR Intents, paid out as your stablecoin",
        on: stableNetworks > 0 && env === "production",
        next: env === "production" ? <a href="#receive">Add receive addresses ↓</a> : <span>Live mode only</span>,
      },
    ];
    content = (
      <>
        <section className="ms-flush">
          <div className="ms-card-head">
            <div>
              <h2>Ways customers pay</h2>
              <p>Every method that&apos;s on appears in your payment links, checkout button and store plugins.</p>
            </div>
          </div>
          <ul className="ms-methods">
            {methodsOverview.map((m) => (
              <li key={m.name} className={m.on ? "on" : undefined}>
                <span className="ms-methods-dot" aria-hidden="true" />
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.detail}</small>
                </span>
                <span className="ms-methods-state">{m.on ? "On" : m.next}</span>
              </li>
            ))}
          </ul>
        </section>
        <div id="receive">
          <Stablecoins
            orgId={orgId}
            environment={env}
            accounts={accounts.filter(
              (a) => onchainMethod(a.network, a.identifier) === "stablecoin",
            )}
            readiness={configuration.stablecoinAssets}
            canConfigure={configure}
          />
        </div>
        <details className="ms-details">
          <summary>Volatile coins: ETH, SOL, XLM and others</summary>
          <CryptoPayments
            orgId={orgId}
            environment={env}
            assets={configuration.cryptoAssets}
            accounts={accounts.filter(
              (a) => onchainMethod(a.network, a.identifier) === "crypto-app",
            )}
            canConfigure={configure}
          />
        </details>
        {section === "providers" && (
          <Providers
            profileOnly
            orgId={orgId}
            overview={await partnerOverview(orgId, env)}
            canConfigure={configure}
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
    if (segments[1]) backLink = { href: href("settlements"), label: "Settlements" };
    content = (
      <>
        <section className="ms-flush">
          {rows.length ? (
            <div className="p-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Settlement</th>
                    <th scope="col">Currency</th>
                    <th scope="col" className="ms-num">Gross (minor)</th>
                    <th scope="col" className="ms-num">Fees (minor)</th>
                    <th scope="col" className="ms-num">Net (minor)</th>
                    <th scope="col">Status</th>
                    <th scope="col">Matched</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <Link className="ms-rowlink" href={href(`settlements/${s.id}`)}>
                          <code>{s.id}</code>
                        </Link>
                      </td>
                      <td>{(s.asset as { identifier: string }).identifier}</td>
                      <td className="ms-num">{s.gross}</td>
                      <td className="ms-num">{s.fee}</td>
                      <td className="ms-num ms-amount">{s.net}</td>
                      <td>
                        <StatePill state={s.state} />
                      </td>
                      <td>
                        <StatePill state={s.reconciliation} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No settlements yet">Settlements appear after providers pay out confirmed payments.</Empty>
          )}
          {"nextCursor" in result && result.nextCursor && (
            <div className="ms-foot">
              <Link className="ms-btn" href={`${href("settlements")}&cursor=${encodeURIComponent(result.nextCursor)}`}>
                Next page →
              </Link>
            </div>
          )}
        </section>
        {segments[1] &&
          rows.map((s) => (
            <section key={s.id} className="ms-flush">
              <div className="ms-card-head">
                <h2>Payments in this settlement</h2>
              </div>
              <div className="p-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Payment</th>
                      <th scope="col" className="ms-num">Amount</th>
                      <th scope="col" className="ms-num">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.allocations.map((a) => (
                      <tr key={a.intentId}>
                        <td>
                          <Link className="ms-rowlink" href={href(`payments/${a.intentId}`)}>
                            <code>{a.intentId}</code>
                          </Link>
                        </td>
                        <td className="ms-num">{a.amount}</td>
                        <td className="ms-num">{a.fee}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
      </>
    );
  } else if (section === "developers/api-keys") {
    if (!configure) content = ownerOnly("create API keys");
    else {
      const keys = await db.merchantApiKey.findMany({
        where: scope,
        select: { id: true, prefix: true, revokedAt: true, permissions: true, createdAt: true },
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
            created: day(k.createdAt),
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
      <section className="ms-flush">
        {logs.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">Endpoint</th>
                  <th scope="col" className="ms-num">Duration</th>
                  <th scope="col">Request ID</th>
                  <th scope="col">Time (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Pill tone={l.status < 300 ? "good" : l.status < 500 ? "warn" : "bad"}>{l.status}</Pill>
                    </td>
                    <td>
                      <code>{l.operation}</code>
                    </td>
                    <td className="ms-num ms-dim">{l.durationMs} ms</td>
                    <td>
                      <code>{l.id}</code>
                    </td>
                    <td className="ms-dim">{when(l.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No API requests yet">Requests made with your API keys appear here.</Empty>
        )}
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
        canManage={configure}
        events={events.map((e) => ({
          id: e.id,
          type: e.type,
          state: deliveries.find((d) => d.eventId === e.id)?.state || "Pending",
          created: when(e.createdAt),
        }))}
      />
    );
  } else if (section === "payment-links") {
    const links = await db.paymentLink.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 100 });
    const linkMethods = await linkMethodsOn(orgId, env);
    const linkCrypto = enabled
      ? await merchantConfiguration(orgId, env)
          .then((c) => c.stablecoinAssets.some((a) => a.configured && a.executionEnabled))
          .catch(() => false)
      : false;
    const currencyFor: Record<string, string> = { NG: "NGN", KE: "KES", GH: "GHS", ZA: "ZAR", GB: "GBP", US: "USD", BR: "BRL", MX: "MXN", IN: "INR" };
    content = (
      <PaymentLinks
        orgId={orgId}
        origin={new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000").origin}
        canManage={configure && enabled}
        defaultCountry={config.country}
        defaultCurrency={linkMethods.size ? (currencyFor[config.country] ?? "USD") : "USD"}
        methodsOn={[...linkMethods]}
        cryptoReady={linkCrypto}
        links={links.map((l) => ({
          id: l.id,
          slug: l.slug,
          title: l.title,
          amount: l.amount,
          currency: l.currency,
          methods: l.methods as string[],
          crypto: l.crypto,
          active: l.active,
          checkouts: l.checkouts,
          created: day(l.createdAt),
        }))}
      />
    );
  } else if (section === "developers/integrations") {
    const shops = await db.shopifyShop.findMany({ where: { orgId, uninstalledAt: null }, orderBy: { installedAt: "desc" } });
    const appOrigin = new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000").origin;
    const prefill = typeof query.shopify === "string" ? query.shopify : "";
    content = (
      <>
        <section>
          <h2>Checkout button</h2>
          <p>
            One button for any site or app. Customers pay in a secure PayRouta window with every method you accept,
            including credit from licensed lenders and stablecoins from any wallet.
          </p>
          <pre className="ms-code">{`<script src="${appOrigin}/js/v1/payrouta.js" async></script>
<button data-payrouta-checkout="/create-checkout">Checkout</button>`}</pre>
          <p className="ms-dim">
            <code>/create-checkout</code> is your server: it calls <code>POST /checkouts</code> with your secret key and
            answers <code>{"{ \"checkoutUrl\": \"…\" }"}</code>. <a href={docsUrl("checkout-button")}>Checkout button guide</a>
          </p>
        </section>
        <section>
          <h2>Shopify</h2>
          <p>
            Offer PayRouta at Shopify checkout. Shopify must approve PayRouta as a payments app before stores outside
            development can install it.
          </p>
          {query.shopifyError && <p className="p-notice error">The Shopify connection didn&apos;t complete. Try again.</p>}
          {shops.length > 0 && (
            <ul>
              {shops.map((s) => (
                <li key={s.id}>
                  <strong>{s.shop}</strong> · {s.environment === "sandbox" ? "test mode" : "live"} ·{" "}
                  {s.ready ? "ready" : "finish setup in Shopify"}
                </li>
              ))}
            </ul>
          )}
          {configure ? (
            <form action="/api/integrations/shopify/install" method="get" className="ms-inline-form">
              <input type="hidden" name="orgId" value={orgId} />
              <label htmlFor="shopify-shop">Store address</label>
              <input id="shopify-shop" name="shop" placeholder="your-store.myshopify.com" defaultValue={prefill} required pattern="[a-z0-9][a-z0-9\-]*\.myshopify\.com" />
              <button className="ms-btn primary" type="submit">
                Connect Shopify
              </button>
            </form>
          ) : (
            <p className="ms-dim">An owner or admin can connect a Shopify store.</p>
          )}
        </section>
        <section>
          <h2>WooCommerce</h2>
          <p>
            The PayRouta Checkout plugin adds one payment option that opens PayRouta checkout. Orders are marked paid only
            after a signed webhook and a check against the PayRouta API.
          </p>
          <ol>
            <li>Install the plugin (private 0.1.0; ask PayRouta for the package) and activate it.</li>
            <li>
              Set your return origin to the store&apos;s address under Settings, and create an API key with{" "}
              <code>payments:write</code> and <code>payments:read</code>.
            </li>
            <li>
              Under Webhooks, set the endpoint to <code>https://your-store/wp-json/payrouta/v1/webhook</code>, and enter the
              same key ID and secret in the plugin.
            </li>
          </ol>
          <p className="ms-dim">
            <a href={docsUrl("woocommerce")}>WooCommerce guide</a>
          </p>
        </section>
      </>
    );
  } else if (section === "reconciliation") {
    const exceptions = await db.paymentException.findMany({
      where: { intent: scope },
      select: { id: true, intentId: true, state: true, createdAt: true, intent: { select: { reference: true } } },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    content = (
      <section className="ms-flush">
        <div className="ms-card-head">
          <p>
            Payments where a provider&apos;s answer didn&apos;t match. We check
            these against the provider&apos;s records; you don&apos;t need to act.
          </p>
        </div>
        {exceptions.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Payment</th>
                  <th scope="col">Status</th>
                  <th scope="col">Opened (UTC)</th>
                </tr>
              </thead>
              <tbody>
                {exceptions.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link className="ms-rowlink" href={href(`payments/${e.intentId}`)}>
                        {e.intent.reference}
                      </Link>
                    </td>
                    <td>
                      <StatePill state={e.state} />
                    </td>
                    <td className="ms-dim">{when(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No payment issues">When a provider&apos;s records don&apos;t match ours, the payment is listed here while we check it.</Empty>
        )}
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
    const { partnerProcessed: partner, payroutaOnly: direct } = pricing;
    content = (
      <>
        <section>
          <h2>Platform fees</h2>
          <p>
            Charged once per successful payment. Failed payments, refunds you
            start and test mode are free.
          </p>
          <div className="ms-rates">
            <div>
              <strong>{partner.rate}</strong>
              <span>
                {partner.methods}, on top of the processing partner&apos;s
                standard fee. Never more than {partner.cap} (or the local
                equivalent) per payment.
              </span>
            </div>
            <div>
              <strong>{direct.rate}</strong>
              <span>{direct.methods}. All in: no partner fee.</span>
            </div>
          </div>
        </section>
        <section>
          <div className="ms-card-head">
            <div>
              <h2>Usage</h2>
              <p>Months run in UTC. Amounts exclude tax.</p>
            </div>
            <a
              className="ms-btn"
              href={`/api/merchant/billing?orgId=${encodeURIComponent(orgId)}&environment=${env}&month=${month}`}
            >
              <Download size={15} aria-hidden /> Download fee details
            </a>
          </div>
          <form method="get" className="ms-inline">
            <input type="hidden" name="orgId" value={orgId} />
            <input type="hidden" name="environment" value={env} />
            <label>
              Month
              <input type="month" name="month" defaultValue={month} required />
            </label>
            <button type="submit" className="tr-secondary">View month</button>
          </form>
          <h3>{month}</h3>
          {env === "sandbox" ? (
            <p>Your sandbox is free. Test payments do not create payable fees.</p>
          ) : totals.length ? (
            <div className="p-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Currency</th>
                    <th scope="col" className="ms-num">Successful payments</th>
                    <th scope="col" className="ms-num">Fees</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => (
                    <tr key={`${t.currency}:${t.precision}`}>
                      <td>{t.currency}</td>
                      <td className="ms-num">{t.payments}</td>
                      <td className="ms-num ms-amount">{formatFee(t.amountMinor, t.precision)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No platform fees for this month.</p>
          )}
        </section>
        <section>
          <h2>Monthly statements</h2>
          {statements.length ? (
            <ul className="ms-list">
              {statements.map((s) => (
                <li key={s.id}>
                  <strong>
                    {s.currency} {formatFee(s.amountMinor.toFixed(0), s.precision)}
                  </strong>
                  <code>{s.id}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p>No closed statement for this month yet.</p>
          )}
          <p>
            Statements record platform charges. Your tax invoice and payment
            instructions are sent separately. A statement is not proof of
            payment.
          </p>
        </section>
        <div className="ms-grid-2">
          <section>
            <h2>Indirect tax &amp; reverse-charge engine</h2>
            <dl className="ms-props">
              {(["DE", "US", "CA", "NG", "GB", "BR"] as const).map((iso) => {
                const sample = calculateCheckoutTax({
                  amountMinor: 10000n,
                  currency: "USD",
                  buyerAddress: {
                    country: iso,
                    stateOrProvince: iso === "US" ? "NY" : iso === "CA" ? "ON" : undefined,
                  },
                  productCategory: "saas",
                });
                return (
                  <div key={iso} style={{ display: "contents" }}>
                    <dt>{iso}</dt>
                    <dd>
                      {sample.lineItems[0]?.name ?? sample.filingRegime} · {sample.effectiveRatePercent}
                    </dd>
                  </div>
                );
              })}
              <dt>EU B2B VIES</dt>
              <dd>0% Reverse Charge (Art. 196)</dd>
            </dl>
          </section>
          <section>
            <h2>Subscriptions &amp; payday dunning</h2>
            <dl className="ms-props">
              <dt>Seat proration</dt>
              <dd>Exact UTC millisecond ratio</dd>
              <dt>Usage metering</dt>
              <dd>Idempotent millisecond rollup</dd>
              {(["NG", "BR", "US", "GB"] as const).map((region) => {
                const dunning = scheduleSmartDunning({
                  declineCode: "insufficient_funds",
                  customerCountry: region,
                  attemptNumber: 1,
                  failedAtMs: Date.parse("2026-10-16T10:00:00.000Z"),
                });
                return (
                  <div key={region} style={{ display: "contents" }}>
                    <dt>{region} retry rule</dt>
                    <dd>{dunning.paydayCalendarPattern}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        </div>
      </>
    );
  } else if (section === "analytics") {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 86400000);
    const metrics = await merchantMetrics(orgId, env, from, to);
    const rate = (n: number) => (metrics.checkout ? `${Math.round((n / metrics.checkout) * 100)}%` : "—");
    content = (
      <>
        <div className="ms-kpis">
          <div className="ms-kpi">
            <span>Conversion</span>
            <strong>{rate(metrics.confirmed)}</strong>
            <small>
              {metrics.confirmed} paid of {metrics.checkout} checkouts
            </small>
          </div>
          <div className="ms-kpi">
            <span>Chose a method</span>
            <strong>{rate(metrics.selected)}</strong>
            <small>{metrics.selected} checkouts</small>
          </div>
          <div className="ms-kpi">
            <span>Saved by a backup</span>
            <strong>{metrics.fallback}</strong>
            <small>payments used a second processor</small>
          </div>
          <div className="ms-kpi">
            <span>Payments succeeded</span>
            <strong>{metrics.confirmed}</strong>
            <small>last 30 days</small>
          </div>
        </div>
        <section className="ms-flush">
          <div className="ms-card-head">
            <div>
              <h2>Attempt outcomes</h2>
              <p>
                Payments created {day(new Date(metrics.from))} to {day(new Date(metrics.to))}. Pending
                attempts aren&apos;t counted as failures; late answers update these figures.
              </p>
            </div>
          </div>
          {metrics.attempts.length ? (
            <div className="p-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Outcome</th>
                    <th scope="col" className="ms-num">Attempts</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.attempts.map((a) => (
                    <tr key={a.state}>
                      <td>
                        <StatePill state={a.state} />
                      </td>
                      <td className="ms-num">{a.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No attempts in the last 30 days" />
          )}
        </section>
      </>
    );
  } else if (section === "team") {
    content = can(membership.role, "team") ? (
      <MerchantTeam
        orgId={orgId}
        members={(
          await db.membership.findMany({
            where: { orgId, merchantRole: { not: null } },
            include: { user: { select: { name: true } } },
            take: 100,
          })
        ).map((m) => ({
          id: m.id,
          name: m.user.name,
          role: m.merchantRole!,
        }))}
      />
    ) : (
      ownerOnly("manage the team")
    );
  } else if (section === "security")
    content = (
      <>
        <section>
          <h2>Passkeys</h2>
          <PasskeySettings />
        </section>
        <section>
          <h2>Two-step verification</h2>
          <p>
            Your authenticator app protects sign-in and sensitive actions such
            as API keys and payouts.
          </p>
          <p>
            <Link className="ms-btn" href="/provider/settings">
              Manage authenticator and sessions
            </Link>
          </p>
        </section>
      </>
    );
  else if (section === "settings")
    content = (
      <>
        <section>
          <h2>Business details</h2>
          <dl className="ms-props">
            <dt>Business name</dt>
            <dd>{membership.org.name}</dd>
            <dt>Country</dt>
            <dd>{countries.find((c) => c.id === config.country)?.name ?? config.country}</dd>
            <dt>Checkout return website</dt>
            <dd>{config.returnOrigin}</dd>
            <dt>Your role</dt>
            <dd>{membership.role}</dd>
          </dl>
        </section>
        {configure && (
          <FeeBearerSetting
            orgId={orgId}
            feeBearer={config.feeBearer}
            surchargeBanned={surchargeBannedCountry(config.country)}
          />
        )}
        {configure && (
          <SsoSettings
            orgId={orgId}
            origin={new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000").origin}
            providers={(
              await db.ssoProvider.findMany({ where: { organizationId: orgId }, orderBy: { domain: "asc" } })
            ).map((p) => ({
              providerId: p.providerId,
              domain: p.domain,
              protocol: p.samlConfig ? ("saml" as const) : ("oidc" as const),
              verified: !!p.domainVerified,
            }))}
          />
        )}
      </>
    );
  else {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 6 * 86400000);
    weekAgo.setUTCHours(0, 0, 0, 0);
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
    const treasury = await merchantTreasury(orgId, env);
    const [linkStats, offered, stablecoinsReady] = await Promise.all([
      db.paymentLink.aggregate({ where: { ...scope, active: true }, _count: true, _sum: { checkouts: true } }),
      platformCandidates(orgId, env).then((c) => new Set(c.map((x) => x.method))),
      enabled
        ? merchantConfiguration(orgId, env)
            .then((c) => c.stablecoinAssets.some((a) => a.configured))
            .catch(() => false)
        : Promise.resolve(false),
    ]);
    const ways: [string, boolean][] = [
      ["Card", offered.has("card")],
      ["Digital wallets", offered.has("digital-wallet")],
      ["Bank transfer", offered.has("bank-transfer")],
      ["Mobile money", offered.has("mobile-money")],
      ["USSD", offered.has("ussd")],
      ["Pay with credit", offered.has("bnpl")],
      ["Stablecoins", stablecoinsReady],
      ["Any token, any chain", stablecoinsReady && env === "production"],
    ];
    const setup = [
      {
        done: !!treasury.account && treasury.account.state !== "Returned",
        label: "Activate payments",
        path: "activation",
      },
      {
        done: linkStats._count > 0 || keyCount > 0,
        label: "Create a payment link or add the button",
        path: "payment-links",
      },
      {
        done: count > 0,
        label: "Take a test payment",
        path: "payment-links",
      },
      {
        done: approvedAccounts > 0 || treasury.account?.state === "Live",
        label: "Go live",
        path: "activation",
      },
    ];
    const doneCount = setup.filter((x) => x.done).length;
    const successRate =
      count === 0 ? null : Math.round((confirmed / count) * 100);
    const byDay = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekAgo.getTime() + i * 86400000);
      const key = d.toISOString().slice(0, 10);
      return {
        key,
        label: d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }),
        count: recentConfirmed.filter(
          (p) => p.createdAt.toISOString().slice(0, 10) === key,
        ).length,
      };
    });
    const maxDay = Math.max(1, ...byDay.map((d) => d.count));
    const weekTotal = byDay.reduce((n, d) => n + d.count, 0);
    const balance = treasury.balances[0];
    content = (
      <>
        <TreasuryBanner view={treasury} href={href} />
        <div className="ms-getpaid" role="list" aria-label="Ways to get paid">
          <Link role="listitem" className="ms-gp ms-gp-main" href={href("payment-links")}>
            <span className="ms-gp-kicker">No website needed</span>
            <strong>Payment link</strong>
            <span>
              {linkStats._count
                ? `${linkStats._count} active · ${linkStats._sum.checkouts ?? 0} checkouts`
                : "Share on WhatsApp, Instagram or SMS"}
            </span>
            <span className="ms-gp-go">{linkStats._count ? "Manage links →" : "Create a link →"}</span>
          </Link>
          <Link role="listitem" className="ms-gp" href={href("developers/integrations")}>
            <span className="ms-gp-kicker">Your website or app</span>
            <strong>Checkout button</strong>
            <span>One script tag and a button</span>
            <span className="ms-gp-go">Get the code →</span>
          </Link>
          <Link role="listitem" className="ms-gp" href={href("developers/integrations")}>
            <span className="ms-gp-kicker">Your store</span>
            <strong>Shopify or WooCommerce</strong>
            <span>PayRouta at your store&apos;s checkout</span>
            <span className="ms-gp-go">Connect →</span>
          </Link>
        </div>
        <section className="ms-ways" aria-label="Ways your customers can pay">
          <h2>Ways your customers can pay</h2>
          <ul>
            {ways.map(([label, on]) => (
              <li key={label} className={on ? "on" : undefined}>
                <span aria-hidden="true" />
                {label}
                <small>
                  {on
                    ? "On"
                    : label === "Pay with credit"
                      ? "As lenders join"
                      : label === "Any token, any chain" && env !== "production"
                        ? "Live mode only"
                        : label === "Stablecoins" || label === "Any token, any chain"
                          ? "Add receive addresses"
                          : "After activation"}
                </small>
              </li>
            ))}
          </ul>
          <Link href={href("payment-methods")}>Payment methods →</Link>
        </section>
        <div className="ms-kpis">
          <div className="ms-kpi">
            <span>Payments received</span>
            <strong>{confirmed}</strong>
            <small>{weekTotal} in the last 7 days</small>
          </div>
          <div className="ms-kpi">
            <span>Success rate</span>
            <strong>{successRate === null ? "—" : `${successRate}%`}</strong>
            <small>of {count} payments</small>
          </div>
          <div className="ms-kpi">
            <span>Available to pay out</span>
            <strong>{balance ? money(balance.asset, balance.available) : "—"}</strong>
            <small>
              {balance ? <Link href={href("balances")}>View balances</Link> : "After your first payment"}
            </small>
          </div>
          <div className="ms-kpi">
            <span>Needs attention</span>
            <strong>{attention}</strong>
            <small>
              {attention ? <Link href={href("reconciliation")}>Review payments</Link> : "All clear"}
            </small>
          </div>
        </div>
        <div className="ms-grid-2">
          <section>
            <div className="ms-card-head">
              <div>
                <h2>Successful payments</h2>
                <p>Last 7 days, UTC</p>
              </div>
            </div>
            <div
              className="ms-chart"
              role="img"
              aria-label={`Successful payments over the last 7 days: ${byDay.map((d) => `${d.label} ${d.count}`).join(", ")}`}
            >
              {byDay.map((d) => (
                <div key={d.key}>
                  {d.count > 0 && <b>{d.count}</b>}
                  <i
                    className={d.count ? undefined : "zero"}
                    style={{ height: `${Math.max(1.5, (d.count / maxDay) * 85)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="ms-chart-axis" aria-hidden>
              {byDay.map((d) => (
                <span key={d.key}>{d.label}</span>
              ))}
            </div>
          </section>
          <section>
            <h2>{doneCount === setup.length ? "You're all set" : "Setup guide"}</h2>
            <p>
              {doneCount} of {setup.length} done
            </p>
            <div className="ms-progress" aria-hidden>
              <span style={{ width: `${(doneCount / setup.length) * 100}%` }} />
            </div>
            <ul className="ms-guide">
              {setup.map((s) => (
                <li key={s.label} className={s.done ? "done" : undefined}>
                  <span className="ms-guide-mark" aria-hidden>
                    ✓
                  </span>
                  <span>
                    {s.label}
                    <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                  </span>
                  {!s.done && <Link href={href(s.path)}>Start →</Link>}
                </li>
              ))}
            </ul>
          </section>
        </div>
        <section className="ms-flush">
          <div className="ms-card-head">
            <h2>Recent payments</h2>
            <Link href={href("payments")}>View all →</Link>
          </div>
          {recent.length ? (
            <div className="p-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Amount</th>
                    <th scope="col">Status</th>
                    <th scope="col">Reference</th>
                    <th scope="col">Date (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id}>
                      <td className="ms-amount">
                        {amountText(p.amount, p.asset)}
                        <small>{currencyCode(p.asset)}</small>
                      </td>
                      <td>
                        <StatePill state={p.state} />
                      </td>
                      <td>
                        <Link className="ms-rowlink" href={href(`payments/${p.id}`)}>
                          {p.reference}
                        </Link>
                      </td>
                      <td className="ms-dim">{when(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No payments yet">
              <Link href={href("payment-links")}>Create a payment link</Link> and open it to take your first test payment.
            </Empty>
          )}
        </section>
      </>
    );
  }
  return (
    <MerchantShell
      section={section}
      orgName={membership.org.name}
      orgs={memberships.map((m) => ({ id: m.orgId, name: m.org.name }))}
      orgId={orgId}
      env={env}
      email={user.user.email}
      href={href}
      providerLink={!!providerMember}
      actions={actions}
      backLink={backLink}
      title={title}
    >
      {content}
    </MerchantShell>
  );
}
