"use client";
// The front page's hero picture: one merchant checkout, shown to customers on
// each continent. Switching country changes the currency and the ways to pay,
// which is the product in one glance. Credit plans are computed with the
// same arithmetic as checkout (lib/treasury/credit.ts). It is a preview:
// methods depend on the merchant's account and the customer's country.
import { useState } from "react";
import { instalmentOffer } from "@/lib/treasury/credit";
import { calculateCheckoutTax } from "@/lib/payments/tax";

type Row = { name: string; detail: string; kind: "card" | "wallet" | "bank" | "mobile" | "ussd" | "credit" | "crypto" };
type Place = {
  id: string;
  country: string;
  countryCode: string;
  // Tab label: the country, shortened where it's long.
  tab: string;
  continent: string;
  currency: string;
  locale: string;
  shop: string;
  item: string;
  // Price in minor units.
  price: bigint;
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
    countryCode: "NG",
    tab: "Nigeria",
    continent: "Africa",
    currency: "NGN",
    locale: "en-NG",
    shop: "Kora Phones",
    item: "Smartphone, 128 GB",
    price: 15000000n,
    rows: [
      { kind: "bank", name: "Bank transfer", detail: "NIBSS instant transfer" },
      { kind: "card", name: "Card", detail: "Verve, Visa, Mastercard" },
      { kind: "ussd", name: "USSD", detail: "Dial code, no data" },
      { kind: "wallet", name: "Wallet", detail: "OPay, PalmPay" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "USDC, USDT" },
    ],
  },
  {
    id: "gb",
    country: "United Kingdom",
    countryCode: "GB",
    tab: "UK",
    continent: "Europe",
    currency: "GBP",
    locale: "en-GB",
    shop: "Northside Cycles",
    item: "Commuter bike",
    price: 64000n,
    rows: [
      { kind: "wallet", name: "Apple Pay or Google Pay", detail: "One tap" },
      { kind: "bank", name: "Pay by bank", detail: "Faster Payments" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard, Amex" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "Any wallet, any network" },
    ],
  },
  {
    id: "in",
    country: "India",
    countryCode: "IN",
    tab: "India",
    continent: "Asia",
    currency: "INR",
    locale: "en-IN",
    shop: "Mehta Electronics",
    item: "Smartwatch",
    price: 1200000n,
    rows: [
      { kind: "bank", name: "UPI", detail: "PhonePe, GPay, BHIM" },
      { kind: "wallet", name: "Wallet", detail: "PhonePe, Paytm" },
      { kind: "card", name: "Card", detail: "RuPay, Visa, Mastercard" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "Any wallet, any network" },
    ],
  },
  {
    id: "us",
    country: "United States",
    countryCode: "US",
    tab: "USA",
    continent: "North America",
    currency: "USD",
    locale: "en-US",
    shop: "Trailhead Outfitters",
    item: "Hiking backpack, 45 L",
    price: 18000n,
    rows: [
      { kind: "wallet", name: "Apple Pay or Google Pay", detail: "One tap" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard, Amex" },
      { kind: "mobile", name: "Venmo or Cash App", detail: "Instant wallet" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "Any wallet, any network" },
    ],
  },
  {
    id: "br",
    country: "Brazil",
    countryCode: "BR",
    tab: "Brazil",
    continent: "South America",
    currency: "BRL",
    locale: "pt-BR",
    shop: "Loja Aurora",
    item: "Smart TV, 50-inch",
    price: 240000n,
    rows: [
      { kind: "bank", name: "Pix", detail: "Instant QR" },
      { kind: "wallet", name: "Wallet", detail: "Mercado Pago, PicPay" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard, Elo" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "Any wallet, any network" },
    ],
  },
  {
    id: "au",
    country: "Australia",
    countryCode: "AU",
    tab: "Australia",
    continent: "Oceania",
    currency: "AUD",
    locale: "en-AU",
    shop: "Coastline Surf Co",
    item: "Surfboard, 7 ft",
    price: 90000n,
    rows: [
      { kind: "wallet", name: "Apple Pay or Google Pay", detail: "One tap" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard, Amex" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "Any wallet, any network" },
    ],
  },
  {
    id: "anywhere",
    country: "Anywhere",
    countryCode: "DE",
    tab: "Anywhere",
    continent: "Worldwide",
    currency: "USD",
    locale: "en-US",
    shop: "Synth Labs",
    item: "Annual plan",
    price: 15000n,
    rows: [
      { kind: "crypto", name: "USDC or USDT", detail: "8 networks" },
      { kind: "crypto", name: "Any token, any chain", detail: "Swapped to USDC" },
      { kind: "wallet", name: "Apple Pay or Google Pay", detail: "One tap" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard, Amex" },
      { kind: "credit", name: "Pay with credit", detail: "" },
    ],
  },
];

const settlementTargets = ["Local", "USDC", "EUR", "USD"] as const;

const usdPerUnitScaled: Record<string, bigint> = {
  USD: 1_000_000_000_000n,
  USDC: 1_000_000_000_000n,
  EUR: 1_086_956_521_739n,
  GBP: 1_265_822_784_810n,
  NGN: 625_000_000n,
  INR: 11_904_761_905n,
  BRL: 176_991_150_442n,
  AUD: 657_894_736_842n,
};

function spliceSettlementMinor(presentmentMinor: bigint, fromCurrency: string, toCurrency: string): bigint {
  if (fromCurrency === toCurrency) return presentmentMinor;
  const fromUsd = usdPerUnitScaled[fromCurrency] ?? 1_000_000_000_000n;
  const toUsd = usdPerUnitScaled[toCurrency] ?? 1_000_000_000_000n;
  return (presentmentMinor * fromUsd) / toUsd;
}

export function HeroDemo({ initial = places[0].id }: { initial?: string }) {
  const [id, setId] = useState(initial);
  const [settleTarget, setSettleTarget] = useState<(typeof settlementTargets)[number]>("USDC");
  const place = places.find((p) => p.id === id)!;
  const plan = credit(place.price, 4, "two-weeks", 0);
  const fmt = (m: bigint | string) => money(BigInt(m), place.currency, place.locale);
  const [selected, setSelected] = useState("credit");
  const tax = calculateCheckoutTax({
    amountMinor: place.price,
    currency: place.currency,
    buyerAddress: {
      country: place.countryCode,
      stateOrProvince: place.countryCode === "US" ? "NY" : undefined,
    },
    productCategory: place.id === "anywhere" ? "saas" : "physical",
    taxBehavior: "inclusive",
  });
  const taxLabel = tax.lineItems[0]?.taxType ?? "Tax";
  const targetCurrency = settleTarget === "Local" ? place.currency : settleTarget;
  const settledMinor = spliceSettlementMinor(place.price, place.currency, targetCurrency);
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
              setSelected("credit");
            }}
          >
            {p.tab}
          </button>
        ))}
      </div>
      <div className="hd-sheet" role="tabpanel" aria-label={`Checkout in ${place.country}`}>
        <div className="hd-order">
          <span className="hd-shop">
            {place.shop} · {taxLabel} incl. ({fmt(tax.taxMinor)})
          </span>
          <span className="hd-item">{place.item}</span>
          <strong className="hd-price">{fmt(place.price)}</strong>
        </div>
        <ul className="hd-rows">
          {place.rows.map((r) => {
            const key = r.kind === "credit" ? "credit" : `${r.kind}-${r.name}`;
            const isCredit = r.kind === "credit";
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`hd-row hd-${r.kind}`}
                  aria-pressed={selected === key}
                  onClick={() => setSelected(key)}
                >
                  <span className="hd-dot" aria-hidden="true" />
                  <span className="hd-name">{r.name}</span>
                  <span className="hd-detail">
                    {isCredit ? `4 × ${fmt(plan.instalmentMinor)}` : r.detail}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {selected === "credit" ? (
          <div className="hd-plan" aria-live="polite">
            <div className="hd-plan-bars" aria-hidden="true">
              {["Today", "2 wks", "4 wks", "6 wks"].map((w) => (
                <span key={w}>
                  <i />
                  {w}
                </span>
              ))}
            </div>
            <p>
              {place.shop} settles <strong>{money(settledMinor, targetCurrency, place.locale)}</strong> today.
            </p>
          </div>
        ) : (
          <div className="hd-plan hd-plan-plain" aria-live="polite">
            <p>
              Settles <strong>{money(settledMinor, targetCurrency, place.locale)}</strong> to {place.shop}.
            </p>
          </div>
        )}
        <div className="hd-settle" role="group" aria-label="Settlement currency">
          <span>Settle in</span>
          {settlementTargets.map((t) => (
            <button
              key={t}
              type="button"
              className="hd-settle-btn"
              aria-pressed={settleTarget === t}
              onClick={() => setSettleTarget(t)}
            >
              {t === "Local" ? place.currency : t}
            </button>
          ))}
        </div>
        <span className="hd-pay">Continue</span>
      </div>
    </figure>
  );
}
