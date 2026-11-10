// Server-rendered treasury sections of the merchant workspace. Patterned on
// established processor dashboards: an activation checklist, a balances page
// split into what can be paid out and what is still on its way, a payout
// history, disputes with response deadlines and a money panel on each
// payment. Merchants only ever see PayRouta.
import Link from "next/link";
import type { ReactNode } from "react";
import { currencyExponent } from "@/lib/partners/money";
import {
  accountState,
  onboardingText,
  tierText,
  disputeLabel,
  disputeTone,
  money,
  payoutTone,
  refundTone,
  requirementText,
  scheduleText,
  type Tone,
} from "@/lib/treasury/labels";
import type { merchantTreasury, paymentFunds } from "@/lib/treasury/views";
import { Empty } from "./format";
import { VerifiedTick } from "@/components/verified-tick";
import { AcceptTerms, DisputeResponse, PayoutRequest, RefundPanel, SubmitForReview, VerificationForm } from "./treasury";
import { BasicDetailsForm, BusinessDetailsForm, DocumentUpload, GoLiveWithCrypto, type ActivationProfile } from "./activation";
import {
  identityVerified,
  onboardingDocuments,
  type OnboardingDocument,
  type RequirementId,
  type Requirements,
} from "@/lib/merchant/requirements";

type View = Awaited<ReturnType<typeof merchantTreasury>>;
type Funds = NonNullable<Awaited<ReturnType<typeof paymentFunds>>>;

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`tr-pill ${tone}`}>{children}</span>;
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function TreasuryBanner({ view, href }: { view: View; href: (p: string) => string }) {
  const state = view.account?.state;
  if (state === "Live") return null;
  const info = state ? accountState[state] : null;
  return (
    <div className={`tr-banner ${info?.tone ?? "neutral"}`}>
      <div>
        <strong>{!state ? "Activate payments" : info!.label === "Action needed" ? "Your account needs attention" : `Account ${info!.label.toLowerCase()}`}</strong>
        {info?.detail && <p>{info.detail}</p>}
      </div>
      <Link className="tr-button" href={href("activation")}>
        {!state ? "Start activation" : "View details"}
      </Link>
    </div>
  );
}

function Step({
  n,
  done,
  title,
  children,
  current,
  status,
}: {
  n: number;
  done: boolean;
  title: string;
  children: ReactNode;
  current: boolean;
  status?: string;
}) {
  return (
    <li className={`tr-step ${done ? "done" : ""} ${current ? "current" : ""}`} aria-current={current ? "step" : undefined}>
      <span className="tr-step-mark" aria-hidden>
        {done ? "✓" : n}
      </span>
      <div>
        <h3>
          {title}
          <span className="sr-only">{done ? " (done)" : ""}</span> {status && <Pill tone="neutral">{status}</Pill>}
        </h3>
        {children}
      </div>
    </li>
  );
}

// What each capability still needs: crypto goes live on its own; cards and
// bank payments are reviewed; requirements grow with type and volume.
export function ActivationSection({
  orgId,
  view,
  requirements: r,
  profile,
  environment,
  email,
}: {
  orgId: string;
  view: View;
  requirements: Requirements;
  profile: ActivationProfile;
  environment: string;
  email: string;
}) {
  const a = view.account;
  const submitted = !!a && a.state !== "Returned";
  const info = a ? accountState[a.state] : null;
  const status = new Map(r.entries.map((e) => [e.id, e.status]));
  const open = (...ids: RequirementId[]) => ids.some((id) => ["due", "upgrade"].includes(status.get(id) ?? ""));
  const basicsDone = status.get("name") === "done" && status.get("country") === "done";
  const individual = r.tier === "individual";
  const country = profile.country ?? "NG";
  const fiatItems = r.entries.filter((e) => !["name", "country", "terms"].includes(e.id) && e.status !== "later");
  const later = r.entries.filter((e) => e.status === "later");
  const cryptoLive = environment === "production";
  // Each step covers the requirement items it collects; a step with nothing
  // to collect at this tier is left out.
  const needs = (...ids: RequirementId[]) => fiatItems.filter((e) => ids.includes(e.id));
  const businessIds: RequirementId[] = ["what-you-sell", "support-email", "registration-number", "business-address", "representative", "owners"];
  const identityIds: RequirementId[] = ["personal-details", "id-number", "payout-account"];
  const documentIds = Object.keys(onboardingDocuments) as OnboardingDocument[];
  const fiatSteps = [
    {
      title: individual ? "Your business" : "Business details",
      items: needs(...businessIds),
      body: (
        <BusinessDetailsForm
          orgId={orgId}
          profile={profile}
          registered={!individual}
          owners={open("owners") || (profile.owners?.length ?? 0) > 0}
          email={email}
          done={!open(...businessIds)}
        />
      ),
    },
    {
      title: individual ? "Your identity and payout account" : "Director's identity and payout account",
      items: needs(...identityIds),
      body: (
        <VerificationForm
          orgId={orgId}
          owners={(profile.owners ?? []).map((o) => ({ name: `${o.givenName} ${o.familyName}` }))}
          country={country}
          holderName={profile.legalName}
          individual={individual}
          saved={(view.steps.details?.summary as Parameters<typeof VerificationForm>[0]["saved"]) ?? null}
        />
      ),
    },
    {
      title: individual ? "Photo of your ID" : "Documents",
      items: needs(...documentIds),
      body: (
        <>
          {documentIds
            .filter((d) => open(d))
            .map((d) => (
              <DocumentUpload
                key={d}
                orgId={orgId}
                country={country}
                requirementId={onboardingDocuments[d]}
                label={onboardingText[d]}
                hideLabel={individual}
              />
            ))}
        </>
      ),
    },
  ]
    .filter((step) => step.items.length > 0)
    .map((step) => ({
      ...step,
      done: step.items.every((e) => e.status === "done" || e.status === "in-review"),
      inReview: step.items.some((e) => e.status === "in-review"),
    }));
  if (!submitted)
    fiatSteps.push({
      title: a?.state === "Returned" ? "Resubmit for review" : "Submit for review",
      items: [],
      done: false,
      inReview: false,
      body: <SubmitForReview orgId={orgId} ready={r.ready.fiat} resubmit={a?.state === "Returned"} />,
    });
  return (
    <>
      <section>
        <ol className="tr-steps">
          <Step n={1} done={basicsDone} title="Your details" current={!basicsDone}>
            <BasicDetailsForm orgId={orgId} profile={profile} />
          </Step>
          <Step n={2} done={!!view.steps.terms} title="Merchant terms" current={basicsDone && !view.steps.terms}>
            <AcceptTerms orgId={orgId} accepted={view.steps.terms?.acceptedAt ?? null} />
          </Step>
        </ol>
      </section>

      <section>
        <div className="tr-row">
          <h2>Crypto and stablecoins</h2>
          <Pill tone={cryptoLive ? "good" : r.ready.crypto ? "neutral" : "warn"}>
            {cryptoLive ? "Live" : r.ready.crypto ? "Ready" : "Not live"}
          </Pill>
        </div>
        {cryptoLive ? null : r.ready.crypto ? (
          <GoLiveWithCrypto orgId={orgId} />
        ) : r.screening === "match" ? (
          <p>We can&apos;t activate crypto for this account. Contact PayRouta.</p>
        ) : basicsDone && view.steps.terms ? (
          <p>{r.screening === "review" ? "We're checking a few details." : "Running automatic checks."}</p>
        ) : null}
      </section>

      <VerifiedTickSection orgId={orgId} requirements={r} country={country} basicsDone={basicsDone} status={status} />

      <section>
        <div className="tr-row">
          <h2>Cards, bank transfers and mobile money</h2>
          {info && <Pill tone={info.tone}>{info.label}</Pill>}
        </div>
        {a && ["Submitted", "Underwriting", "Live"].includes(a.state) && (
          <ol className="tr-track" aria-label="Review progress">
            {["Submitted", "In review", "Active"].map((label, i) => {
              // Steps up to the account's state are done; the next one is current.
              const at = ["Submitted", "Underwriting", "Live"].indexOf(a.state);
              const done = i <= at;
              const current = i === at + 1;
              return (
                <li key={label} className={done ? "done" : current ? "current" : ""} aria-current={current ? "step" : undefined}>
                  <span aria-hidden>{done ? "✓" : i + 1}</span>
                  {label}
                </li>
              );
            })}
          </ol>
        )}
        <p>
          {tierText[r.tier]}
          {r.capUsd !== null && <> · up to ${r.capUsd.toLocaleString("en-US")} a month</>}
        </p>
        {r.overCap && (
          <p role="status" className="tr-message">
            {individual
              ? `You're selling more than $${r.capUsd!.toLocaleString("en-US")} a month. Register your business to go higher.`
              : `You're selling more than $${r.capUsd!.toLocaleString("en-US")} a month. Complete the steps below to go higher.`}
          </p>
        )}
        {a?.note && (
          <blockquote>
            <strong>From our review team:</strong> {a.note}
          </blockquote>
        )}
        {view.paymentsAccount && view.paymentsAccount.requirements.length > 0 && (
          <ul className="tr-requirements">
            {view.paymentsAccount.requirements.map((x) => (
              <li key={x}>{requirementText[x] ?? requirementText.review}</li>
            ))}
          </ul>
        )}
        <ol className="tr-steps">
          {fiatSteps.map((step, i) => (
            <Step
              key={step.title}
              n={i + 1}
              done={step.done}
              title={step.title}
              current={basicsDone && !step.done && fiatSteps.findIndex((x) => !x.done) === i}
              status={step.inReview ? "In review" : undefined}
            >
              {(basicsDone || !step.items.length) && step.body}
            </Step>
          ))}
        </ol>
        {later.length > 0 && (
          <details>
            <summary>Needed later</summary>
            <ul className="tr-checklist">
              {later.map((e) => (
                <li key={e.id}>{onboardingText[e.id]}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </>
  );
}

// The verified tick customers see beside the business at checkout. Cards,
// bank and cash out need these documents anyway; a merchant who only takes
// and keeps crypto can choose to send them for the tick.
function VerifiedTickSection({
  orgId,
  requirements: r,
  country,
  basicsDone,
  status,
}: {
  orgId: string;
  requirements: Requirements;
  country: string;
  basicsDone: boolean;
  status: Map<RequirementId, string>;
}) {
  const verified = identityVerified(r);
  const needed: OnboardingDocument[] = r.tier === "individual" ? ["government-id"] : ["government-id", "registration-certificate"];
  const missing = needed.filter((d) => !["done", "in-review"].includes(status.get(d) ?? ""));
  const inReview = needed.some((d) => status.get(d) === "in-review");
  return (
    <section>
      <div className="tr-row">
        <h2 className="tr-tick-title">
          Verified tick <VerifiedTick />
        </h2>
        <Pill tone={verified ? "good" : "neutral"}>{verified ? "Verified" : inReview && !missing.length ? "In review" : "Optional"}</Pill>
      </div>
      {!verified && basicsDone && missing.length > 0 && (
        <>
          {missing.map((d) => (
            <DocumentUpload key={d} orgId={orgId} country={country} requirementId={onboardingDocuments[d]} label={onboardingText[d]} />
          ))}
        </>
      )}
    </section>
  );
}

export function BalancesSection({ orgId, view, href }: { orgId: string; view: View; href: (p: string) => string }) {
  const live = view.account?.state === "Live" || view.account?.state === "Offboarding";
  const terms = view.terms;
  const payouts = !view.account || !!view.paymentsAccount?.payoutsByPayRouta || view.payouts.length > 0;
  const balances = view.balances.length
    ? view.balances
    : [{ asset: "", available: "0", pending: "0", reserve: "0", inTransit: "0", held: "0", owed: "0" }];
  return (
    <>
      <TreasuryBanner view={view} href={href} />
      {balances.map((b) => {
        const show = (minor: string) => (b.asset ? money(b.asset, minor) : "—");
        const parts = [
          ["Incoming", b.pending],
          ["Reserve", b.reserve],
          ["On the way to your bank", b.inTransit],
          ["On hold for disputes", b.held],
          ["Owed to PayRouta", b.owed],
        ].filter(([, v], i) => i === 0 || v !== "0");
        return (
          <section key={b.asset || "none"} className="tr-balance">
            <h2>{b.asset ? `${b.asset.slice(5, 8)} balance` : "Balance"}</h2>
            <div className="tr-balance-head">
              <div className="tr-balance-main">
                <span>Available to pay out</span>
                <strong>{show(b.available)}</strong>
              </div>
              {live && view.paymentsAccount?.payoutsByPayRouta && b.available !== "0" && (
                <PayoutRequest
                  orgId={orgId}
                  balances={[
                    {
                      asset: b.asset,
                      available: b.available,
                      label: money(b.asset, b.available),
                      exponent: currencyExponent(b.asset.slice(5, 8)) ?? 2,
                    },
                  ]}
                />
              )}
            </div>
            <dl className="tr-balance-parts">
              {parts.map(([label, v]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{show(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
      {payouts && (
        <section className="ms-flush">
          <div className="ms-card-head">
            <h2>Payouts</h2>
            {terms && (
              <span className="tr-meta">
                {scheduleText[terms.payout.schedule]}
                {terms.payout.delayDays > 0 && <> · {terms.payout.delayDays}-day delay</>}
              </span>
            )}
          </div>
          <PayoutTable payouts={view.payouts} />
        </section>
      )}
    </>
  );
}

function PayoutTable({ payouts }: { payouts: View["payouts"] }) {
  if (!payouts.length) return <Empty title="No payouts yet" />;
  return (
    <div className="p-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Amount</th>
            <th>Status</th>
            <th>Type</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {payouts.map((p) => (
            <tr key={p.id}>
              <td className="tr-amount">{money(p.asset, p.amountMinor)}</td>
              <td>
                <Pill tone={payoutTone[p.state]}>{p.state === "In transit" ? "On the way" : p.state}</Pill>
                {p.state === "Failed" && <small className="tr-sub"> Returned to your balance</small>}
              </td>
              <td>{p.initiatedBy}</td>
              <td>{date(p.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DisputesSection({
  orgId,
  view,
  href,
  canRespond,
}: {
  orgId: string;
  view: View;
  href: (p: string) => string;
  canRespond: boolean;
}) {
  const open = view.disputes.filter((d) => d.state === "Open");
  return (
    <>
      <TreasuryBanner view={view} href={href} />
      {open.length > 0 && (
        <div className="tr-banner warn">
          <div>
            <strong>
              {open.length} open {open.length === 1 ? "dispute" : "disputes"}
            </strong>
          </div>
        </div>
      )}
      <section className="ms-flush">
        {!view.disputes.length ? (
          <Empty title="No disputes" />
        ) : (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Reason</th>
                  <th>Payment</th>
                  <th>Respond by</th>
                  <th>Your response</th>
                </tr>
              </thead>
              <tbody>
                {view.disputes.map((d) => (
                  <tr key={d.id}>
                    <td className="tr-amount">
                      {money(d.asset, d.amountMinor)}
                      {d.feeMinor !== "0" && <small className="tr-sub"> + {money(d.asset, d.feeMinor)} fee</small>}
                    </td>
                    <td>
                      <Pill tone={disputeTone[d.state]}>{disputeLabel[d.state]}</Pill>
                    </td>
                    <td>{(d.reason ?? "—").replace(/_/g, " ")}</td>
                    <td>
                      <Link href={href(`payments/${d.intentId}`)}>{d.reference}</Link>
                    </td>
                    <td>{d.state === "Open" && d.evidenceDueBy ? date(d.evidenceDueBy) : "—"}</td>
                    <td>
                      {d.evidenceSubmittedAt ? (
                        <Pill tone="good">Sent {date(d.evidenceSubmittedAt)}</Pill>
                      ) : respondable(d) ? (
                        <a href={`#respond-${d.id}`}>Response needed</a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {canRespond &&
        view.disputes.filter(respondable).map((d) => (
          <section key={d.id} id={`respond-${d.id}`} className="tr-respond">
            <h2>
              Respond to the {money(d.asset, d.amountMinor)} dispute on {d.reference}
            </h2>
            <p className="tr-hint">
              Reason given by the customer&apos;s bank: <strong>{(d.reason ?? "not stated").replace(/_/g, " ")}</strong>
              {d.evidenceDueBy && <> · respond by {date(d.evidenceDueBy)}</>}
            </p>
            <DisputeResponse orgId={orgId} disputeId={d.id} reason={d.reason} />
          </section>
        ))}
    </>
  );
}

const respondable = (d: View["disputes"][number]) =>
  d.state === "Open" && !d.evidenceSubmittedAt && (!d.evidenceDueBy || new Date(d.evidenceDueBy) > new Date());

export function PaymentFundsPanel({ orgId, intentId, funds, canRefund }: { orgId: string; intentId: string; funds: Funds; canRefund: boolean }) {
  const exponent = currencyExponent(funds.asset.slice(5, 8)) ?? 2;
  return (
    <div className="tr-funds">
      <h3>Money</h3>
      <dl className="tr-breakdown">
        <div>
          <dt>Amount paid</dt>
          <dd>{money(funds.asset, funds.grossMinor)}</dd>
        </div>
        <div>
          <dt>PayRouta fee</dt>
          <dd>− {money(funds.asset, funds.feeMinor)}</dd>
        </div>
        {funds.processingFeeMinor !== "0" && (
          <div>
            <dt>Processing fee</dt>
            <dd>− {money(funds.asset, funds.processingFeeMinor)}</dd>
          </div>
        )}
        <div className="total">
          <dt>Net</dt>
          <dd>{money(funds.asset, funds.netMinor)}</dd>
        </div>
      </dl>
      <p className="tr-hint">
        {funds.fundsState}
        {funds.availableAt && ` · ${new Date(funds.availableAt) > new Date() ? "available on" : "available since"} ${date(funds.availableAt)}`}
      </p>
      {funds.disputes.map((d) => (
        <p key={d.id}>
          <Pill tone={disputeTone[d.state]}>Disputed · {disputeLabel[d.state]}</Pill> {money(funds.asset, d.amountMinor)}
        </p>
      ))}
      {funds.refunds.length > 0 && (
        <ul className="tr-list">
          {funds.refunds.map((r) => (
            <li key={r.id}>
              <Pill tone={refundTone[r.state]}>{r.state === "Succeeded" ? "Refunded" : r.state === "Failed" ? "Refund failed" : "Refund processing"}</Pill>{" "}
              {money(funds.asset, r.amountMinor)} · {date(r.createdAt)}
              {r.reason && <small className="tr-sub"> · {r.reason}</small>}
            </li>
          ))}
        </ul>
      )}
      {canRefund && funds.refundable && (
        <RefundPanel
          orgId={orgId}
          intentId={intentId}
          remainingMinor={funds.remainingMinor}
          remainingLabel={money(funds.asset, funds.remainingMinor)}
          exponent={exponent}
        />
      )}
      {!funds.refundable && <p className="tr-hint">Paid by bank transfer straight to you: refund the customer from your bank account.</p>}
    </div>
  );
}
