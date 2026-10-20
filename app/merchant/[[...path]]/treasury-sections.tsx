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
        <p>{!state ? "Tell us about your business to start accepting cards, digital wallets, bank transfers and mobile money." : info!.detail}</p>
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

export function ActivationSection({
  orgId,
  view,
  profilePanel,
  country,
  currency,
  ownerNames,
}: {
  orgId: string;
  view: View;
  profilePanel: ReactNode;
  country?: string;
  currency?: string;
  ownerNames: string[];
}) {
  const a = view.account;
  const s = view.steps;
  const submitted = a && !["Returned"].includes(a.state);
  const ready = !!s.profile && !!s.details && !!s.terms;
  const info = a ? accountState[a.state] : null;
  const firstOpen = !s.profile ? 1 : !s.details ? 2 : !s.terms ? 3 : 4;
  return (
    <>
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
      {a && (
        <section className="tr-status">
          <div>
            <Pill tone={info!.tone}>{info!.label}</Pill>
            <p>{info!.detail}</p>
            {a.note && (
              <blockquote>
                <strong>From our review team:</strong> {a.note}
              </blockquote>
            )}
            {(a.profileChanged || a.detailsChanged) && a.state !== "Returned" && (
              <p className="tr-hint">You changed your details after submitting. They will be used when your account is next reviewed.</p>
            )}
          </div>
          {view.paymentsAccount && view.paymentsAccount.requirements.length > 0 && (
            <div>
              <h3>Still needed</h3>
              <ul className="tr-requirements">
                {view.paymentsAccount.requirements.map((r) => (
                  <li key={r}>{requirementText[r] ?? requirementText.review}</li>
                ))}
              </ul>
              <p className="tr-hint">Our team will contact you about any documents.</p>
            </div>
          )}
        </section>
      )}
      {!submitted && (
        <section>
          <p>Complete these steps once. We review most businesses within one to two business days.</p>
          <ol className="tr-steps">
            <Step n={1} done={!!s.profile} title="Business details" current={firstOpen === 1}>
              <p className="tr-hint">Legal name, registration, address, what you sell and who owns the business.</p>
              {profilePanel}
            </Step>
            <Step n={2} done={!!s.details} title="Identity and payout bank account" current={firstOpen === 2}>
              {s.profile ? (
                <VerificationForm
                  orgId={orgId}
                  owners={ownerNames.map((name) => ({ name }))}
                  country={country}
                  currency={currency}
                  saved={(s.details?.summary as Parameters<typeof VerificationForm>[0]["saved"]) ?? null}
                />
              ) : (
                <p className="tr-hint">Save your business details first.</p>
              )}
            </Step>
            <Step n={3} done={!!s.terms} title="Merchant terms" current={firstOpen === 3}>
              <AcceptTerms orgId={orgId} accepted={s.terms?.acceptedAt ?? null} />
            </Step>
            <Step n={4} done={false} title="Submit for review" current={firstOpen === 4}>
              <p className="tr-hint">We check your business against public registers and sanctions lists, then set up your payments account.</p>
              <SubmitForReview orgId={orgId} ready={ready} resubmit={a?.state === "Returned"} />
            </Step>
          </ol>
        </section>
      )}
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "primary" }) {
  return (
    <div className={`tr-stat ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
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
          <p>Once customers pay you, your funds appear here: incoming first, then available to pay out.</p>
        </section>
      )}
      {view.balances.map((b) => (
        <section key={b.asset} className="tr-balance">
          <h2 className="tr-balance-title">{b.asset.slice(5, 8)} balance</h2>
          <div className="tr-stats">
            <Stat tone="primary" label="Available to pay out" value={money(b.asset, b.available)} />
            <Stat label="Incoming" value={money(b.asset, b.pending)} hint="Becomes available on the payment's availability date" />
            {b.reserve !== "0" && <Stat label="Reserve" value={money(b.asset, b.reserve)} hint="Released automatically after the hold period" />}
            {b.inTransit !== "0" && <Stat label="On the way to your bank" value={money(b.asset, b.inTransit)} />}
            {b.held !== "0" && <Stat label="On hold for disputes" value={money(b.asset, b.held)} />}
            {b.owed !== "0" && <Stat label="Owed to PayRouta" value={money(b.asset, b.owed)} hint="Recovered from your next available funds" />}
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
          <p>Your share of each payment is paid straight to your bank account, usually the next business day.</p>
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
            <p>The disputed amount is on hold until the card network decides. Respond with your evidence before the deadline.</p>
          </div>
        </div>
      )}
      <section>
        {!view.disputes.length ? (
          <p>No disputes. When a customer disputes a payment with their bank, it appears here.</p>
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
