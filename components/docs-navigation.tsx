"use client";
import Link from "next/link";
import { useState } from "react";
import type { DocItem } from "@/lib/docs";

const navigationSections = [
  {
    title: "Getting Started",
    slugs: ["overview", "quickstart", "activation"],
  },
  {
    title: "Core Concepts",
    slugs: [
      "provider-accounts",
      "payment-intents",
      "payment-methods",
      "settlement",
    ],
  },
  {
    title: "Integration",
    slugs: [
      "api-reference",
      "sdks",
      "webhooks",
      "provider-integration",
      "errors",
    ],
  },
  {
    title: "Provider Directory",
    slugs: ["providers"],
  },
  {
    title: "Stablecoins",
    slugs: [
      "providers/stablecoins",
      "providers/stablecoins/usdc",
      "providers/stablecoins/usdt",
      "providers/stablecoins/eurc",
    ],
  },
  {
    title: "Cards & Schemes",
    slugs: [
      "providers/cards",
      "providers/cards/visa",
      "providers/cards/mastercard",
    ],
  },
  {
    title: "Bank Transfer",
    slugs: [
      "providers/bank-transfer",
      "providers/bank-transfer/paystack",
      "providers/bank-transfer/flutterwave",
      "providers/bank-transfer/monnify",
      "providers/bank-transfer/sepa",
      "providers/bank-transfer/ach",
      "providers/bank-transfer/pix",
    ],
  },
  {
    title: "Digital Wallets",
    slugs: [
      "providers/digital-wallets",
      "providers/digital-wallets/apple-pay",
      "providers/digital-wallets/google-pay",
      "providers/digital-wallets/paypal",
      "providers/digital-wallets/alipay",
      "providers/digital-wallets/wechat-pay",
      "providers/digital-wallets/grabpay",
      "providers/digital-wallets/gcash",
      "providers/digital-wallets/shopeepay",
      "providers/digital-wallets/phonepe",
      "providers/digital-wallets/paytm",
      "providers/digital-wallets/mercado-pago",
      "providers/digital-wallets/picpay",
      "providers/digital-wallets/paypay",
      "providers/digital-wallets/kakaopay",
      "providers/digital-wallets/revolut-pay",
      "providers/digital-wallets/wero",
      "providers/digital-wallets/cash-app",
      "providers/digital-wallets/venmo",
      "providers/digital-wallets/opay",
      "providers/digital-wallets/palmpay",
      "providers/digital-wallets/chipper-cash",
    ],
  },
  {
    title: "Mobile Money",
    slugs: [
      "providers/mobile-money",
      "providers/mobile-money/mpesa",
      "providers/mobile-money/mtn-momo",
      "providers/mobile-money/airtel-money",
    ],
  },
  {
    title: "Crypto Apps",
    slugs: [
      "providers/crypto-apps",
      "providers/crypto-apps/binance-pay",
      "providers/crypto-apps/coinbase-commerce",
    ],
  },
  {
    title: "Real-World Assets",
    slugs: [
      "providers/real-world-assets",
      "providers/real-world-assets/ondo-usdy",
    ],
  },
  {
    title: "Buy Now, Pay Later",
    slugs: [
      "providers/bnpl",
      "providers/bnpl/klarna",
      "providers/bnpl/affirm",
    ],
  },
];

export function DocsNavigation({
  items,
  current,
}: {
  items: DocItem[];
  current: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  const isCurrent = (d: DocItem) =>
    current === d.slug || (d.aliases && d.aliases.includes(current));

  const results = items.filter((d) =>
    (d.title + " " + d.content).toLowerCase().includes(q.toLowerCase().trim()),
  );

  const itemsMap = new Map<string, DocItem>();
  for (const item of items) {
    itemsMap.set(item.slug, item);
  }

  return (
    <aside className="docs-nav">
      <button
        className="docs-mobile"
        aria-expanded={open}
        aria-controls="docs-menu"
        onClick={() => setOpen(!open)}
      >
        Documentation navigation {open ? "−" : "+"}
      </button>
      <div id="docs-menu" className={`docs-menu ${open ? "open" : ""}`}>
        <label htmlFor="docs-search" className="sr-only">
          Search documentation
        </label>
        <input
          id="docs-search"
          className="docs-search"
          placeholder="Search documentation…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
        />
        {q ? (
          <>
            <h2>Search results</h2>
            <nav aria-label="Documentation search results">
              {results.map((d) => (
                <Link
                  aria-current={isCurrent(d) ? "page" : undefined}
                  key={d.slug}
                  href={d.href}
                >
                  {d.title}
                </Link>
              ))}
            </nav>
            <p className="note" role="status">
              {results.length
                ? `${results.length} matching pages`
                : "No results. Try “Alipay”, “PhonePe” or “GrabPay”."}
            </p>
          </>
        ) : (
          <nav aria-label="Documentation by section">
            {navigationSections.map((sec) => {
              const secItems = sec.slugs
                .map((slug) => itemsMap.get(slug))
                .filter((it): it is DocItem => Boolean(it));
              if (!secItems.length) return null;
              return (
                <div key={sec.title} className="docs-nav-section">
                  <h2>{sec.title}</h2>
                  {secItems.map((d) => {
                    const isSubroute = d.slug.split("/").length > 2;
                    return (
                      <Link
                        aria-current={isCurrent(d) ? "page" : undefined}
                        key={d.slug}
                        href={d.href}
                        className={isSubroute ? "docs-sublink" : undefined}
                      >
                        {d.title}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
        )}
      </div>
    </aside>
  );
}
