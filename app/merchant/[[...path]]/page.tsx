import { settlementAddressView } from "@/lib/intents/settlement-address";
import { merchantConfiguration } from "@/lib/merchant/configuration";
import { transactionExplorer } from "@/lib/blockchain/chains";
import { Providers } from "./providers";
import { partnerOverview } from "@/lib/partners/service";
import { labelOf } from "@/lib/providers/normalized";
import { CryptoPayments } from "./crypto-payments";
import { onchainMethod } from "@/lib/blockchain/crypto-assets";
import { cashOutView } from "@/lib/treasury/offramp/cashout";
import { Stablecoins } from "./stablecoins";
import { stablecoinOverview } from "@/lib/merchant/stablecoins";
import { CryptoBalance } from "./crypto-balance";
import { AgentKeys } from "./agents";
import { agentKeys, agentSpending } from "@/lib/agents/keys";
import { intentsOverview } from "@/lib/intents/account";
import { payouts } from "@/lib/intents/payouts";
import { chainNames, destinations as intentsDestinations, tokens as oneClickTokens } from "@/lib/intents/oneclick";
import { feeTotals } from "@/lib/payments/billing";
import { formatFee } from "@/lib/payments/pricing";
import { pricing } from "@/content/claims";
import { storedLiveScope } from "@/lib/merchant/live-scope";
import { MerchantTeam, AcceptMerchantInvitation } from "./team";
import Link from "next/link";
import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { Download, Plus } from "lucide-react";

import { identity } from "@/lib/portal/access";
import { merchantMember } from "@/lib/merchant/access";
import { db } from "@/lib/portal/db";
import { loadRequirements } from "@/lib/merchant/requirements";
import type { ActivationProfile } from "./activation";
import { intents, settlements } from "@/lib/merchant/service";
import { PortalError, can, countries } from "@/lib/portal/domain";
import { Onboarding } from "./onboarding";
import { MerchantEvidence } from "./evidence";
import { applicationRequirements } from "@/lib/merchant/evidence";
import { merchantMetrics } from "@/lib/merchant/metrics";
import { WebhookControls } from "./webhooks";
import { PaymentLinks } from "./payment-links";
import { SubscriptionDetail, Subscriptions } from "./subscriptions";
import { getSubscription, listPlans, listSubscriptions, planView } from "@/lib/subscriptions/service";
import { linkMethodsOn } from "@/lib/merchant/payment-links";
import { payoutCurrency } from "@/lib/merchant/payout-banks";
import { platformCandidates } from "@/lib/treasury/routes";
import { Keys } from "./keys";
import { BrandLogo } from "@/components/brand-logo";
import { CreateWorkspace } from "./create-workspace";
import { SignOutButton } from "@/components/portal/sign-out";
import { AccountSecurity } from "@/components/portal/account-security";
import { FeeBearerSetting } from "./fees";
import { LogoSetting } from "./logo";
import { logoUrl, merchantBrand } from "@/lib/merchant/branding";
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
import { Empty, Pill, StatePill, amountText, currencyCode, day, minorText, when } from "./format";

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
        {env !== "production" && (
          <p>This business is set up for {config.environment}. Contact support to review it.</p>
        )}
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
    backLink = { href: href("settings"), label: "Settings" };
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
            <Empty title={filtered ? "No payments match these filters" : "No payments yet"} />
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
      const [view, overview, requirements] = await Promise.all([
        merchantTreasury(orgId, env),
        partnerOverview(orgId, env),
        loadRequirements(db, orgId, "production"),
      ]);
      const profile: ActivationProfile = overview.profile?.data ?? {
        ...overview.draft,
        country: overview.draft?.country ?? config.country,
      };
      content = (
        <ActivationSection
          orgId={orgId}
          view={view}
          requirements={requirements}
          profile={profile}
          environment={config.environment}
          email={user.user.email}
        />
      );
    }
  } else if (section === "balances") {
    content = <BalancesSection orgId={orgId} view={await merchantTreasury(orgId, env)} href={href} />;
  } else if (section === "crypto-balance" && env !== "production") {
    content = (
      <section className="ms-callout">
        <h2>Crypto settles in live mode</h2>
        <Link className="ms-btn primary" href={`/merchant/activation?${new URLSearchParams({ orgId, environment: env })}`}>
          Go live with crypto
        </Link>
      </section>
    );
  } else if (section === "crypto-balance") {
    const overview = await intentsOverview(orgId, env);
    // Where payouts can go: every token 1Click lists (cached for minutes).
    const listed = overview.account ? await oneClickTokens().catch(() => []) : [];
    content = (
      <CryptoBalance
        portalUserId={user.user.id}
        orgId={orgId}
        environment={env}
        overview={overview}
        payouts={overview.account ? await payouts(orgId, env) : []}
        settleOptions={intentsDestinations.map((d) => ({
          network: d.network,
          identifier: d.identifier,
          symbol: d.symbol,
          chainName: chainNames[d.blockchain] ?? d.blockchain,
        }))}
        tokens={listed
          .map((t) => ({ assetId: t.assetId, chain: t.blockchain, chainName: chainNames[t.blockchain] ?? t.blockchain.toUpperCase(), symbol: t.symbol }))
          .sort((a, b) => a.chainName.localeCompare(b.chainName) || a.symbol.localeCompare(b.symbol))}
        canConfigure={configure}
        cashOut={await cashOutView(orgId, env).catch(() => undefined)}
        address={await settlementAddressView(orgId, env)}
      />
    );
  } else if (section === "disputes") {
    content = (
      <DisputesSection
        orgId={orgId}
        view={await merchantTreasury(orgId, env)}
        href={href}
        canRespond={configure}
      />
    );
  } else if (section === "providers" || section === "payment-methods") {
    const configuration = await merchantConfiguration(orgId, env);
    const accounts = await stablecoinOverview(orgId, env);
    const offered = new Set((await platformCandidates(orgId, env)).map((c) => c.method));
    const stableNetworks = configuration.stablecoinAssets.filter((a) => a.configured).length;
    const fiatMethods = [
      ["Cards", "card"],
      ["Digital wallets", "digital-wallet"],
      ["Bank transfer", "bank-transfer"],
      ["Mobile money", "mobile-money"],
      ["USSD", "ussd"],
      ["Pay with credit", "bnpl"],
    ] as const;
    const intentsConnected =
      env === "production" &&
      ((await db.intentsAccount.count({ where: { orgId, environment: env, revokedAt: null } })) > 0 ||
        (await db.fiatPayoutAccount.count({ where: { orgId, environment: env, settleCheckouts: true } })) > 0 ||
        (await db.settlementAddress.count({ where: { orgId, environment: env, active: true } })) > 0);
    const live = env === "production";
    const cryptoOn = intentsConnected || stableNetworks > 0;
    const receiveAccounts = accounts.filter((a) => onchainMethod(a.network, a.identifier) === "stablecoin");
    const methodsOverview: { name: string; on: boolean; next?: ReactNode }[] = [
      ...fiatMethods.map(([name, id]) => ({ name, on: offered.has(id) })),
      {
        name: live ? "Crypto: any token, any chain" : "Stablecoins",
        on: cryptoOn,
        next: <Link href={live ? href("crypto-balance") : "#receive"}>Set up</Link>,
      },
    ];
    content = (
      <>
        <section className="ms-flush">
          <div className="ms-card-head">
            <h2>Ways customers pay</h2>
            {configure && fiatMethods.some(([, id]) => !offered.has(id)) && (
              <Link className="ms-btn primary" href={href("activation")}>
                Activate payments
              </Link>
            )}
          </div>
          <ul className="ms-methods">
            {methodsOverview.map((m) => (
              <li key={m.name}>
                <strong>{m.name}</strong>
                {m.on ? (
                  <span className="ms-pill good">On</span>
                ) : m.next ? (
                  <span className="ms-methods-state">{m.next}</span>
                ) : (
                  <span className="ms-pill">Off</span>
                )}
              </li>
            ))}
          </ul>
        </section>
        {!live && (
          <details className="ms-details" id="receive" open>
            <summary>Receive addresses</summary>
            <div className="ms-details-body">
              <Stablecoins
                orgId={orgId}
                environment={env}
                accounts={receiveAccounts}
                readiness={configuration.stablecoinAssets}
                canConfigure={configure}
              />
              <CryptoPayments
                orgId={orgId}
                environment={env}
                assets={configuration.cryptoAssets}
                accounts={accounts.filter(
                  (a) => onchainMethod(a.network, a.identifier) === "crypto-app",
                )}
                canConfigure={configure}
              />
            </div>
          </details>
        )}
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
    // Payments in a settlement are listed by their order reference.
    const references = new Map(
      segments[1]
        ? (
            await db.paymentIntent.findMany({
              where: { ...scope, id: { in: rows.flatMap((s) => s.allocations.map((a) => a.intentId)) } },
              select: { id: true, reference: true },
            })
          ).map((i) => [i.id, i.reference])
        : [],
    );
    content = (
      <>
        <section className="ms-flush">
          {rows.length ? (
            <div className="p-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col" className="ms-num">Net</th>
                    <th scope="col" className="ms-num">Gross</th>
                    <th scope="col" className="ms-num">Fees</th>
                    <th scope="col">Status</th>
                    <th scope="col">Matched</th>
                    <th scope="col">Date (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.id}>
                      <td className="ms-num ms-amount">
                        <Link className="ms-rowlink" href={href(`settlements/${s.id}`)}>
                          {minorText(s.net, s.asset)}
                        </Link>
                      </td>
                      <td className="ms-num">{minorText(s.gross, s.asset)}</td>
                      <td className="ms-num ms-dim">{minorText(s.fee, s.asset)}</td>
                      <td>
                        <StatePill state={s.state} />
                      </td>
                      <td>
                        <StatePill state={s.reconciliation} />
                      </td>
                      <td className="ms-dim">{when(s.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No settlements yet" />
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
                            {references.get(a.intentId) ?? a.intentId}
                          </Link>
                        </td>
                        <td className="ms-num">{minorText(a.amount, s.asset)}</td>
                        <td className="ms-num ms-dim">{minorText(a.fee, s.asset)}</td>
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
  } else if (section === "developers/agents") {
    const selected =
      typeof query.key === "string"
        ? await db.agentKey.findFirst({ where: { id: query.key, orgId, environment: env } })
        : null;
    content = configure ? (
      <AgentKeys
        orgId={orgId}
        environment={env}
        keys={await agentKeys(orgId, env)}
        query={`?${new URLSearchParams({ orgId, environment: env })}`}
        spending={selected ? { keyId: selected.id, name: selected.name, ...(await agentSpending(selected)) } : null}
      />
    ) : (
      ownerOnly("create agent keys")
    );
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
          <Empty title="No API requests yet" />
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
    content = (
      <PaymentLinks
        orgId={orgId}
        origin={new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000").origin}
        canManage={configure && enabled}
        defaultCountry={config.country}
        defaultCurrency={linkMethods.size ? (payoutCurrency(config.country) ?? "USD") : "USD"}
        startOpen={query.create === "1"}
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
  } else if (section === "subscriptions") {
    const methodsOn = await linkMethodsOn(orgId, env);
    const cryptoReady = await merchantConfiguration(orgId, env)
      .then((c) => c.stablecoinAssets.some((a) => a.configured && a.executionEnabled))
      .catch(() => false);
    if (segments[1]) {
      const sub = await getSubscription(scope, segments[1]).catch(() => null);
      if (!sub) notFound();
      const plan = await db.subscriptionPlan.findUniqueOrThrow({ where: { id: sub.plan.id } });
      backLink = { href: href("subscriptions"), label: "Subscriptions" };
      title = sub.customer.name ?? sub.customer.email;
      content = (
        <SubscriptionDetail
          orgId={orgId}
          sub={sub}
          canManage={configure}
          test={env === "sandbox"}
          meters={planView(plan).meters}
        />
      );
    } else {
      const [plans, subs] = await Promise.all([listPlans(scope), listSubscriptions(scope, new URLSearchParams({ limit: "100" }))]);
      content = (
        <Subscriptions
          orgId={orgId}
          plans={plans}
          subscriptions={subs.data}
          canManage={configure}
          methodsOn={[...methodsOn]}
          cryptoReady={cryptoReady}
          localCurrency={methodsOn.size ? (payoutCurrency(config.country) ?? "USD") : "USD"}
          activateHref={href("activation")}
          detailBase={`/merchant/subscriptions/`}
          query={`?${new URLSearchParams({ orgId, environment: env })}`}
        />
      );
    }
  } else if (section === "developers/integrations") {
    const shops = await db.shopifyShop.findMany({ where: { orgId, uninstalledAt: null }, orderBy: { installedAt: "desc" } });
    const liteShops = await db.shopifyLiteShop.findMany({ where: { orgId, uninstalledAt: null }, orderBy: { installedAt: "desc" } });
    const appOrigin = new URL(process.env.BETTER_AUTH_URL || "http://127.0.0.1:3000").origin;
    // The payments app's install from Shopify lands here with ?shopify=.
    const prefill = typeof query.shopify === "string" ? query.shopify : "";
    const paymentsApp = !!process.env.SHOPIFY_API_KEY;
    content = (
      <>
        <section id="shopify">
          <h2>Shopify</h2>
          {query.shopifyError && <p className="p-notice error">The Shopify connection didn&apos;t complete. Try again.</p>}
          {liteShops.length > 0 && (
            <ul>
              {liteShops.map((s) => (
                <li key={s.id}>
                  <strong>{s.shop}</strong> · {s.environment === "sandbox" ? "test mode" : "live"} · {s.gateway} ·{" "}
                  {s.cancelAfterHours ? `unpaid orders cancelled after ${s.cancelAfterHours} hours` : "unpaid orders kept open"}
                </li>
              ))}
            </ul>
          )}
          {configure ? (
            <form action="/api/integrations/shopify-lite/install" method="get" className="ms-link-form">
              <input type="hidden" name="orgId" value={orgId} />
              <label>
                Store address
                <input name="shop" placeholder="your-store.myshopify.com" required pattern="[a-z0-9][a-z0-9\-]*\.myshopify\.com" />
              </label>
              <label>
                Payment method name
                <input name="gateway" defaultValue={liteShops[0]?.gateway ?? "PayRouta"} required maxLength={100} />
              </label>
              <label>
                Cancel unpaid orders after
                <select name="cancelAfterHours" defaultValue={String(liteShops[0]?.cancelAfterHours ?? 48)}>
                  <option value="24">24 hours</option>
                  <option value="48">48 hours</option>
                  <option value="72">3 days</option>
                  <option value="168">7 days</option>
                  <option value="0">Never</option>
                </select>
              </label>
              <div className="ms-link-wide">
                <button className="ms-btn primary" type="submit">
                  Connect Shopify
                </button>
              </div>
            </form>
          ) : (
            <p className="ms-dim">An owner or admin can connect a Shopify store.</p>
          )}
          <h3>In Shopify</h3>
          <ol>
            <li>
              <strong>Settings → Payments → Manual payment methods</strong>: create a custom payment method with the same name.
            </li>
            <li>
              <strong>Settings → Checkout → Customize</strong>: add <strong>PayRouta Pay now</strong> to the Thank you and order status
              pages.
            </li>
          </ol>
          {(shops.length > 0 || paymentsApp) && (
            <>
              <h3>Payments app</h3>
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
              {paymentsApp && configure && (
                <form action="/api/integrations/shopify/install" method="get" className="ms-inline-form">
                  <input type="hidden" name="orgId" value={orgId} />
                  <label htmlFor="shopify-shop">Store address</label>
                  <input id="shopify-shop" name="shop" placeholder="your-store.myshopify.com" defaultValue={prefill} required pattern="[a-z0-9][a-z0-9\-]*\.myshopify\.com" />
                  <button className="ms-btn primary" type="submit">
                    Connect payments app
                  </button>
                </form>
              )}
            </>
          )}
          <p className="ms-dim">
            <a href={docsUrl("shopify")}>Shopify guide</a>
          </p>
        </section>
        <section id="woocommerce">
          <h2>WooCommerce</h2>
          <ol>
            <li>
              <a href="/downloads/payrouta-checkout.zip" download>
                Download the plugin
              </a>
              , then upload and activate it under <strong>Plugins → Add New</strong>.
            </li>
            <li>
              Check that your checkout return website under Settings is the store&apos;s address, and create an API key with{" "}
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
        <section id="checkout-button">
          <h2>Checkout button</h2>
          <pre className="ms-code">{`<script src="${appOrigin}/js/v1/payrouta.js" async></script>
<button data-payrouta-checkout="/create-checkout">Checkout</button>`}</pre>
          <p className="ms-dim">
            <a href={docsUrl("checkout-button")}>Checkout button guide</a>
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
          <Empty title="No payment issues" />
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
          <div className="ms-rates">
            <div>
              <strong>{partner.rate}</strong>
              <span>
                {partner.methods}, plus the processing partner&apos;s fee. Up to {partner.cap} per payment.
              </span>
            </div>
            <div>
              <strong>{direct.rate}</strong>
              <span>{direct.methods}. No partner fee.</span>
            </div>
          </div>
        </section>
        <section className="ms-flush">
          <div className="ms-card-head">
            <h2>Usage</h2>
            <div className="ms-head-tools">
              <form method="get" className="ms-inline">
                <input type="hidden" name="orgId" value={orgId} />
                <input type="hidden" name="environment" value={env} />
                <input type="month" name="month" defaultValue={month} required aria-label="Month" />
                <button type="submit" className="tr-secondary">View</button>
              </form>
              <a
                className="ms-btn"
                href={`/api/merchant/billing?orgId=${encodeURIComponent(orgId)}&environment=${env}&month=${month}`}
              >
                <Download size={15} aria-hidden /> Fee details
              </a>
            </div>
          </div>
          {env === "sandbox" ? (
            <Empty title="Test payments are free" />
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
            <Empty title="No fees this month" />
          )}
        </section>
        <section className="ms-flush">
          <div className="ms-card-head">
            <h2>Monthly statements</h2>
          </div>
          {statements.length ? (
            <ul className="ms-list ms-list-pad">
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
            <Empty title="No statement for this month yet" />
          )}
        </section>
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
          </div>
          <div className="ms-kpi">
            <span>Chose a method</span>
            <strong>{rate(metrics.selected)}</strong>
          </div>
          <div className="ms-kpi">
            <span>Saved by a backup processor</span>
            <strong>{metrics.fallback}</strong>
          </div>
          <div className="ms-kpi">
            <span>Payments succeeded</span>
            <strong>{metrics.confirmed}</strong>
          </div>
        </div>
        <section className="ms-flush">
          <div className="ms-card-head">
            <div>
              <h2>
                Attempt outcomes, {day(new Date(metrics.from))} to {day(new Date(metrics.to))}
              </h2>
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
        <AccountSecurity twoFactorEnabled={!!user.user.twoFactorEnabled} />
      </>
    );
  else if (section === "settings") {
    const [logo, brand] = await Promise.all([
      db.merchantLogo.findUnique({ where: { orgId }, select: { key: true } }),
      merchantBrand(orgId),
    ]);
    content = (
      <>
        <section>
          <h2>Business details</h2>
          <dl className="ms-props">
            <dt>Business name</dt>
            <dd>{membership.org.name}</dd>
            <dt>Website</dt>
            <dd>{brand.website ?? <Link href={href("activation")}>Add</Link>}</dd>
            <dt>Support email</dt>
            <dd>{brand.supportEmail ?? <Link href={href("activation")}>Add</Link>}</dd>
            <dt>Country</dt>
            <dd>{countries.find((c) => c.id === config.country)?.name ?? config.country}</dd>
            <dt>Checkout return website</dt>
            <dd>{config.returnOrigin}</dd>
            <dt>Your role</dt>
            <dd>{membership.role}</dd>
          </dl>
        </section>
        {configure && <LogoSetting orgId={orgId} name={membership.org.name} logo={logo ? logoUrl(logo.key) : null} />}
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
  } else {
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
    const [linkCount, shopCount, intentsCount, bankCount, receiveCount] = await Promise.all([
      db.paymentLink.count({ where: scope }),
      db.shopifyLiteShop.count({ where: { orgId, uninstalledAt: null } }),
      db.intentsAccount.count({ where: { orgId, environment: env, revokedAt: null } }),
      db.fiatPayoutAccount.count({ where: { orgId, environment: env, settleCheckouts: true } }).then(
        async (n) => n + (await db.settlementAddress.count({ where: { orgId, environment: env, active: true } })),
      ),
      stablecoinOverview(orgId, env).then((a) => a.filter((x) => x.remaining > 0).length),
    ]);
    const live = env === "production";
    const cryptoLive = config.environment === "production";
    const fiatLive = approvedAccounts > 0 || treasury.account?.state === "Live";
    const setup: { done: boolean; label: string; path: string; also?: [string, string][] }[] = [
      { done: live ? cryptoLive || fiatLive : !!treasury.steps.terms || cryptoLive, label: "Activate payments", path: "activation" },
      {
        done: intentsCount > 0 || bankCount > 0 || receiveCount > 0 || fiatLive,
        label: "Choose where you get paid",
        path: live ? "crypto-balance" : "payment-methods",
      },
      {
        done: linkCount > 0 || keyCount > 0 || shopCount > 0,
        label: "Start selling",
        path: "payment-links?create=1",
        also: [
          ["Payment link", "payment-links?create=1"],
          ["Shopify", "developers/integrations#shopify"],
          ["WooCommerce", "developers/integrations#woocommerce"],
          ["Checkout button", "developers/integrations#checkout-button"],
        ],
      },
      {
        done: count > 0,
        label: live ? "Take your first payment" : "Take a test payment",
        path: "payment-links",
      },
    ];
    const next = setup.findIndex((x) => !x.done);
    // A dashboard path that may carry its own query or #anchor.
    const to = (path: string) => {
      const [rest, hash] = path.split("#");
      const [p, q] = rest.split("?");
      return href(p) + (q ? `&${q}` : "") + (hash ? `#${hash}` : "");
    };
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
    const balance = treasury.balances[0];
    if (configure)
      actions = (
        <Link className="ms-btn primary" href={href("payment-links") + "&create=1"}>
          <Plus size={15} aria-hidden /> Payment link
        </Link>
      );
    content = (
      <>
        {treasury.account && <TreasuryBanner view={treasury} href={href} />}
        {next !== -1 && (
          <section
            className="ms-setup"
            style={{ "--p": setup.filter((x) => x.done).length / setup.length } as React.CSSProperties}
          >
            <div className="ms-card-head">
              <h2>Setup guide</h2>
              <span className="ms-setup-count">
                {setup.filter((x) => x.done).length} of {setup.length}
              </span>
            </div>
            <ol className="ms-guide">
              {setup.map((s, i) => (
                <li key={s.label} className={s.done ? "done" : i === next ? "next" : undefined}>
                  <span className="ms-guide-mark" aria-hidden>
                    {s.done ? "✓" : i + 1}
                  </span>
                  <span className="ms-guide-label">
                    {s.label}
                    <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                    {i === next && s.also && (
                      <span className="ms-guide-also">
                        {s.also.map(([label, path]) => (
                          <Link key={label} href={to(path)}>
                            {label}
                          </Link>
                        ))}
                      </span>
                    )}
                  </span>
                  {i === next && (
                    <Link className="ms-btn primary" href={to(s.path)}>
                      Start
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}
        <div className="ms-kpis">
          <div className="ms-kpi">
            <span>Payments received</span>
            <strong>{confirmed}</strong>
          </div>
          <div className="ms-kpi">
            <span>Success rate</span>
            <strong>{successRate === null ? "—" : `${successRate}%`}</strong>
          </div>
          <div className="ms-kpi">
            <span>Available to pay out</span>
            <strong>
              {balance ? <Link href={href("balances")}>{money(balance.asset, balance.available)}</Link> : "—"}
            </strong>
          </div>
          <div className="ms-kpi">
            <span>Needs attention</span>
            <strong>{attention ? <Link href={href("reconciliation")}>{attention}</Link> : attention}</strong>
          </div>
        </div>
        {count > 0 && (
        <section>
          <h2>Successful payments, last 7 days</h2>
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
        )}
        <section className="ms-flush">
          <div className="ms-card-head">
            <h2>Recent payments</h2>
            {recent.length > 0 && <Link href={href("payments")}>View all →</Link>}
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
            <Empty title="No payments yet" />
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
