// Operations console for the aggregator, patterned on platform dashboards for
// connected accounts: an underwriting queue, a merchant page with everything
// needed for a decision, PayRouta's companies and platform accounts, and a
// risk view of disputes, reconciliation mismatches, money owed and failures.
import { VerifyGate } from "@/components/portal/verify-gate";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { internal } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import { db } from "@/lib/portal/db";
import { custodyBlocker, type PlatformCustody } from "@/lib/treasury/custody";
import { canTransition, merchantAccountStates, type MerchantAccountState } from "@/lib/treasury/merchant-account";
import { platformModule } from "@/lib/treasury/platforms/registry";
import { accountState, disputeLabel, disputeTone, money, payoutTone, requirementText, scheduleText, type Tone } from "@/lib/treasury/labels";
import { merchantTreasury } from "@/lib/treasury/views";
import { merchantTerms } from "@/lib/treasury/terms";
import { loadRequirements, onboardingDocumentIds } from "@/lib/merchant/requirements";
import { onboardingStatus, onboardingText, tierText } from "@/lib/treasury/labels";
import {
  ApproveForm,
  DocumentReview,
  EntityForm,
  OpenSubAccount,
  PlatformForm,
  QualifyPlatform,
  RerunReconciliation,
  TransitionControls,
} from "../controls";
import { ScreeningReviewForm } from "../../partners/controls";
import "@/components/portal/portal.css";
import "../treasury-ops.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Treasury | Operations", robots: { index: false, follow: false } };

const tabs = [
  ["underwriting", "Underwriting"],
  ["merchants", "Merchants"],
  ["risk", "Risk & money"],
  ["platforms", "Platform accounts"],
] as const;

function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`ot-pill ${tone}`}>{children}</span>;
}
const day = (d: Date) => d.toISOString().slice(0, 10);
const stateTone = (s: string): Tone => accountState[s]?.tone ?? "neutral";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  try {
    await internal();
  } catch (error) {
    if (error instanceof PortalError && error.status === 401) redirect("/provider/sign-in");
    if (error instanceof PortalError)
      return <VerifyGate code={error.message} />;
    throw error;
  }
  const parts = (await params).path ?? ["underwriting"];
  const query = await searchParams;
  const tab = parts[0];
  if (!tabs.some(([t]) => t === tab) || parts.length > 2 || (parts.length === 2 && tab !== "merchants")) notFound();
  let content: ReactNode;
  if (tab === "merchants" && parts[1]) content = await MerchantDetail({ orgId: parts[1], environment: query.environment ?? "sandbox" });
  else if (tab === "merchants") content = await MerchantList({ state: query.state, q: query.q });
  else if (tab === "risk") content = await Risk();
  else if (tab === "platforms") content = await Platforms();
  else content = await Underwriting();
  return (
    <div className="portal p-shell ot-shell">
      <aside className="p-sidebar">
        <Link href="/ops/applications" className="p-logo" aria-label="PayRouta operations home">
          <BrandLogo reverse />
        </Link>
        <div className="p-workspace-label">Internal operations</div>
        <nav aria-label="Treasury">
          <div>
            <h2>Treasury</h2>
            {tabs.map(([t, label]) => (
              <Link key={t} href={`/ops/treasury/${t}`} className={tab === t ? "active" : ""}>
                {label}
              </Link>
            ))}
            <h2>Elsewhere</h2>
            <Link href="/ops/applications">Operations home</Link>
            <Link href="/ops/payments">Payments</Link>
            <Link href="/ops/partners">Partner programmes</Link>
          </div>
        </nav>
      </aside>
      <div className="p-workarea">
        <header className="p-topbar">
          <strong>Treasury</strong>
        </header>
        <main className="p-content ot-content">{content}</main>
      </div>
    </div>
  );
}

async function names(orgIds: string[]) {
  const orgs = await db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } });
  return new Map(orgs.map((o) => [o.id, o.name]));
}

async function Underwriting() {
  // Documents sent without an application: a crypto-only merchant asking for
  // the verified tick (lib/merchant/requirements.ts identityVerified).
  const uploaded = await db.evidence.findMany({
    where: { requirementId: { in: onboardingDocumentIds }, reviewStatus: "Uploaded", deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: { orgId: true, createdAt: true },
    take: 200,
  });
  const documentOrgs = [...new Map(uploaded.map((d) => [d.orgId, d.createdAt])).entries()];
  const [waiting, queue, counts] = await Promise.all([
    db.merchantAccount.count({ where: { state: { in: ["Submitted", "Underwriting", "Returned"] } } }),
    db.merchantAccount.findMany({
      where: { state: { in: ["Submitted", "Underwriting", "Returned"] } },
      orderBy: { updatedAt: "asc" },
      take: 100,
    }),
    db.merchantAccount.groupBy({ by: ["state"], _count: { _all: true } }),
  ]);
  const orgNames = await names([...queue.map((q) => q.orgId), ...documentOrgs.map(([orgId]) => orgId)]);
  const count = (s: string) => counts.find((c) => c.state === s)?._count._all ?? 0;
  return (
    <>
      <h1>Underwriting</h1>
      <div className="ot-stats">
        {merchantAccountStates.map((s) => (
          <Link key={s} className="ot-stat" href={`/ops/treasury/merchants?state=${s}`}>
            <span>{accountState[s].label}</span>
            <strong>{count(s)}</strong>
          </Link>
        ))}
      </div>
      <section className="ot-panel">
        <h2>Waiting for a decision</h2>
        {waiting > queue.length && (
          <p className="ot-muted">
            Showing the oldest {queue.length} of {waiting}. <Link href="/ops/treasury/merchants">Search all merchants</Link>
          </p>
        )}
        {!queue.length ? (
          <p className="ot-muted">Nothing waiting.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Environment</th>
                <th>Status</th>
                <th>Waiting since</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link href={`/ops/treasury/merchants/${m.orgId}?environment=${m.environment}`}>{orgNames.get(m.orgId) ?? m.orgId}</Link>
                  </td>
                  <td>{m.environment}</td>
                  <td>
                    <Pill tone={stateTone(m.state)}>{m.state}</Pill>
                  </td>
                  <td>{day(m.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="ot-panel">
        <h2>Documents to review</h2>
        {!documentOrgs.length ? (
          <p className="ot-muted">Nothing waiting.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {documentOrgs.map(([orgId, at]) => (
                <tr key={orgId}>
                  <td>
                    <Link href={`/ops/treasury/merchants/${orgId}?environment=production`}>{orgNames.get(orgId) ?? orgId}</Link>
                  </td>
                  <td>{day(at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

async function MerchantList({ state, q }: { state?: string; q?: string }) {
  const search = q?.trim().slice(0, 100);
  const where = {
    ...(state && merchantAccountStates.includes(state as MerchantAccountState) ? { state } : {}),
    ...(search ? { org: { name: { contains: search, mode: "insensitive" as const } } } : {}),
  };
  const rows = await db.merchantAccount.findMany({ where, orderBy: { updatedAt: "desc" }, take: 200, include: { legalEntity: true } });
  const orgNames = await names(rows.map((r) => r.orgId));
  return (
    <>
      <h1>Merchants{state ? ` · ${state}` : ""}</h1>
      <form className="ot-inline ot-search" action="/ops/treasury/merchants" role="search">
        <label>
          Merchant name
          <input name="q" defaultValue={search ?? ""} />
        </label>
        {state && <input type="hidden" name="state" value={state} />}
        <button>Search</button>
      </form>
      <section className="ot-panel">
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Environment</th>
              <th>Status</th>
              <th>Risk tier</th>
              <th>Company</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>
                  <Link href={`/ops/treasury/merchants/${m.orgId}?environment=${m.environment}`}>{orgNames.get(m.orgId) ?? m.orgId}</Link>
                </td>
                <td>{m.environment}</td>
                <td>
                  <Pill tone={stateTone(m.state)}>{m.state}</Pill>
                </td>
                <td>{m.riskTier ?? "—"}</td>
                <td>{m.legalEntity?.name ?? "—"}</td>
                <td>{day(m.updatedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="ot-muted">No merchants.</p>}
      </section>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children ?? "—"}</dd>
    </div>
  );
}

async function MerchantDetail({ orgId, environment }: { orgId: string; environment: string }) {
  const org = await db.organization.findUnique({ where: { id: orgId } });
  if (!org) notFound();
  const account = await db.merchantAccount.findUnique({
    where: { orgId_environment: { orgId, environment } },
    include: { transitions: { orderBy: { createdAt: "desc" }, take: 20 }, legalEntity: true },
  });
  const profileRow = account
    ? await db.merchantKybProfile.findUnique({ where: { orgId_version: { orgId, version: account.profileVersion } } })
    : await db.merchantKybProfile.findFirst({ where: { orgId }, orderBy: { version: "desc" } });
  const profile = (profileRow?.data ?? {}) as Record<string, unknown> & {
    legalName?: string;
    tradingName?: string;
    businessType?: string;
    country?: string;
    registrationNumber?: string;
    taxId?: string;
    website?: string;
    productDescription?: string;
    industry?: string;
    monthlyVolume?: string;
    settlementCurrency?: string;
    representative?: { givenName: string; familyName: string; title: string; email: string };
    owners?: { givenName: string; familyName: string; country: string; ownershipPercent: number }[];
  };
  const [requirements, documentRows, requirementNames] = await Promise.all([
    loadRequirements(db, orgId, "production"),
    db.evidence.findMany({
      where: { orgId, requirementId: { in: onboardingDocumentIds }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.requirement.findMany({ where: { id: { in: onboardingDocumentIds } } }),
  ]);
  const documents = documentRows.map((d) => ({
    ...d,
    requirementName: requirementNames.find((r) => r.id === d.requirementId)?.name ?? "Document",
  }));
  const [details, screening, links, entities, platforms, view, reconciliations] = await Promise.all([
    account?.detailsVersion
      ? db.merchantVerificationDetails.findUnique({ where: { orgId_version: { orgId, version: account.detailsVersion } } })
      : null,
    profileRow
      ? db.merchantScreening.findFirst({ where: { orgId, profileVersion: profileRow.version }, orderBy: { createdAt: "desc" } })
      : null,
    db.merchantPlatformLink.findMany({ where: { orgId, environment }, include: { platformAccount: { include: { legalEntity: true } } } }),
    db.legalEntity.findMany({ orderBy: { name: "asc" } }),
    db.platformAccount.findMany({ where: { environment, enabled: true }, include: { legalEntity: true } }),
    merchantTreasury(orgId, environment),
    db.platformReconciliation.findMany({ where: { orgId, environment }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const summary = (details?.summary ?? null) as {
    representative?: { idNumberLast4?: string | null; addressCountry?: string };
    owners?: unknown[];
    payoutAccount?: { country?: string; currency?: string; holderName?: string; accountLast4?: string | null };
  } | null;
  const country = profile.country ?? "";
  const coverable = platforms
    .filter((p) => !account?.legalEntityId || p.legalEntityId === account.legalEntityId)
    .filter((p) => {
      const ok = custodyBlocker({
        custody: p.custody as PlatformCustody,
        merchantCountry: country,
        merchantCountries: p.merchantCountries as string[],
        licensedCountries: p.legalEntity.licensedCountries as string[],
      }) === null;
      return ok && !links.some((l) => l.platformAccountId === p.id && !["Failed", "Disconnected"].includes(l.state));
    })
    .map((p) => ({ id: p.id, label: `${p.legalEntity.name} · ${moduleName(p.provider)}` }));
  const state = account?.state as MerchantAccountState | undefined;
  const targets = state ? merchantAccountStates.filter((to) => to !== "Live" && canTransition(state, to)) : [];
  const terms = account?.terms ? merchantTerms.safeParse(account.terms) : null;
  return (
    <>
      <p className="ot-crumbs">
        <Link href="/ops/treasury/merchants">Merchants</Link> / {org.name}
      </p>
      <div className="ot-title">
        <h1>{profile.tradingName ?? profile.legalName ?? org.name}</h1>
        {state ? <Pill tone={stateTone(state)}>{state}</Pill> : <Pill tone="neutral">Not submitted</Pill>}
        <span className="ot-muted">{environment}</span>
      </div>
      <div className="ot-columns">
        <div className="ot-main">
          <section className="ot-panel">
            <h2>Business</h2>
            <dl className="ot-fields">
              <Field label="Legal name">{profile.legalName}</Field>
              <Field label="Type">{profile.businessType}</Field>
              <Field label="Country">{profile.country}</Field>
              <Field label="Registration">{profile.registrationNumber}</Field>
              <Field label="Tax ID">{profile.taxId}</Field>
              <Field label="Website">{profile.website && <a href={profile.website} target="_blank" rel="noreferrer">{profile.website}</a>}</Field>
              <Field label="Industry">{profile.industry}</Field>
              <Field label="Monthly volume">{profile.monthlyVolume}</Field>
              <Field label="Sells">{profile.productDescription}</Field>
              <Field label="Representative">
                {profile.representative && `${profile.representative.givenName} ${profile.representative.familyName}, ${profile.representative.title} · ${profile.representative.email}`}
              </Field>
              <Field label="Owners (25%+)">
                {profile.owners?.length ? profile.owners.map((o) => `${o.givenName} ${o.familyName} (${o.country}, ${o.ownershipPercent}%)`).join("; ") : "None declared"}
              </Field>
              <Field label="Profile version">{profileRow ? `v${profileRow.version}` : null}</Field>
            </dl>
          </section>
          <section className="ot-panel">
            <h2>Onboarding</h2>
            <dl className="ot-fields">
              <Field label="Tier">
                {tierText[requirements.tier]}
                {requirements.capUsd !== null && ` · up to $${requirements.capUsd.toLocaleString("en-US")} a month`}
                {requirements.overCap && " · over its limit"}
              </Field>
              <Field label="Last 30 days">${Math.round(requirements.monthlyUsd).toLocaleString("en-US")}</Field>
              {requirements.entries
                .filter((e) => e.status !== "later")
                .map((e) => (
                  <Field key={e.id} label={onboardingText[e.id]}>
                    <Pill tone={onboardingStatus[e.status].tone}>{onboardingStatus[e.status].label}</Pill>
                  </Field>
                ))}
            </dl>
            {documents.length > 0 && (
              <>
                <h3>Documents</h3>
                {documents.map((d) => (
                  <div key={d.id}>
                    <p>
                      {d.requirementName} · {d.scanStatus} · {d.reviewStatus}
                    </p>
                    {d.reviewStatus === "Uploaded" && (
                      <DocumentReview evidenceId={d.id} filename={d.filename} clean={d.scanStatus === "Clean" || d.scanStatus === "Fixture only"} />
                    )}
                  </div>
                ))}
              </>
            )}
          </section>
          <section className="ot-panel">
            <h2>Verification</h2>
            <dl className="ot-fields">
              <Field label="Screening">
                {screening ? (
                  <>
                    <Pill tone={screening.verdict === "clear" ? "good" : screening.verdict === "match" ? "bad" : "warn"}>{screening.verdict}</Pill>{" "}
                    {screening.provider} · {day(screening.createdAt)}
                  </>
                ) : (
                  "Not screened"
                )}
                {profileRow && screening?.verdict !== "clear" && (
                  <div className="ot-inline-form">
                    <ScreeningReviewForm orgId={orgId} profileVersion={profileRow.version} />
                  </div>
                )}
              </Field>
              <Field label="Identity details">
                {summary ? `Representative ID ending ${summary.representative?.idNumberLast4 ?? "—"} · ${summary.owners?.length ?? 0} owner(s)` : "Not provided"}
              </Field>
              <Field label="Payout account">
                {summary?.payoutAccount &&
                  `${summary.payoutAccount.holderName} · ${summary.payoutAccount.country} ${summary.payoutAccount.currency} · ending ${summary.payoutAccount.accountLast4}`}
              </Field>
              <Field label="Terms">{account?.agreementId ? "Accepted" : "Not accepted"}</Field>
            </dl>
          </section>
          <section className="ot-panel">
            <h2>Sub-accounts</h2>
            {!links.length && <p className="ot-muted">None yet.</p>}
            {links.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th>Platform account</th>
                    <th>Status</th>
                    <th>Payments / payouts</th>
                    <th>Still needed</th>
                    <th>Reconciliation</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => {
                    const rec = reconciliations.find((r) => r.linkId === l.id);
                    return (
                      <tr key={l.id}>
                        <td>
                          {l.platformAccount.legalEntity.name} · {moduleName(l.platformAccount.provider)}
                          <small className="ot-muted ot-block">{l.providerAccountId ?? "creating…"}</small>
                        </td>
                        <td>
                          <Pill tone={l.state === "Approved" ? "good" : ["Rejected", "Failed"].includes(l.state) ? "bad" : "warn"}>{l.state}</Pill>
                          {l.reason && <small className="ot-muted ot-block">{l.reason}</small>}
                        </td>
                        <td>
                          {l.paymentsEnabled ? "✓" : "✗"} / {l.payoutsEnabled ? "✓" : "✗"}
                        </td>
                        <td>{(l.requirements as string[]).map((r) => requirementText[r] ?? r).join("; ") || "—"}</td>
                        <td>
                          {rec ? <Pill tone={rec.result === "Matched" ? "good" : "bad"}>{rec.result}</Pill> : "—"} <RerunReconciliation linkId={l.id} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {state && ["Underwriting", "Live", "Restricted"].includes(state) && (
              <OpenSubAccount orgId={orgId} environment={environment} platforms={coverable} hasSubAccounts={links.length > 0} />
            )}
          </section>
          <section className="ot-panel">
            <h2>Money</h2>
            {!view.balances.length && <p className="ot-muted">No balance.</p>}
            {view.balances.map((b) => (
              <dl key={b.asset} className="ot-fields ot-money">
                <Field label="Currency">{b.asset.slice(5, 8)}</Field>
                <Field label="Available">{money(b.asset, b.available)}</Field>
                <Field label="Incoming">{money(b.asset, b.pending)}</Field>
                <Field label="Reserve">{money(b.asset, b.reserve)}</Field>
                <Field label="Dispute hold">{money(b.asset, b.held)}</Field>
                <Field label="In transit">{money(b.asset, b.inTransit)}</Field>
                <Field label="Owed to PayRouta">{money(b.asset, b.owed)}</Field>
              </dl>
            ))}
            {view.payouts.length > 0 && (
              <>
                <h3>Recent payouts</h3>
                <ul className="ot-list">
                  {view.payouts.slice(0, 8).map((p) => (
                    <li key={p.id}>
                      <Pill tone={payoutTone[p.state]}>{p.state}</Pill> {money(p.asset, p.amountMinor)} · {p.initiatedBy} · {p.createdAt.slice(0, 10)}
                      {p.failureCode && <span className="ot-muted"> · {p.failureCode}</span>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {view.disputes.length > 0 && (
              <>
                <h3>Disputes</h3>
                <ul className="ot-list">
                  {view.disputes.slice(0, 8).map((d) => (
                    <li key={d.id}>
                      <Pill tone={disputeTone[d.state]}>{disputeLabel[d.state]}</Pill> {money(d.asset, d.amountMinor)} · {d.reference} · {d.reason ?? "—"}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
        <aside className="ot-side">
          <section className="ot-panel">
            <h2>Decision</h2>
            {!account && <p className="ot-muted">The merchant hasn&apos;t submitted for review yet.</p>}
            {account && (
              <dl className="ot-fields ot-compact">
                <Field label="Company">{account.legalEntity?.name}</Field>
                <Field label="Risk tier">{account.riskTier}</Field>
                <Field label="Reserve">{terms?.success ? `${terms.data.reserve.basisPoints / 100}% for ${terms.data.reserve.holdDays} days` : null}</Field>
                <Field label="Payouts">{terms?.success ? `${scheduleText[terms.data.payout.schedule]}, ${terms.data.payout.delayDays}-day delay` : null}</Field>
                <Field label="Version">{account.version}</Field>
              </dl>
            )}
            {state === "Underwriting" && (
              <>
                <h3>Approve</h3>
                <ApproveForm
                  orgId={orgId}
                  environment={environment}
                  version={account!.version}
                  entities={entities.map((e) => ({ id: e.id, name: e.name }))}
                  currency={profile.settlementCurrency ?? "USD"}
                />
              </>
            )}
            {account && targets.length > 0 && (
              <>
                <h3>Other actions</h3>
                <TransitionControls orgId={orgId} environment={environment} version={account.version} targets={state === "Restricted" ? ["Live", ...targets] : targets} />
              </>
            )}
          </section>
          {account && (
            <section className="ot-panel">
              <h2>History</h2>
              <ol className="ot-timeline">
                {account.transitions.map((t) => (
                  <li key={t.id}>
                    <strong>
                      {t.from ?? "—"} → {t.to}
                    </strong>
                    <span className="ot-muted">
                      {t.createdAt.toISOString().slice(0, 16).replace("T", " ")} · {t.actorId}
                    </span>
                    <p>{t.reason}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}

function moduleName(provider: string) {
  try {
    return platformModule(provider).manifest.name;
  } catch {
    return provider;
  }
}

async function Risk() {
  const [disputes, mismatches, owed, failedPayouts, failedRefunds, events, failedLinks] = await Promise.all([
    db.platformDispute.findMany({ where: { state: "Open" }, orderBy: { evidenceDueBy: "asc" }, take: 50 }),
    db.platformReconciliation.findMany({ where: { result: "Mismatch" }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.merchantBalance.findMany({ where: { account: "merchant-receivable", balance: { lt: 0 } }, orderBy: { balance: "asc" }, take: 50 }),
    db.payout.findMany({ where: { state: "Failed" }, orderBy: { updatedAt: "desc" }, take: 25 }),
    db.platformRefund.findMany({ where: { state: "Failed" }, orderBy: { updatedAt: "desc" }, take: 25 }),
    db.platformEvent.findMany({ where: { state: { in: ["Unmatched", "Received"] } }, orderBy: { createdAt: "desc" }, take: 25 }),
    db.merchantPlatformLink.findMany({ where: { state: "Failed" }, orderBy: { updatedAt: "desc" }, take: 25 }),
  ]);
  const orgNames = await names([
    ...disputes.map((d) => d.orgId),
    ...mismatches.map((m) => m.orgId),
    ...owed.map((o) => o.orgId),
    ...failedPayouts.map((p) => p.orgId),
    ...failedRefunds.map((r) => r.orgId),
    ...failedLinks.map((l) => l.orgId),
  ]);
  const who = (orgId: string, environment: string) => (
    <Link href={`/ops/treasury/merchants/${orgId}?environment=${environment}`}>{orgNames.get(orgId) ?? orgId}</Link>
  );
  return (
    <>
      <h1>Risk & money</h1>
      <div className="ot-stats">
        <div className="ot-stat">
          <span>Open disputes</span>
          <strong>{disputes.length}</strong>
        </div>
        <div className="ot-stat">
          <span>Reconciliation mismatches</span>
          <strong>{mismatches.length}</strong>
        </div>
        <div className="ot-stat">
          <span>Merchants owing</span>
          <strong>{owed.length}</strong>
        </div>
        <div className="ot-stat">
          <span>Failed payouts / refunds</span>
          <strong>
            {failedPayouts.length} / {failedRefunds.length}
          </strong>
        </div>
      </div>
      <section className="ot-panel">
        <h2>Open disputes</h2>
        {!disputes.length ? (
          <p className="ot-muted">None.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Covered by</th>
                <th>Evidence due</th>
                <th>Merchant response</th>
              </tr>
            </thead>
            <tbody>
              {disputes.map((d) => (
                <tr key={d.id}>
                  <td>{who(d.orgId, d.environment)}</td>
                  <td>{money(d.asset, d.amountMinor.toFixed(0))}</td>
                  <td>{d.reason ?? "—"}</td>
                  <td>
                    balance {money(d.asset, d.fromAvailableMinor.toFixed(0))} · reserve {money(d.asset, d.fromReserveMinor.toFixed(0))} · owed{" "}
                    {money(d.asset, d.fromReceivableMinor.toFixed(0))}
                  </td>
                  <td>{d.evidenceDueBy ? day(d.evidenceDueBy) : "—"}</td>
                  <td>{d.evidenceSubmittedAt ? <Pill tone="good">Sent {day(d.evidenceSubmittedAt)}</Pill> : <Pill tone="warn">Not yet</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="ot-panel">
        <h2>Reconciliation mismatches</h2>
        {!mismatches.length ? (
          <p className="ot-muted">None.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Day</th>
                <th>Provider</th>
                <th>Ledger</th>
                <th>Difference</th>
              </tr>
            </thead>
            <tbody>
              {mismatches.map((m) => (
                <tr key={m.id}>
                  <td>{who(m.orgId, m.environment)}</td>
                  <td>{m.day}</td>
                  <td>{money(m.asset, m.providerMinor.toFixed(0))}</td>
                  <td>{money(m.asset, m.ledgerMinor.toFixed(0))}</td>
                  <td>{money(m.asset, (BigInt(m.providerMinor.toFixed(0)) - BigInt(m.ledgerMinor.toFixed(0))).toString())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="ot-panel">
        <h2>Money owed by merchants</h2>
        {!owed.length ? (
          <p className="ot-muted">None.</p>
        ) : (
          <ul className="ot-list">
            {owed.map((o) => (
              <li key={`${o.orgId}:${o.environment}:${o.asset}`}>
                {who(o.orgId, o.environment)} · {money(o.asset, (-BigInt(o.balance.toFixed(0))).toString())} · since last movement {day(o.updatedAt)}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="ot-panel">
        <h2>Failures</h2>
        <ul className="ot-list">
          {failedPayouts.map((p) => (
            <li key={p.id}>
              <Pill tone="bad">Payout failed</Pill> {who(p.orgId, p.environment)} · {money(p.asset, p.amountMinor.toFixed(0))} · {p.failureCode}
            </li>
          ))}
          {failedRefunds.map((r) => (
            <li key={r.id}>
              <Pill tone="bad">Refund failed</Pill> {who(r.orgId, r.environment)} · {money(r.asset, r.amountMinor.toFixed(0))} · {r.failureCode}
            </li>
          ))}
          {failedLinks.map((l) => (
            <li key={l.id}>
              <Pill tone="bad">Sub-account failed</Pill> {who(l.orgId, l.environment)} · {l.reason}
            </li>
          ))}
          {!failedPayouts.length && !failedRefunds.length && !failedLinks.length && <li className="ot-muted">None.</li>}
        </ul>
      </section>
      <section className="ot-panel">
        <h2>Provider events waiting</h2>
        {!events.length ? (
          <p className="ot-muted">None.</p>
        ) : (
          <ul className="ot-list">
            {events.map((e) => (
              <li key={e.id}>
                <Pill tone={e.state === "Unmatched" ? "warn" : "neutral"}>{e.state}</Pill> {e.type} · {e.objectRef ?? e.accountRef ?? "—"} · {e.createdAt.toISOString().slice(0, 16)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

async function Platforms() {
  const [entities, accounts] = await Promise.all([
    db.legalEntity.findMany({ orderBy: { name: "asc" } }),
    db.platformAccount.findMany({ include: { legalEntity: true }, orderBy: [{ provider: "asc" }, { environment: "asc" }] }),
  ]);
  const providers = [
    "paystack-split",
    "flutterwave-split",
    "monnify-split",
    "bridge-split",
    "yellowcard-split",
    "dlocal",
    "tink",
    "adyen-klarna-bnpl",
    "mercadopago-bnpl",
    "migo-bnpl",
    "xendit-bnpl",
    "sandbox-platform",
    "sandbox-split",
    "sandbox-credit",
  ].flatMap((id) => {
    try {
      const m = platformModule(id).manifest;
      return [
        {
          id,
          name: m.name,
          custody: m.custody,
          methods: m.methods.join(", "),
          countries: m.merchantCountries ? m.merchantCountries.join(", ") : "All",
          lender: m.credit?.lender ?? "—",
        },
      ];
    } catch {
      return [];
    }
  });
  return (
    <>
      <h1>Platform accounts</h1>
      <section className="ot-panel">
        <h2>PayRouta companies</h2>
        <table>
          <thead>
            <tr>
              <th>Company</th>
              <th>Jurisdiction</th>
              <th>Licensed to hold funds in</th>
            </tr>
          </thead>
          <tbody>
            {entities.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.jurisdiction}</td>
                <td>{(e.licensedCountries as string[]).join(", ") || "Nowhere (partner-held and split settlement only)"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <EntityForm />
      </section>
      <section className="ot-panel">
        <h2>Master accounts at providers</h2>
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Company</th>
              <th>Environment</th>
              <th>Custody</th>
              <th>Countries</th>
              <th>Status</th>
              <th>Webhook URL path</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{moduleName(a.provider)}</td>
                <td>{a.legalEntity.name}</td>
                <td>{a.environment}</td>
                <td>{a.custody}</td>
                <td>{(a.merchantCountries as string[]).join(", ")}</td>
                <td>
                  <Pill tone={a.enabled ? "good" : "neutral"}>{a.enabled ? "Enabled" : "Disabled"}</Pill>{" "}
                  {a.environment === "sandbox" &&
                    (a.qualifiedAt ? <Pill tone="good">Qualified {day(a.qualifiedAt)}</Pill> : a.enabled && <QualifyPlatform platformAccountId={a.id} />)}
                  <small className="ot-muted ot-block">Settings: {Object.keys(a.config as object).sort().join(", ") || "—"}</small>
                </td>
                <td>
                  <code>
                    /api/treasury/events/{a.provider}/{a.environment}
                  </code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {entities.length > 0 ? <PlatformForm entities={entities.map((e) => ({ id: e.id, name: e.name }))} providers={providers} /> : <p className="ot-muted">Add a company first.</p>}
      </section>
      <section className="ot-panel">
        <h2>Registered platform modules</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Module ID</th>
              <th scope="col">Name</th>
              <th scope="col">Custody</th>
              <th scope="col">Methods</th>
              <th scope="col">Countries</th>
              <th scope="col">Credit lender</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id}>
                <td>
                  <code>{p.id}</code>
                </td>
                <td>{p.name}</td>
                <td>{p.custody}</td>
                <td>{p.methods}</td>
                <td>{p.countries}</td>
                <td>{p.lender}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
