"use client";
import { useState } from "react";
import {
  Bank,
  CreditCard,
  CurrencyCircleDollar,
  Wallet,
  DeviceMobile,
  Graph,
  Lightning,
  Receipt,
  CalendarDots,
  QrCode,
  type Icon,
} from "@phosphor-icons/react";
import { methodContent } from "@/content/marketing";

const iconMap: Record<string, Icon> = {
  Landmark: Bank,
  CreditCard,
  Coins: CurrencyCircleDollar,
  Wallet,
  Smartphone: DeviceMobile,
  Network: Graph,
  Zap: Lightning,
  Receipt,
  CalendarClock: CalendarDots,
  QrCode,
};

const groupColor: Record<string, string> = {
  Traditional: "var(--line-card)",
  "Instant & A2A": "var(--line-bank)",
  "Digital assets": "var(--line-crypto)",
  "Local methods": "var(--line-mobile)",
};

export function MethodFilter() {
  const [filter, setFilter] = useState("All methods");
  const shown = methodContent.filter((m) => filter === "All methods" || m.group === filter);
  return (
    <>
      <div className="mk-filter" role="group" aria-label="Filter payment categories">
        {["All methods", "Traditional", "Instant & A2A", "Digital assets", "Local methods"].map((f) => (
          <button key={f} aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">
        {shown.length} categories shown
      </p>
      <div className="mk-atlas">
        {shown.map((m) => {
          const I = iconMap[m.icon] || Bank;
          return (
            <article
              className="mk-card method-detail"
              key={m.name}
              style={{ "--tile-line": groupColor[m.group] } as React.CSSProperties}
            >
              <header>
                <span className="mk-mega-icon" style={{ background: groupColor[m.group] }}>
                  <I size={20} weight="duotone" />
                </span>
                <span className="mk-line-badge">{m.group}</span>
              </header>
              <h2>{m.name}</h2>
              <p className="ex">{m.examples}</p>
              <p>{m.copy}</p>
              <p className="fine">{m.consideration}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}
