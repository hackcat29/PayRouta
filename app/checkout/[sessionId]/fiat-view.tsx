"use client";
// Customer checkout for card, bank transfer, mobile money and USSD payments.
// Modelled on established hosted checkouts: order summary on one side, one
// payment method choice and one primary button on the other, then clear
// processing, success and failure states. The customer only ever sees the
// merchant and PayRouta; the processor's secure page is just "secure
// payment".
import { useCallback, useEffect, useRef, useState } from "react";
import { checkoutCountdown } from "@/lib/payments/checkout-display";
import { currencyExponent } from "@/lib/partners/money";

type Action = { kind: string; url?: string; text?: string; provider?: string };
type Progress = {
  merchant: string;
  reference: string;
  amount: string;
  asset: { kind: string; identifier: string };
  state: string;
  selectedMethod?: string | null;
  attemptState?: string;
  attemptId?: string;
  action?: Action | null;
  sandbox: boolean;
  expiresAt: string;
  returnUrl: string;
};
type Method = { method: string; label?: string; status: string; explanation?: string };

const labels: Record<string, string> = {
  card: "Card",
  "bank-transfer": "Bank transfer",
  "mobile-money": "Mobile money",
  ussd: "USSD",
  "digital-wallet": "Wallet",
  "direct-debit": "Direct debit",
  bnpl: "Pay later",
};
const blurbs: Record<string, string> = {
  card: "Visa, Mastercard and more. Apple Pay and Google Pay where available.",
  "bank-transfer": "Pay from your bank account or banking app.",
  "mobile-money": "M-Pesa, MTN MoMo and other mobile wallets.",
  ussd: "Dial a short code from your phone. No internet needed.",
  "digital-wallet": "Pay with your digital wallet.",
  "direct-debit": "Authorise a one-off debit from your bank account.",
  bnpl: "Split the cost into instalments.",
};

function Icon({ method }: { method: string }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true } as const;
  if (method === "card")
    return (
      <svg {...common}>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="M2.5 9.5h19M6 15h4" />
      </svg>
    );
  if (method === "bank-transfer" || method === "direct-debit")
    return (
      <svg {...common}>
        <path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
      </svg>
    );
  if (method === "mobile-money" || method === "ussd")
    return (
      <svg {...common}>
        <rect x="6.5" y="2.5" width="11" height="19" rx="2" />
        <path d="M10.5 18.5h3" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12.5h2M3 9h18" />
    </svg>
  );
}

export function formatAmount(amount: string, currency: string) {
  const exp = currencyExponent(currency) ?? 2;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: exp, maximumFractionDigits: exp }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

const messages: Record<string, string> = {
  PROVIDER_CUSTOMER_DETAILS_REQUIRED: "This payment method needs your email address. Ask the merchant to include it, or choose another method.",
  SELECTED_METHOD_NOT_AVAILABLE: "That payment method isn't available right now. Please choose another.",
  QUOTE_EXPIRED_RESELECT_METHOD: "This took a little long. Please choose your payment method again.",
  PAYMENT_ALREADY_IN_PROGRESS: "A payment is already in progress for this checkout.",
  CHECKOUT_EXPIRED_OR_UNAUTHORIZED: "This checkout link has expired or is incomplete. Return to the merchant to start again.",
  REFRESH_METHODS: "Payment options changed. Please choose again.",
};

export function FiatCheckout({ id, initial }: { id: string; initial: Progress }) {
  const [data, setData] = useState<Progress>(initial);
  const [methods, setMethods] = useState<Method[] | null>(null);
  const [choice, setChoice] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const redirected = useRef(false);
  // Set once the customer has completed the payment step; the provider's
  // confirmation follows a moment later.
  // Coming back from the secure payment page counts as completed too. This
  // view only renders in the browser (after CheckoutRouter's first load).
  const [completed, setCompleted] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("returned") === "1",
  );

  const api = useCallback(
    async (action?: object) => {
      const r = await fetch(
        `/api/checkout/${id}`,
        action
          ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) }
          : { cache: "no-store" },
      );
      const b = await r.json();
      if (!r.ok) throw new Error(messages[b.error] ?? "Something went wrong. Please try again.");
      return b;
    },
    [id],
  );
  const reload = useCallback(async () => setData(await api()), [api]);

  const applyMethods = useCallback((m: { methods: Method[] }) => {
    const available = m.methods.filter((x) => x.status === "AVAILABLE" && labels[x.method]);
    setMethods(available);
    setChoice((c) => (available.some((x) => x.method === c) ? c : available[0]?.method || ""));
  }, []);
  const loadMethods = useCallback(async () => applyMethods(await api({ action: "methods" })), [api, applyMethods]);

  const confirmed = data.state === "Confirmed";
  const rejected = data.attemptState === "Rejected" && !confirmed;
  const inFlight = !!data.attemptId && !confirmed && !rejected;
  const expired = Date.parse(data.expiresAt) <= clock && !inFlight && !confirmed;

  // Returning from the secure payment page: ask for a fresh status read.
  useEffect(() => {
    if (new URLSearchParams(location.search).get("returned") === "1") {
      history.replaceState(null, "", location.pathname);
      void api({ action: "refresh" }).then(reload).catch(() => {});
    }
  }, [api, reload]);

  useEffect(() => {
    if (data.attemptId && !rejected) return;
    let alive = true;
    api({ action: "methods" })
      .then((m) => alive && applyMethods(m))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [data.attemptId, rejected, api, applyMethods]);

  useEffect(() => {
    const t = setInterval(() => {
      setClock(Date.now());
      if (inFlight) void reload().catch(() => {});
    }, 2500);
    return () => clearInterval(t);
  }, [inFlight, reload]);

  async function pay() {
    if (!choice) return;
    setBusy(true);
    setError("");
    try {
      const route = await api({ action: "select", method: choice });
      await api({ action: "confirm", routeId: route.routeId });
      await reload();
    } catch (e) {
      setError((e as Error).message);
      await loadMethods().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function completeTest() {
    setBusy(true);
    setError("");
    try {
      await api({ action: "complete" });
      setCompleted(true);
      await api({ action: "refresh" }).catch(() => {});
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const currency = data.asset.identifier;
  const total = formatAmount(data.amount, currency);
  const action = data.action;

  let panel;
  if (confirmed)
    panel = (
      <div className="fc-result" role="status">
        <div className="fc-check" aria-hidden>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="m5 12.5 4.5 4.5L19 7.5" />
          </svg>
        </div>
        <h2>Payment successful</h2>
        <p>
          {total} paid to {data.merchant}. You can close this page or return to the merchant.
        </p>
        <a className="fc-pay" href={data.returnUrl}>
          Return to {data.merchant}
        </a>
      </div>
    );
  else if (inFlight && completed)
    panel = (
      <div className="fc-result" role="status">
        <div className="fc-spinner" aria-hidden />
        <h2>Confirming your payment</h2>
        <p>Please don&apos;t pay again; this page updates automatically.</p>
      </div>
    );
  else if (inFlight && action?.kind === "redirect" && action.url)
    panel = (
      <div className="fc-result">
        <h2>Continue to secure payment</h2>
        <p>You&apos;ll enter your details on our secure payment page and come straight back here.</p>
        <a
          className="fc-pay"
          href={action.url}
          onClick={() => {
            redirected.current = true;
          }}
        >
          Continue to pay {total}
        </a>
        <p className="fc-small">Already paid? This page updates automatically.</p>
      </div>
    );
  else if (inFlight && action?.kind === "sandbox")
    panel = (
      <div className="fc-result">
        <h2>Test payment</h2>
        <p>This is a sandbox checkout: no real money moves. Complete the test payment to see what your customer sees.</p>
        <button className="fc-pay" disabled={busy} onClick={() => void completeTest()}>
          {busy ? "Completing…" : `Complete test payment of ${total}`}
        </button>
      </div>
    );
  else if (inFlight)
    panel = (
      <div className="fc-result" role="status">
        <div className="fc-spinner" aria-hidden />
        <h2>{data.attemptState === "Pending" ? "Confirming your payment" : "Preparing your payment"}</h2>
        <p>
          {data.attemptState === "Pending"
            ? "Your bank or provider is confirming the payment. Please don't pay again; this page updates automatically."
            : "This usually takes a few seconds."}
        </p>
      </div>
    );
  else if (expired)
    panel = (
      <div className="fc-result">
        <h2>This checkout has expired</h2>
        <p>Return to {data.merchant} to start a new payment.</p>
        <a className="fc-pay" href={data.returnUrl}>
          Return to {data.merchant}
        </a>
      </div>
    );
  else
    panel = (
      <>
        {rejected && (
          <p className="fc-alert" role="alert">
            That payment didn&apos;t go through and you haven&apos;t been charged. Try again or choose another method.
          </p>
        )}
        <h2 className="fc-heading">Payment method</h2>
        {methods === null ? (
          <div className="fc-skeleton" aria-label="Loading payment methods" />
        ) : methods.length === 0 ? (
          <p className="fc-alert">No payment methods are available for this payment right now. Please contact {data.merchant}.</p>
        ) : (
          <div className="fc-methods" role="radiogroup" aria-label="Payment method">
            {methods.map((m) => (
              <label key={m.method} className={`fc-method ${choice === m.method ? "selected" : ""}`}>
                <input type="radio" name="method" value={m.method} checked={choice === m.method} onChange={() => setChoice(m.method)} />
                <span className="fc-icon">
                  <Icon method={m.method} />
                </span>
                <span className="fc-method-text">
                  <strong>{labels[m.method]}</strong>
                  <small>{blurbs[m.method]}</small>
                </span>
              </label>
            ))}
          </div>
        )}
        {!!methods?.length && (
          <button className="fc-pay" disabled={busy || !choice} onClick={() => void pay()}>
            {busy ? "Processing…" : `Pay ${total}`}
          </button>
        )}
      </>
    );

  return (
    <div className="fiat-checkout">
      {data.sandbox && <div className="fc-test">Test mode · no real money moves</div>}
      <div className="fc-layout">
        <aside className="fc-summary">
          <p className="fc-merchant">
            <span className="fc-avatar" aria-hidden>
              {data.merchant.slice(0, 1).toUpperCase()}
            </span>
            <span>{data.merchant}</span>
          </p>
          <p className="fc-label">Pay {data.merchant}</p>
          <p className="fc-total">{total}</p>
          <dl className="fc-lines">
            <div>
              <dt>Order {data.reference}</dt>
              <dd>{total}</dd>
            </div>
            <div className="fc-sum">
              <dt>Total due</dt>
              <dd>{total}</dd>
            </div>
          </dl>
          {!confirmed && !inFlight && !expired && (
            <p className="fc-small" role="timer" aria-live="off">
              Expires in {checkoutCountdown(data.expiresAt, clock)}
            </p>
          )}
        </aside>
        <section className="fc-pane" aria-label="Payment">
          {panel}
          {error && (
            <p className="fc-alert" role="alert">
              {error}
            </p>
          )}
          <footer className="fc-footer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Secure checkout · Powered by <strong>PayRouta</strong>
          </footer>
        </section>
      </div>
    </div>
  );
}
