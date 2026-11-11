"use client";
// Where crypto checkouts land (intents.tsx): customers pay with any token on
// any chain, NEAR Intents converts it, and the money arrives in the
// merchant's own NEAR Intents wallet (from which they send to any address)
// or their bank. The diagram follows the choice; the card marked "Receiving" is
// where checkouts go now.
import { ArrowRight, Coins, Landmark, Wallet } from "lucide-react";
import type { ReactNode } from "react";

export type Destination = "balance" | "bank";

const options: { id: Destination; icon: ReactNode; title: string; reach: string }[] = [
  { id: "balance", icon: <Wallet size={22} aria-hidden />, title: "Your PayRouta wallet", reach: "Held in USDC or USDT · send to any address, any chain" },
  { id: "bank", icon: <Landmark size={22} aria-hidden />, title: "Bank or mobile money", reach: "NGN · KES · GHS · ZAR · USD · EUR" },
];

export function Destinations({
  value,
  receiving,
  onChange,
}: {
  value: Destination;
  receiving: Destination | null;
  onChange: (d: Destination) => void;
}) {
  const chosen = options.find((o) => o.id === value)!;
  return (
    <section className="ms-dest">
      <h2 id="ms-dest-title">Where your crypto payments land</h2>
      <ol className="ms-flow" aria-label="How a crypto payment reaches you">
        <li>
          <Coins size={18} aria-hidden />
          Any token, any chain
        </li>
        <li aria-hidden className="ms-flow-arrow">
          <ArrowRight size={16} />
        </li>
        <li className="ms-flow-near">NEAR Intents</li>
        <li aria-hidden className="ms-flow-arrow">
          <ArrowRight size={16} />
        </li>
        <li className="ms-flow-end" key={chosen.id}>
          {chosen.icon}
          {chosen.title}
        </li>
      </ol>
      <div className="ms-dest-cards" role="radiogroup" aria-labelledby="ms-dest-title">
        {options.map((o) => (
          <label key={o.id} className="ms-dest-card">
            <input type="radio" name="destination" className="ms-dest-input" checked={value === o.id} onChange={() => onChange(o.id)} />
            <span className="ms-dest-icon">{o.icon}</span>
            <strong>{o.title}</strong>
            <small>{o.reach}</small>
            {receiving === o.id && <span className="ms-dest-live">Receiving</span>}
          </label>
        ))}
      </div>
    </section>
  );
}
