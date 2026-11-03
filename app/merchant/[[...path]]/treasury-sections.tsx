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
  onboardingStatus,
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
import { AcceptTerms, DisputeResponse, PayoutRequest, RefundPanel, SubmitForReview, VerificationForm } from "./treasury";
import { BasicDetailsForm, BusinessDetailsForm, DocumentUpload, GoLiveWithCrypto, type ActivationProfile } from "./activation";
import {
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

function Step({ n, done, title, children, current }: { n: number; done: boolean; title: string; children: ReactNode; current: boolean }) {
  return (
    <li className={`tr-step ${done ? "done" : ""}`} aria-current={current ? "step" : undefined}>
      <span className="tr-step-mark" aria-hidden>
        {done ? "✓" : n}
      </span>
      <div>
        <h3>
          {title} {done && <Pill tone="good">Complete</Pill>}
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
  currency,
}: {
  orgId: string;
  view: View;
  requirements: Requirements;
  profile: ActivationProfile;
  environment: string;
  currency?: string;
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
              ? `You're selling more than $${r.capUsd!.toLocaleString("en-US")} a month. Register your business and add the items marked "To grow".`
              : `You're selling more than $${r.capUsd!.toLocaleString("en-US")} a month. Add the items marked "To grow".`}
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
        <ul className="tr-checklist">
          {fiatItems.map((e) => (
            <li key={e.id}>
              <span>{onboardingText[e.id]}</span> <Pill tone={onboardingStatus[e.status].tone}>{onboardingStatus[e.status].label}</Pill>
            </li>
          ))}
        </ul>
        {basicsDone && (
          <>
            {open("what-you-sell", "support-email", "registration-number", "business-address", "representative", "owners") && (
              <details open={!submitted}>
                <summary>{individual ? "What you sell" : "Business details"}</summary>
                <BusinessDetailsForm
                  orgId={orgId}
                  profile={profile}
                  registered={open("registration-number", "business-address", "representative")}
                  owners={open("owners")}
                />
              </details>
            )}
            <details open={!submitted && open("personal-details", "id-number", "payout-account")}>
              <summary>{individual ? "Your identity and payout account" : "Director's identity and payout account"}</summary>
              <VerificationForm
                orgId={orgId}
                owners={open("owners") || (profile.owners?.length ?? 0) > 0 ? (profile.owners ?? []).map((o) => ({ name: `${o.givenName} ${o.familyName}` })) : []}
                country={country}
                currency={currency}
                individual={individual}
                saved={(view.steps.details?.summary as Parameters<typeof VerificationForm>[0]["saved"]) ?? null}
              />
            </details>
            {(Object.keys(onboardingDocuments) as OnboardingDocument[])
              .filter((d) => open(d))
              .map((d) => (
                <DocumentUpload
                  key={d}
                  orgId={orgId}
                  country={country}
                  requirementId={onboardingDocuments[d]}
                  label={onboardingText[d]}
                />
              ))}
          </>
        )}
        {!submitted && (
          <SubmitForReview orgId={orgId} ready={r.ready.fiat} resubmit={a?.state === "Returned"} />
        )}
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: "primary" }) {
  return (
    <div className={`tr-stat ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function BalancesSection({ orgId, view, href }: { orgId: string; view: View; href: (p: string) => string }) {
  const live = view.account?.state === "Live" || view.account?.state === "Offboarding";
  if (!view.account) return <TreasuryEmpty href={href} />;
  const payable = view.balances.filter((b) => b.available !== "0");
  return (
    <>
      {view.balances.length === 0 && (
        <section className="tr-empty">
          <h2>No balance yet</h2>
          <p>No funds yet.</p>
        </section>
      )}
      {view.balances.map((b) => (
        <section key={b.asset} className="tr-balance">
          <h2 className="tr-balance-title">{b.asset.slice(5, 8)} balance</h2>
          <div className="tr-stats">
            <Stat tone="primary" label="Available to pay out" value={money(b.asset, b.available)} />
            <Stat label="Incoming" value={money(b.asset, b.pending)} />
            {b.reserve !== "0" && <Stat label="Reserve" value={money(b.asset, b.reserve)} />}
            {b.inTransit !== "0" && <Stat label="On the way to your bank" value={money(b.asset, b.inTransit)} />}
            {b.held !== "0" && <Stat label="On hold for disputes" value={money(b.asset, b.held)} />}
            {b.owed !== "0" && <Stat label="Owed to PayRouta" value={money(b.asset, b.owed)} />}
          </div>
        </section>
      ))}
      {view.paymentsAccount?.payoutsByPayRouta && (
        <section>
          <div className="tr-row">
            <div>
              <h2>Payouts</h2>
              <p>
                Schedule: <strong>{view.terms ? scheduleText[view.terms.payout.schedule] : "—"}</strong>
                {view.terms && view.terms.payout.delayDays > 0 && <> · funds wait {view.terms.payout.delayDays} days after becoming available</>}
              </p>
            </div>
          </div>
          {live && (
            <PayoutRequest
              orgId={orgId}
              balances={payable.map((b) => ({
                asset: b.asset,
                available: b.available,
                label: money(b.asset, b.available),
                exponent: currencyExponent(b.asset.slice(5, 8)) ?? 2,
              }))}
            />
          )}
          <PayoutTable payouts={view.payouts} />
        </section>
      )}
      {view.paymentsAccount && !view.paymentsAccount.payoutsByPayRouta && (
        <section>
          <h2>Payouts</h2>
        </section>
      )}
    </>
  );
}

function PayoutTable({ payouts }: { payouts: View["payouts"] }) {
  if (!payouts.length) return <p className="tr-hint">No payouts yet.</p>;
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

function TreasuryEmpty({ href }: { href: (p: string) => string }) {
  return (
    <section className="tr-empty">
      <h2>Activate payments first</h2>
      <p>Balances, payouts and disputes appear once your PayRouta payments account is active.</p>
      <Link className="tr-button" href={href("activation")}>
        Start activation
      </Link>
    </section>
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
  if (!view.account) return <TreasuryEmpty href={href} />;
  const open = view.disputes.filter((d) => d.state === "Open");
  return (
    <>
      {open.length > 0 && (
        <div className="tr-banner warn">
          <div>
            <strong>
              {open.length} open {open.length === 1 ? "dispute" : "disputes"}
            </strong>
          </div>
        </div>
      )}
      <section>
        {!view.disputes.length ? (
          <p>No disputes.</p>
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
