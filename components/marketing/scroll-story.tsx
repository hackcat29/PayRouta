"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle, ArrowsClockwise } from "@phosphor-icons/react";

const steps = [
  {
    id: "payment-intent",
    title: "Create a payment intent",
    copy: "Your server states what is owed, which methods you accept, how you want to be settled and where to send the customer afterwards. One call, any market.",
  },
  {
    id: "availability",
    title: "Check what can actually work",
    copy: "PayRouta evaluates country, currency, amount, compliance, provider certification and live health — then offers only the methods that can complete this payment right now.",
  },
  {
    id: "checkout",
    title: "The customer chooses",
    copy: "Customers see familiar local methods, never provider names. Their choice is final: PayRouta will not switch them to a different method behind their back.",
  },
  {
    id: "provider-routing",
    title: "Route to the best provider",
    copy: "Among eligible providers for the chosen method, PayRouta weighs success history, speed, cost and your policy, and locks a route.",
  },
  {
    id: "execution",
    title: "Execute carefully, recover quietly",
    copy: "Requests are idempotent. Timeouts are rechecked, not assumed failed. If the first provider can't start the payment, another provider for the same method takes over.",
  },
  {
    id: "settlement",
    title: "Confirm, settle, reconcile",
    copy: "Confirmation and settlement are tracked as separate facts, matched against provider reports, and any mismatch becomes a visible exception — never a silent balance.",
  },
];

function Screen({ i }: { i: number }) {
  const on = (n: number) => (i === n ? "true" : "false");
  return (
    <div className="mk-phone" aria-hidden="true">
      <div className="mk-phone-screen">
        <div className="mk-phone-head">
          <span>Northwind Outfitters</span>
          <span>€240.00</span>
        </div>
        <div className="mk-screen" style={{ marginTop: 18 }}>
          <div data-on={on(0)}>
            <code>{`POST /payment-intents\n{\n  "amount": "240.00",\n  "asset": "EUR",\n  "methods": ["card",\n    "bank-transfer",\n    "mobile-money"]\n}`}</code>
          </div>
          <div data-on={on(1)}>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Evaluating for customer in Portugal…</span>
            <div className="mk-phone-method">Card <small>eligible</small></div>
            <div className="mk-phone-method">Bank transfer <small>eligible</small></div>
            <div className="mk-phone-method off">Mobile money <small>not offered here</small></div>
          </div>
          <div data-on={on(2)}>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>How would you like to pay?</span>
            <div className="mk-phone-method sel">
              <i /> Card <small>selected</small>
            </div>
            <div className="mk-phone-method">Bank transfer</div>
          </div>
          <div data-on={on(3)}>
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>Routing card payment</span>
            <div className="mk-kv">
              <div><span>provider_a</span><b style={{ color: "var(--teal)" }}>primary</b></div>
              <div><span>provider_b</span><b>backup</b></div>
              <div><span>provider_c</span><b>excluded</b></div>
            </div>
          </div>
          <div data-on={on(4)}>
            <span className="mk-mono" style={{ fontSize: 11, color: "#ad243a" }}>provider_a · timeout → rechecked · not started</span>
            <span className="mk-mono" style={{ fontSize: 11, color: "var(--teal)", display: "flex", gap: 6, alignItems: "center" }}>
              <ArrowsClockwise size={12} weight="bold" /> retry on provider_b · card
            </span>
            <div style={{ height: 46, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontWeight: 600, background: "#e6f7f0", color: "var(--teal)", marginTop: 8 }}>
              <CheckCircle size={18} weight="fill" /> Paid
            </div>
          </div>
          <div data-on={on(5)}>
            <div className="mk-kv">
              <div><span>payment.confirmed</span><b>12:04</b></div>
              <div><span>settlement.completed</span><b>+1d</b></div>
              <div><span>reconciled</span><b style={{ color: "var(--teal)" }}>matched</b></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScrollStory() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <div className="mk-story">
      <div className="mk-story-sticky">
        <Screen i={active} />
      </div>
      <div className="mk-story-steps">
        {steps.map((s, i) => (
          <article
            key={s.id}
            id={s.id}
            data-index={i}
            data-active={i === active}
            className="mk-step"
            ref={(el) => {
              refs.current[i] = el;
            }}
          >
            <span className="num">STEP {String(i + 1).padStart(2, "0")}</span>
            <h2>{s.title}</h2>
            <p>{s.copy}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
