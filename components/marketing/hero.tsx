"use client";
// Behind the front page headline: the horizon of a globe, and payments
// landing on it one after another. Each local payment turns the globe to
// its city; beside it, a payment in some token completes. Decorative: the
// headline and actions carry the page.
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Globe } from "@/components/gpu/globe";
import type { WayToPay } from "@/content/claims";
import { BrandMark } from "./logos";

type Landed = { way: Pick<WayToPay, "logo" | "mark" | "name">; amount: string; detail: string };

// Each local payment, and the hero city the globe turns to for it.
const local: (Landed & { city: string })[] = [
  { city: "br", way: { name: "Pix", logo: "pix" }, amount: "R$ 2.400,00", detail: "Pix · São Paulo" },
  { city: "ng", way: { name: "Bank transfer", mark: { text: "₦", color: "#fff", bg: "#008751" } }, amount: "₦150,000", detail: "Bank transfer · Lagos" },
  { city: "gb", way: { name: "Apple Pay", logo: "applepay" }, amount: "£640.00", detail: "Apple Pay · London" },
  { city: "in", way: { name: "UPI", mark: { text: "UPI", color: "#097939" } }, amount: "₹12,000", detail: "UPI · Mumbai" },
  { city: "us", way: { name: "Visa", logo: "visa" }, amount: "$180.00", detail: "Card · New York" },
];
const tokens: Landed[] = [
  { way: { name: "Solana", logo: "sol" }, amount: "0.27 SOL", detail: "Paid from Phantom" },
  { way: { name: "USDT", logo: "usdt" }, amount: "150.00 USDT", detail: "Paid on Tron" },
  { way: { name: "Bitcoin", logo: "btc" }, amount: "0.0021 BTC", detail: "Paid on Bitcoin" },
  { way: { name: "Token", mark: { text: "CA", color: "#fff", bg: "#f26b1d" } }, amount: "2,150,000 BONK", detail: "Paid by contract address" },
  { way: { name: "Ethereum", logo: "eth" }, amount: "0.05 ETH", detail: "Paid on Base" },
];

function Toast({ item, side }: { item: Landed; side: "left" | "right" }) {
  return (
    <div className={`hp-feed hp-feed-${side}`} aria-hidden="true">
      <div className="hp-toast" key={item.amount}>
        <span className="hp-toast-mark">
          <BrandMark way={item.way} size={26} />
        </span>
        <span className="hp-toast-text">
          <b>{item.amount}</b>
          <small>{item.detail}</small>
        </span>
        <span className="hp-toast-ok">
          <Check size={14} strokeWidth={3} />
        </span>
      </div>
    </div>
  );
}

export function HeroBackdrop() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setI((n) => (n + 1) % local.length), 3600);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="hp-backdrop" aria-hidden="true">
      <Globe focus={local[i].city} className="hp-globe" lift={0.95} />
      <Toast item={local[i]} side="left" />
      <Toast item={tokens[i % tokens.length]} side="right" />
    </div>
  );
}
