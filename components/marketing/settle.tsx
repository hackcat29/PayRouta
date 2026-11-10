"use client";
// Customers pay with anything; the merchant picks what they're settled in.
// Every way to pay on the left flows into PayRouta and out to the one choice
// on the right. Choices come from content/claims.ts (settleIn), with their
// real availability.
import { useState, type CSSProperties } from "react";

export type SettleOption = {
  id: string;
  name: string;
  detail: string;
  label?: string;
};

const paidWith = [
  { name: "Card", family: "card" },
  { name: "Bank transfer", family: "bank" },
  { name: "Digital wallet", family: "wallet" },
  { name: "Mobile money", family: "mobile" },
  { name: "Pay with credit", family: "credit" },
  { name: "Any token, any chain", family: "crypto" },
];

const y = (i: number, n: number) => ((i + 0.5) / n) * 100;

export function SettleChooser({ options }: { options: SettleOption[] }) {
  const [chosen, setChosen] = useState(options[0].id);
  const at = options.findIndex((o) => o.id === chosen);
  return (
    <div className="st-box">
      <div className="st">
        <ul className="st-in" aria-label="Customers pay with">
          {paidWith.map((p, i) => (
            <li
              key={p.name}
              className={`st-${p.family}`}
              style={{ "--i": i } as CSSProperties}
            >
              <i aria-hidden="true" />
              {p.name}
            </li>
          ))}
        </ul>
        <svg
          className="st-wires"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {paidWith.map((p, i) => (
            <path
              key={p.name}
              className="st-wire-in"
              pathLength={1}
              d={`M0 ${y(i, paidWith.length)} C 30 ${y(i, paidWith.length)}, 20 50, 50 50`}
            />
          ))}
          {options.map((o, j) => (
            <path
              key={`${o.id}-${chosen}`}
              className={o.id === chosen ? "st-wire-out on" : "st-wire-out"}
              pathLength={1}
              d={`M50 50 C 80 50, 70 ${y(j, options.length)}, 100 ${y(j, options.length)}`}
            />
          ))}
        </svg>
        <div className="st-node" aria-hidden="true">
          <span />
        </div>
        <fieldset className="st-out">
          <legend className="mk-sr">You&apos;re settled in</legend>
          {options.map((o, j) => (
            <label
              key={o.id}
              className={o.id === chosen ? "on" : undefined}
              style={{ "--j": j } as CSSProperties}
            >
              <input
                type="radio"
                name="settle"
                value={o.id}
                checked={o.id === chosen}
                onChange={() => setChosen(o.id)}
              />
              <span className="st-name">
                {o.name}
                {o.label && <em>{o.label}</em>}
              </span>
              <small>{o.detail}</small>
            </label>
          ))}
        </fieldset>
        <p className="mk-sr" aria-live="polite">
          Settled in {options[at].name}
        </p>
      </div>
    </div>
  );
}
