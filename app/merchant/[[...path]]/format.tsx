// Display helpers for the merchant dashboard: dates, amounts and status pills.
import type { ReactNode } from "react";
import { paymentAsset } from "@/lib/blockchain/crypto-assets";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});
const dateYear = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

// "10 Oct, 06:36"; the year is shown only when it isn't the current one.
export function when(d: Date) {
  return d.getUTCFullYear() === new Date().getUTCFullYear()
    ? dateTime.format(d)
    : `${dateYear.format(d)}`;
}
export const day = (d: Date) => dateYear.format(d);

type Asset = { kind?: string; identifier: string; network?: string };

// "£86.40" for fiat, "12.50 USDC" for tokens.
export function amountText(amount: string, raw: unknown) {
  const a = raw as Asset;
  if (a?.kind === "fiat" || /^[A-Z]{3}$/.test(a?.identifier ?? "")) {
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency: a.identifier }).format(Number(amount));
    } catch {
      return `${amount} ${a.identifier}`;
    }
  }
  const symbol = paymentAsset(a?.network || "", a?.identifier)?.symbol || a?.identifier;
  return `${amount} ${symbol}`;
}
export function currencyCode(raw: unknown) {
  const a = raw as Asset;
  if (a?.kind === "fiat" || /^[A-Z]{3}$/.test(a?.identifier ?? "")) return a.identifier;
  return paymentAsset(a?.network || "", a?.identifier)?.symbol || a?.identifier;
}

type Tone = "good" | "bad" | "warn" | "info" | "neutral";
const states: Record<string, [string, Tone]> = {
  Confirmed: ["Succeeded", "good"],
  Processing: ["Processing", "info"],
  Open: ["Incomplete", "neutral"],
  Rejected: ["Failed", "bad"],
  Failed: ["Failed", "bad"],
  Expired: ["Expired", "neutral"],
  Unknown: ["Checking", "warn"],
  Unresolved: ["Needs review", "warn"],
  Resolved: ["Resolved", "good"],
  Completed: ["Completed", "good"],
  Delivered: ["Delivered", "good"],
  Pending: ["Pending", "neutral"],
};
export function StatePill({ state, children }: { state: string; children?: ReactNode }) {
  const [label, tone] = states[state] ?? [state, "neutral"];
  return <span className={`ms-pill ${tone}`}>{children ?? label}</span>;
}
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`ms-pill ${tone}`}>{children}</span>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ms-empty">
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
