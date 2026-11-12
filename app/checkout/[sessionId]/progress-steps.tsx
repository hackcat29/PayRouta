"use client";
// Where a sent crypto payment is (view.tsx, cross-chain.tsx), and the
// receipt once it's confirmed, which returns the customer to the merchant
// on its own after a few seconds.
import { useEffect, useRef, useState } from "react";

export function eta(seconds?: number) {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  if (seconds < 60) return "Usually under a minute";
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? "Usually about a minute" : `Usually about ${minutes} minutes`;
}

export function Steps({ steps, current, estimate }: { steps: string[]; current: number; estimate?: string }) {
  return (
    <div className="sc-progress">
      <ol className="sc-steps">
        {steps.map((s, i) => (
          <li key={s} className={i < current ? "done" : i === current ? "active" : undefined} aria-current={i === current ? "step" : undefined}>
            <span className="sc-step-dot" aria-hidden="true">
              {i < current ? "✓" : i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
      {estimate && current < steps.length && <p className="sc-eta">{estimate}</p>}
    </div>
  );
}

export function Receipt({
  rows,
  transactionUrl,
  merchant,
  onReturn,
  returnHref,
  autoReturn = true,
}: {
  rows: [string, string][];
  transactionUrl?: string | null;
  merchant: string;
  onReturn: () => void;
  returnHref: string;
  // Back to the merchant after a few seconds (not in the demo checkout).
  autoReturn?: boolean;
}) {
  const [left, setLeft] = useState(8);
  const [stay, setStay] = useState(!autoReturn);
  // The checkout re-renders as it polls; the countdown mustn't restart.
  const back = useRef(onReturn);
  useEffect(() => {
    back.current = onReturn;
  });
  useEffect(() => {
    if (stay) return;
    if (left <= 0) {
      back.current();
      return;
    }
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left, stay]);
  return (
    <section role="status" className="sc-receipt">
      <span className="sc-check" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 24 24">
          <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h2>Payment received</h2>
      <dl className="pc-lines">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {transactionUrl && (
          <div>
            <dt>Transaction</dt>
            <dd>
              <a href={transactionUrl} target="_blank" rel="noreferrer">
                View on explorer
              </a>
            </dd>
          </div>
        )}
      </dl>
      <a
        className="sc-primary"
        href={returnHref}
        onClick={(e) => {
          e.preventDefault();
          onReturn();
        }}
      >
        Return to merchant
      </a>
      {!stay && (
        <p className="sc-return-note">
          Back to {merchant} in {left}s ·{" "}
          <button type="button" className="pc-link" onClick={() => setStay(true)}>
            Stay here
          </button>
        </p>
      )}
    </section>
  );
}
