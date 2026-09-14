"use client";
import { useState } from "react";
import {
  Landmark,
  CreditCard,
  Coins,
  Wallet,
  Smartphone,
  Network,
  Zap,
  Receipt,
  CalendarClock,
  QrCode,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { methodContent } from "@/content/marketing";

const iconMap: Record<string, LucideIcon> = {
  Landmark,
  CreditCard,
  Coins,
  Wallet,
  Smartphone,
  Network,
  Zap,
  Receipt,
  CalendarClock,
  QrCode,
  TrendingUp,
};

export function MethodFilter() {
  const [filter, setFilter] = useState("All methods");
  const shown = methodContent.filter(
    (m) => filter === "All methods" || m.group === filter,
  );
  return (
    <>
      <div className="filter-bar" aria-label="Filter payment categories">
        {[
          "All methods",
          "Traditional",
          "Instant & A2A",
          "Digital assets",
          "Local methods",
        ].map((f) => (
          <button
            key={f}
            aria-pressed={f === filter}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>
      <p className="sr-only" role="status">
        {shown.length} categories shown
      </p>
      <div className="content-grid">
        {shown.map((m) => {
          const Icon = iconMap[m.icon] || Landmark;
          return (
            <article className="method-detail" key={m.name}>
              <Icon size={28} />
              <p className="method-examples">{m.examples}</p>
              <h2>{m.name}</h2>
              <p>{m.copy}</p>
              <p className="note">{m.consideration}</p>
            </article>
          );
        })}
      </div>
    </>
  );
}

