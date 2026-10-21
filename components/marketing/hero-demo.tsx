"use client";
// The front page's hero picture: one merchant checkout, shown to customers in
// different places. Switching city changes the currency and the ways to pay,
// which is the product in one glance. Credit plans are computed with the
// same arithmetic as checkout (lib/treasury/credit.ts). It is a preview:
// methods depend on the merchant's account and the customer's country.
import { useState } from "react";
import { instalmentOffer } from "@/lib/treasury/credit";

type Row = { name: string; detail: string; kind: "card" | "wallet" | "bank" | "mobile" | "ussd" | "credit" | "crypto" };
type Place = {
  id: string;
  city: string;
  currency: string;
  locale: string;
  shop: string;
  item: string;
  // Price in minor units.
  price: bigint;
  rows: Row[];
};

const money = (minor: bigint, currency: string, locale: string) =>
  new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: minor % 100n === 0n ? 0 : 2,
    minimumFractionDigits: minor % 100n === 0n ? 0 : 2,
  }).format(Number(minor) / 100);

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

const places: Place[] = [
  {
    id: "lagos",
    city: "Lagos",
    currency: "NGN",
    locale: "en-NG",
    shop: "Kora Phones",
    item: "Smartphone, 128 GB",
    price: 15000000n,
    rows: [
      { kind: "card", name: "Card", detail: "Verve, Visa, Mastercard" },
      { kind: "bank", name: "Bank transfer", detail: "From any Nigerian bank app" },
      { kind: "ussd", name: "USSD", detail: "Dial a code, no data needed" },
      { kind: "wallet", name: "Wallet", detail: "Pay from your wallet app" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "USDT, USDC and more" },
    ],
  },
  {
    id: "nairobi",
    city: "Nairobi",
    currency: "KES",
    locale: "en-KE",
    shop: "Mtaa Tech",
    item: "Laptop, 14-inch",
    price: 6500000n,
    rows: [
      { kind: "mobile", name: "M-Pesa", detail: "Approve on your phone" },
      { kind: "mobile", name: "Airtel Money", detail: "Approve on your phone" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "Any wallet, any network" },
    ],
  },
  {
    id: "sao-paulo",
    city: "São Paulo",
    currency: "BRL",
    locale: "pt-BR",
    shop: "Loja Aurora",
    item: "Smart TV, 50-inch",
    price: 240000n,
    rows: [
      { kind: "bank", name: "Pix", detail: "Scan and pay in seconds" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard, Elo" },
      { kind: "wallet", name: "Wallet", detail: "Mercado Pago, PicPay" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "Any wallet, any network" },
    ],
  },
  {
    id: "london",
    city: "London",
    currency: "GBP",
    locale: "en-GB",
    shop: "Northside Cycles",
    item: "Commuter bike",
    price: 64000n,
    rows: [
      { kind: "wallet", name: "Apple Pay or Google Pay", detail: "One tap" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard, Amex" },
      { kind: "bank", name: "Pay by bank", detail: "Approve in your banking app" },
      { kind: "credit", name: "Pay with credit", detail: "" },
      { kind: "crypto", name: "Stablecoins or crypto", detail: "Any wallet, any network" },
    ],
  },
  {
    id: "anywhere",
    city: "Anywhere",
    currency: "USD",
    locale: "en-US",
    shop: "Synth Labs",
    item: "Annual plan",
    price: 15000n,
    rows: [
      { kind: "crypto", name: "USDC or USDT", detail: "From any wallet, on 8 networks" },
      { kind: "crypto", name: "Any token, any chain", detail: "Swapped on the way, you get USDC" },
      { kind: "wallet", name: "Apple Pay or Google Pay", detail: "One tap" },
      { kind: "card", name: "Card", detail: "Visa, Mastercard, Amex" },
      { kind: "credit", name: "Pay with credit", detail: "" },
    ],
  },
];

export function HeroDemo({ initial = places[0].id }: { initial?: string }) {
  const [id, setId] = useState(initial);
  const place = places.find((p) => p.id === id)!;
  const plan = credit(place.price, 4, "two-weeks", 0);
  const fmt = (m: bigint | string) => money(BigInt(m), place.currency, place.locale);
  const [selected, setSelected] = useState("credit");
  return (
    <figure className="hd" aria-label="Preview of a PayRouta checkout in different cities">
      <div className="hd-tabs" role="tablist" aria-label="Customer location">
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
            {p.city}
          </button>
        ))}
      </div>
      <div className="hd-sheet" role="tabpanel" aria-label={`Checkout in ${place.city}`}>
        <div className="hd-order">
          <span className="hd-shop">{place.shop}</span>
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
                    {isCredit ? `4 payments of ${fmt(plan.instalmentMinor)}, no interest` : r.detail}
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
              {place.shop} gets <strong>{fmt(place.price)}</strong> today. You repay the lender.
            </p>
          </div>
        ) : (
          <div className="hd-plan hd-plan-plain" aria-live="polite">
            <p>Pay {fmt(place.price)} on the next screen.</p>
          </div>
        )}
        <span className="hd-pay">Continue</span>
      </div>
    </figure>
  );
}
