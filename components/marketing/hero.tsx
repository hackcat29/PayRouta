"use client";
// The front page hero's stage: the checkout floating over the horizon of a
// globe, with payments landing on either side, money in local currencies on
// the left and any token settling as the merchant's stablecoin on the right.
// Choosing a country in the checkout turns the globe to it.
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { Globe } from "@/components/gpu/globe";
import type { WayToPay } from "@/content/claims";
import { HeroDemo } from "./hero-demo";
import { BrandMark } from "./logos";

type Landed = { way: Pick<WayToPay, "logo" | "mark" | "name">; amount: string; detail: string };

const local: Landed[] = [
  { way: { name: "Pix", logo: "pix" }, amount: "R$ 2.400,00", detail: "Pix · São Paulo" },
  { way: { name: "M-Pesa", mark: { text: "M", color: "#fff", bg: "#00a650" } }, amount: "KSh 12,500", detail: "M-Pesa · Nairobi" },
  { way: { name: "Apple Pay", logo: "applepay" }, amount: "£640.00", detail: "Apple Pay · London" },
  { way: { name: "Visa", logo: "visa" }, amount: "₦150,000", detail: "Card · Lagos" },
];
const tokens: Landed[] = [
  { way: { name: "Solana", logo: "sol" }, amount: "0.27 SOL", detail: "Settled 40.00 USDC" },
  { way: { name: "USDT", logo: "trx" }, amount: "150.00 USDT on Tron", detail: "Settled 150.00 USDC" },
  { way: { name: "Bitcoin", logo: "btc" }, amount: "0.0021 BTC", detail: "Settled 180.00 USDC" },
  { way: { name: "Token", mark: { text: "CA", color: "#fff", bg: "#f26b1d" } }, amount: "Any token by contract", detail: "Settled 25.00 USDC" },
];

function Feed({ items, side, delay }: { items: Landed[]; side: "left" | "right"; delay: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: ReturnType<typeof setInterval>;
    const start = setTimeout(() => {
      timer = setInterval(() => setI((n) => (n + 1) % items.length), 3200);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [items.length, delay]);
  const it = items[i];
  return (
    <div className={`hp-feed hp-feed-${side}`} aria-hidden="true">
      <div className="hp-toast" key={i}>
        <span className="hp-toast-mark">
          <BrandMark way={it.way} size={26} />
        </span>
        <span className="hp-toast-text">
          <b>{it.amount}</b>
          <small>{it.detail}</small>
        </span>
        <span className="hp-toast-ok">
          <Check size={14} strokeWidth={3} />
        </span>
      </div>
    </div>
  );
}

export function HeroStage() {
  const [place, setPlace] = useState<string>("ng");
  return (
    <div className="hp-stage">
      <Globe focus={place === "anywhere" ? null : place} className="hp-globe" lift={0.72} turn={0.5} />
      <Feed items={local} side="left" delay={0} />
      <Feed items={tokens} side="right" delay={1600} />
      <div className="hp-stage-card">
        <HeroDemo onPlace={setPlace} />
      </div>
    </div>
  );
}
