"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import { corridors, lines } from "@/content/claims";
import { flags } from "./flags";

type Line = { cls: "" | "dim" | "warn" | "ok"; text: string };

// Illustrative sandbox run: the first eligible provider times out, PayRouta
// rechecks it, then completes the payment on another provider for the same method.
export function RouteWidget() {
  const [c, setC] = useState(0);
  const [m, setM] = useState(0);
  const [log, setLog] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const timers = useRef<number[]>([]);
  const country = corridors[c];
  const [line, method] = country.methods[m];

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clear, []);

  const reset = () => {
    clear();
    setBusy(false);
    setLog([]);
  };

  const pay = () => {
    reset();
    setBusy(true);
    const steps: Line[] = [
      { cls: "dim", text: `› ${method} · ${country.amount} · ${country.name}` },
      { cls: "", text: "› routing to provider_a" },
      { cls: "warn", text: "✕ provider_a timed out · rechecked: not started" },
      { cls: "", text: `↻ retrying on provider_b · still ${method}` },
      { cls: "ok", text: "✓ paid — the customer never saw an error" },
    ];
    steps.forEach((s, i) =>
      timers.current.push(
        window.setTimeout(() => {
          setLog((l) => [...l, s]);
          if (i === steps.length - 1) setBusy(false);
        }, i * 650),
      ),
    );
  };

  return (
    <div className="mk-widget">
      <div className="mk-widget-head">
        <h2>Route a payment</h2>
        <p>Pick where your customer is. Press pay. Watch it land.</p>
      </div>
      <div className="mk-widget-body">
        <div>
          <p className="mk-widget-label" id="rw-country">
            Customer in {country.name}
          </p>
          <div className="mk-flags" role="group" aria-labelledby="rw-country">
            {corridors.map((k, i) => {
              const Flag = flags[k.code];
              return (
                <button
                  key={k.code}
                  aria-pressed={i === c}
                  aria-label={k.name}
                  title={k.name}
                  onClick={() => {
                    reset();
                    setC(i);
                    setM(0);
                  }}
                >
                  <Flag aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </div>
        <div className="mk-amount">
          <strong>{country.amount}</strong>
          <span>Order #2291</span>
        </div>
        <div>
          <p className="mk-widget-label" id="rw-method">
            Pays with
          </p>
          <div className="mk-methods" role="group" aria-labelledby="rw-method">
            {country.methods.map(([l, name], i) => (
              <button
                key={name}
                className="mk-method"
                aria-pressed={i === m}
                onClick={() => {
                  reset();
                  setM(i);
                }}
              >
                <span
                  className="mk-bullet"
                  style={{ background: lines[l].color }}
                  aria-hidden="true"
                >
                  {lines[l].bullet}
                </span>
                {name}
                <small>{2 + ((i + c) % 2)} routes</small>
              </button>
            ))}
          </div>
        </div>
        <div className="mk-log" aria-live="polite">
          {log.length === 0 ? (
            <span className="dim">
              {`› ready · ${lines[line].label.toLowerCase()} · sandbox simulation`}
            </span>
          ) : (
            log.map((l) => (
              <span key={l.text} className={l.cls}>
                {l.text}
              </span>
            ))
          )}
        </div>
        <button className="mk-pay" onClick={pay} disabled={busy}>
          {busy ? "Routing…" : `Pay ${country.amount}`} <ArrowRight size={18} weight="bold" />
        </button>
      </div>
    </div>
  );
}
