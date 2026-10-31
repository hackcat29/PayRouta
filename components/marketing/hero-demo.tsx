"use client";
// The front page's hero picture: one merchant checkout, shown to customers on
// each continent. Switching country changes the currency and the ways to pay,
// which is the product in one glance. It mirrors the real checkout: method
// names with card brand marks, credit plans computed with checkout's own
// arithmetic (lib/treasury/credit.ts), and the crypto step that asks what
// the customer pays with (app/checkout/[sessionId]/pay-picker.tsx).
import { useState } from "react";
import { instalmentOffer } from "@/lib/treasury/credit";
import { heroPayOptions } from "./hero-pay-options";

type Kind = "card" | "wallet" | "bank" | "ussd" | "credit" | "crypto";
type Row = { name: string; kind: Kind };
type Place = {
  id: string;
  country: string;
  // Tab label: the country, shortened where it's long.
  tab: string;
  currency: string;
  locale: string;
  shop: string;
  item: string;
  // Price in minor units.
  price: bigint;
  brands: string[];
  // The network and token the crypto step starts on: what a customer there
  // typically pays with. Every other network and token is in the lists.
  crypto: [network: string, token: string];
  rows: Row[];
};

const money = (minor: bigint, currency: string, locale: string) => {
  const iso = currency === "USDC" || currency === "USDT" ? "USD" : currency === "EURC" ? "EUR" : currency;
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: iso,
    maximumFractionDigits: minor % 100n === 0n ? 0 : 2,
    minimumFractionDigits: minor % 100n === 0n ? 0 : 2,
  }).format(Number(minor) / 100);
  return currency === "USDC" || currency === "USDT" || currency === "EURC"
    ? `${(Number(minor) / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`
    : formatted;
};

function credit(price: bigint, instalments: number, interval: "two-weeks" | "month", costBps: number) {
  return instalmentOffer({
    id: "preview",
    lender: "",
    termsUrl: "",
    amountMinor: price,
    instalments,
    interval,
    costBps,
    aprBasisPoints: null,
    firstDueToday: interval === "two-weeks",
  });
}

// One country per continent, in the order Africa, Europe, Asia, North
// America, South America, Oceania, each with the ways people pay there;
// then "Anywhere": a customer paying in crypto from wherever they are.
const places: Place[] = [
  {
    id: "ng",
    country: "Nigeria",
    tab: "Nigeria",
    currency: "NGN",
    locale: "en-NG",
    shop: "Kora Phones",
    item: "Smartphone, 128 GB",
    price: 15000000n,
    brands: ["Verve", "Visa", "MC"],
    crypto: ["Tron", "USDT"],
    rows: [
      { kind: "bank", name: "Bank transfer" },
      { kind: "card", name: "Card" },
      { kind: "ussd", name: "USSD" },
      { kind: "wallet", name: "Digital wallets" },
      { kind: "credit", name: "Pay with credit" },
      { kind: "crypto", name: "Stablecoins or crypto" },
    ],
  },
  {
    id: "gb",
    country: "United Kingdom",
    tab: "UK",
    currency: "GBP",
    locale: "en-GB",
    shop: "Northside Cycles",
    item: "Commuter bike",
    price: 64000n,
    brands: ["Visa", "MC", "Amex"],
    crypto: ["Ethereum", "USDC"],
    rows: [
      { kind: "wallet", name: "Digital wallets" },
      { kind: "bank", name: "Pay by bank" },
      { kind: "card", name: "Card" },
      { kind: "credit", name: "Pay with credit" },
      { kind: "crypto", name: "Stablecoins or crypto" },
    ],
  },
  {
    id: "in",
    country: "India",
    tab: "India",
    currency: "INR",
    locale: "en-IN",
    shop: "Mehta Electronics",
    item: "Smartwatch",
    price: 1200000n,
    brands: ["RuPay", "Visa", "MC"],
    crypto: ["Polygon", "USDT"],
    rows: [
      { kind: "bank", name: "UPI" },
      { kind: "wallet", name: "Digital wallets" },
      { kind: "card", name: "Card" },
      { kind: "credit", name: "Pay with credit" },
      { kind: "crypto", name: "Stablecoins or crypto" },
    ],
  },
  {
    id: "us",
    country: "United States",
    tab: "USA",
    currency: "USD",
    locale: "en-US",
    shop: "Trailhead Outfitters",
    item: "Hiking backpack, 45 L",
    price: 18000n,
    brands: ["Visa", "MC", "Amex"],
    crypto: ["Base", "USDC"],
    rows: [
      { kind: "wallet", name: "Digital wallets" },
      { kind: "card", name: "Card" },
      { kind: "credit", name: "Pay with credit" },
      { kind: "crypto", name: "Stablecoins or crypto" },
    ],
  },
  {
    id: "br",
    country: "Brazil",
    tab: "Brazil",
    currency: "BRL",
    locale: "pt-BR",
    shop: "Loja Aurora",
    item: "Smart TV, 50-inch",
    price: 240000n,
    brands: ["Elo", "Visa", "MC"],
    crypto: ["Solana", "USDC"],
    rows: [
      { kind: "bank", name: "Pix" },
      { kind: "wallet", name: "Digital wallets" },
      { kind: "card", name: "Card" },
      { kind: "credit", name: "Pay with credit" },
      { kind: "crypto", name: "Stablecoins or crypto" },
    ],
  },
  {
    id: "au",
    country: "Australia",
    tab: "Australia",
    currency: "AUD",
    locale: "en-AU",
    shop: "Coastline Surf Co",
    item: "Surfboard, 7 ft",
    price: 90000n,
    brands: ["Visa", "MC", "Amex"],
    crypto: ["Arbitrum", "USDC"],
    rows: [
      { kind: "wallet", name: "Digital wallets" },
      { kind: "card", name: "Card" },
      { kind: "credit", name: "Pay with credit" },
      { kind: "crypto", name: "Stablecoins or crypto" },
    ],
  },
  {
    id: "anywhere",
    country: "Anywhere",
    tab: "Anywhere",
    currency: "USD",
    locale: "en-US",
    shop: "Synth Labs",
    item: "Annual plan",
    price: 15000n,
    brands: ["Visa", "MC", "Amex"],
    crypto: ["Solana", "SOL"],
    rows: [
      { kind: "crypto", name: "Stablecoins or crypto" },
      { kind: "wallet", name: "Digital wallets" },
      { kind: "card", name: "Card" },
      { kind: "credit", name: "Pay with credit" },
    ],
  },
];

export function HeroDemo({ initial = places[0].id }: { initial?: string }) {
  const [id, setId] = useState(initial);
  const place = places.find((p) => p.id === id)!;
  const [selected, setSelected] = useState<Kind>(place.rows[0].kind);
  const [network, setNetwork] = useState(place.crypto[0]);
  const [token, setToken] = useState(place.crypto[1]);
  const tokens = heroPayOptions.find((n) => n.name === network)?.tokens ?? [];
  const plan = credit(place.price, 4, "two-weeks", 0);
  const fmt = (m: bigint | string) => money(BigInt(m), place.currency, place.locale);
  const price = fmt(place.price);
  return (
    <figure className="hd" aria-label="Preview of a PayRouta checkout in a country on each continent">
      <div className="hd-tabs" role="tablist" aria-label="Customer country">
        {places.map((p) => (
          <button
            key={p.id}
            role="tab"
            type="button"
            aria-selected={p.id === id}
            className="hd-tab"
            onClick={() => {
              setId(p.id);
              setSelected(p.rows[0].kind);
              setNetwork(p.crypto[0]);
              setToken(p.crypto[1]);
            }}
          >
            {p.tab}
          </button>
        ))}
      </div>
      <div className="hd-sheet" role="tabpanel" aria-label={`Checkout in ${place.country}`}>
        <div className="hd-order">
          <span className="hd-shop">{place.shop}</span>
          <span className="hd-item">{place.item}</span>
          <strong className="hd-price">{price}</strong>
        </div>
        <ul className="hd-rows">
          {place.rows.map((r) => (
            <li key={r.kind}>
              <button
                type="button"
                className={`hd-row hd-${r.kind}`}
                aria-pressed={selected === r.kind}
                onClick={() => setSelected(r.kind)}
              >
                <span className="hd-dot" aria-hidden="true" />
                <span className="hd-name">{r.name}</span>
                {r.kind === "card" && (
                  <span className="hd-brands" aria-hidden="true">
                    {place.brands.map((b) => (
                      <i key={b}>{b}</i>
                    ))}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {selected === "credit" && (
          <div className="hd-step" aria-live="polite">
            <strong>4 payments of {fmt(plan.instalmentMinor)}</strong>
            <span>
              Every 2 weeks · {plan.dueTodayMinor !== "0" ? `${fmt(plan.dueTodayMinor)} due today` : "Nothing due today"}
            </span>
            <span>Total {fmt(plan.totalMinor)} · no interest or fees</span>
          </div>
        )}
        {selected === "crypto" && (
          <div className="hd-step" aria-live="polite">
            <strong>What do you want to pay with?</strong>
            <span className="hd-fields">
              <label className="hd-field">
                <small>Network</small>
                <select
                  value={network}
                  onChange={(e) => {
                    setNetwork(e.target.value);
                    setToken(heroPayOptions.find((n) => n.name === e.target.value)?.tokens[0] ?? "");
                  }}
                >
                  {heroPayOptions.map((n) => (
                    <option key={n.name}>{n.name}</option>
                  ))}
                </select>
              </label>
              <label className="hd-field">
                <small>Token</small>
                <select value={token} onChange={(e) => setToken(e.target.value)}>
                  {tokens.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            </span>
          </div>
        )}
        <span className="hd-pay">
          {selected === "credit" || selected === "crypto" ? "Continue" : `Pay ${price}`}
        </span>
      </div>
    </figure>
  );
}
