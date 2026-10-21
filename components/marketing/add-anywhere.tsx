"use client";
// Where a merchant can take payments: a shared link (no website), the
// button on a site, or a store plugin.
import { useState } from "react";
import type { Availability } from "@/content/claims";
import { docsUrl } from "@/lib/site-config";

type Tab = {
  id: "link" | "html" | "shopify" | "woocommerce";
  label: string;
  steps?: [string, string][];
  link: [string, string];
};

const tabs: Tab[] = [
  { id: "link", label: "Payment link", link: [docsUrl("payment-links"), "Payment links guide"] },
  { id: "html", label: "Website", link: [docsUrl("checkout-button"), "Checkout button guide"] },
  {
    id: "shopify",
    label: "Shopify",
    steps: [
      ["Connect", "Link your store from your PayRouta dashboard."],
      ["Activate", "Turn PayRouta on in Shopify payments."],
      ["Sell", "Buyers pick PayRouta at checkout. Orders complete in Shopify."],
    ],
    link: [docsUrl("shopify"), "Shopify guide"],
  },
  {
    id: "woocommerce",
    label: "WooCommerce",
    steps: [
      ["Install", "Add the PayRouta Checkout plugin."],
      ["Paste your key", "API key and webhook secret in settings."],
      ["Sell", "Orders are marked paid only after PayRouta confirms."],
    ],
    link: [docsUrl("woocommerce"), "WooCommerce guide"],
  },
];

export function LinkPicture({ origin }: { origin: string }) {
  const host = origin.replace(/^https?:\/\//, "");
  return (
    <div className="aa-link" aria-label="A payment link sent in a chat, and the page it opens">
      <div className="aa-chat">
        <p className="aa-bubble">
          Hi Amaka, here&apos;s the link for the phone 👇
          <span className="aa-url">{host}/pay/k3Fd92xQ</span>
        </p>
      </div>
      <div className="aa-page">
        <span className="aa-page-shop">Kora Phones</span>
        <strong>Smartphone, 128 GB</strong>
        <span className="aa-page-price">₦150,000</span>
        <span className="aa-page-ways">
          <i>Card</i>
          <i>Bank</i>
          <i>USSD</i>
          <i>Crypto</i>
          <i> Digital Wallet</i>
          <i className="aa-credit">Pay with credit</i>
        </span>
        <span className="aa-page-pay">Pay ₦150,000</span>
      </div>
    </div>
  );
}

export function AddAnywhere({
  origin,
  statuses,
  initial = "link",
}: {
  origin: string;
  statuses: Record<Tab["id"], Availability>;
  initial?: Tab["id"];
}) {
  const [id, setId] = useState<Tab["id"]>(initial);
  const tab = tabs.find((t) => t.id === id)!;
  return (
    <div className="aa">
      <div className="aa-tabs" role="tablist" aria-label="Where to take payments">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={t.id === id} className="aa-tab" onClick={() => setId(t.id)}>
            {t.label}
            {statuses[t.id] !== "available" && <span className="aa-status">Coming</span>}
          </button>
        ))}
      </div>
      <div className="aa-panel" role="tabpanel" aria-label={tab.label}>
        {tab.id === "link" ? (
          <LinkPicture origin={origin} />
        ) : tab.id === "html" ? (
          <pre className="aa-code" tabIndex={0}>
            <code>{`<script src="${origin}/js/v1/payrouta.js" async></script>

<button data-payrouta-checkout="/create-checkout">
  Checkout
</button>`}</code>
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
        <a className="hp-link" href={tab.link[0]}>
          {tab.link[1]} <span aria-hidden="true">→</span>
        </a>
      </div>
    </div>
  );
}
