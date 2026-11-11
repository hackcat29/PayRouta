"use client";
// A token's mark in the crypto checkout: its logo, served from PayRouta
// (lib/intents/token-logos.ts), on a small badge of the chain it's on. Until
// a logo exists, or if it fails to load, its brand colour and initials are
// drawn here instead. Unknown tokens get a stable colour from their symbol.
import { useState } from "react";

const brands: Record<string, [string, string]> = {
  USDC: ["#2775ca", "#fff"],
  USDCX: ["#2775ca", "#fff"],
  EURC: ["#2775ca", "#fff"],
  USDT: ["#26a17b", "#fff"],
  USDT0: ["#26a17b", "#fff"],
  DAI: ["#f5ac37", "#1e2466"],
  ETH: ["#627eea", "#fff"],
  WETH: ["#627eea", "#fff"],
  BTC: ["#f7931a", "#fff"],
  WBTC: ["#f7931a", "#fff"],
  CBBTC: ["#0052ff", "#fff"],
  SOL: ["#9945ff", "#fff"],
  NEAR: ["#111", "#fff"],
  WNEAR: ["#111", "#fff"],
  BNB: ["#f3ba2f", "#1e2026"],
  POL: ["#8247e5", "#fff"],
  AVAX: ["#e84142", "#fff"],
  ARB: ["#28a0f0", "#fff"],
  OP: ["#ff0420", "#fff"],
  TRX: ["#eb0029", "#fff"],
  TON: ["#0098ea", "#fff"],
  XRP: ["#23292f", "#fff"],
  XLM: ["#111", "#fff"],
  DOGE: ["#c2a633", "#fff"],
  LTC: ["#345d9d", "#fff"],
  BCH: ["#8dc351", "#fff"],
  ZEC: ["#f4b728", "#1e2466"],
  ADA: ["#0033ad", "#fff"],
  SUI: ["#4da2ff", "#fff"],
  APT: ["#111", "#fff"],
  LINK: ["#2a5ada", "#fff"],
  UNI: ["#ff007a", "#fff"],
  AAVE: ["#b6509e", "#fff"],
  PEPE: ["#3d8130", "#fff"],
};

// The sign a token is known by, where it has one.
const glyphs: Record<string, string> = {
  USDC: "$", USDCX: "$", USDT: "₮", USDT0: "₮", EURC: "€", DAI: "◈", ETH: "Ξ", WETH: "Ξ",
  BTC: "₿", WBTC: "₿", CBBTC: "₿", SOL: "◎", DOGE: "Ð", LTC: "Ł", XRP: "✕",
};

function colours(symbol: string): [string, string] {
  const known = brands[symbol.toUpperCase()];
  if (known) return known;
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) % 360;
  return [`hsl(${h} 45% 42%)`, "#fff"];
}

function Mark({ symbol, size }: { symbol: string; size: number }) {
  const [bg, fg] = colours(symbol);
  const letters = glyphs[symbol.toUpperCase()] ?? symbol.replace(/^[^A-Za-z0-9]+/, "").replace(/^w(?=[A-Z])/, "").slice(0, 2);
  return (
    // The letters are drawn by CSS (::before): the mark is decoration, not text.
    <span
      className="tk-icon"
      aria-hidden="true"
      data-glyph={letters.toUpperCase()}
      style={{ background: bg, color: fg, width: size, height: size, fontSize: Math.round(size * (letters.length > 1 ? 0.36 : 0.5)) }}
    />
  );
}

function Logo({ src, symbol, size }: { src?: string; symbol: string; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <Mark symbol={symbol} size={size} />;
  return <img className="tk-img" src={src} alt="" aria-hidden="true" width={size} height={size} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

export function TokenIcon({ symbol, size = 28, src, chain }: { symbol: string; size?: number; src?: string; chain?: { name: string; logo?: string } }) {
  if (!chain) return <Logo src={src} symbol={symbol} size={size} />;
  const badge = Math.max(12, Math.round(size * 0.46));
  return (
    <span className="tk-stack" style={{ width: size, height: size }} aria-hidden="true">
      <Logo src={src} symbol={symbol} size={size} />
      <span className="tk-badge" style={{ width: badge, height: badge }}>
        <Logo src={chain.logo} symbol={chain.name} size={badge - 2} />
      </span>
    </span>
  );
}

// A chain's logo, or its initials when there's none.
export function ChainIcon({ name, logo, size = 18 }: { name: string; logo?: string; size?: number }) {
  return <Logo src={logo} symbol={name} size={size} />;
}
