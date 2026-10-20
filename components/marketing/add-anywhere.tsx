"use client";
// "Add it where you sell": one panel per place a merchant can put the
// button. Code for sites and apps; a three-step strip for store platforms.
import { useState } from "react";
import Link from "next/link";
import type { Availability } from "@/content/claims";

type Tab = {
  id: string;
  label: string;
  status: Availability;
  code?: string;
  steps?: [string, string][];
  link: [string, string];
};

export function AddAnywhere({ origin, statuses }: { origin: string; statuses: Record<string, Availability> }) {
  const tabs: Tab[] = [
    {
      id: "html",
      label: "Any website",
      status: statuses.html,
      code: `<script src="${origin}/js/v1/payrouta.js" async></script>

<button data-payrouta-checkout="/create-checkout">
  Checkout
</button>`,
      link: ["/docs/checkout-button", "Checkout button guide"],
    },
    {
      id: "react",
      label: "React app",
      status: statuses.react,
      code: `import { PayRoutaButton } from "@payrouta/checkout";

<PayRoutaButton
  origin="${origin}"
  session="/create-checkout"
  onEvent={(e) => e === "confirmed" && showReceipt()}
/>`,
      link: ["/docs/checkout-button", "React guide"],
    },
    {
      id: "shopify",
      label: "Shopify",
      status: statuses.shopify,
      steps: [
        ["Connect", "Link your store from your PayRouta dashboard."],
        ["Activate", "Turn PayRouta on in Shopify payments."],
        ["Sell", "Buyers pick PayRouta at checkout. Orders complete in Shopify."],
      ],
      link: ["/docs/shopify", "Shopify guide"],
    },
    {
      id: "woocommerce",
      label: "WooCommerce",
      status: statuses.woocommerce,
      steps: [
        ["Install", "Add the PayRouta Checkout plugin."],
        ["Paste your key", "API key and webhook secret in settings."],
        ["Sell", "Orders are marked paid only after PayRouta confirms."],
      ],
      link: ["/docs/woocommerce", "WooCommerce guide"],
    },
  ];
  const [id, setId] = useState(tabs[0].id);
  const tab = tabs.find((t) => t.id === id)!;
  return (
    <div className="aa">
      <div className="aa-tabs" role="tablist" aria-label="Where to add PayRouta">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={t.id === id} className="aa-tab" onClick={() => setId(t.id)}>
            {t.label}
            <span className={`aa-status aa-status-${t.status}`}>{t.status === "available" ? "Live" : "Coming"}</span>
          </button>
        ))}
      </div>
      <div className="aa-panel" role="tabpanel" aria-label={tab.label}>
        {tab.code ? (
          <pre className="aa-code" tabIndex={0}>
            <code>{tab.code}</code>
          </pre>
        ) : (
          <ol className="aa-steps">
            {tab.steps!.map(([title, text], i) => (
              <li key={title}>
                <span className="dg-step">{i + 1}</span>
                <b>{title}</b>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        )}
        <Link className="hp-link" href={tab.link[0]}>
          {tab.link[1]} <span aria-hidden="true">→</span>
        </Link>
      </div>
    </div>
  );
}
