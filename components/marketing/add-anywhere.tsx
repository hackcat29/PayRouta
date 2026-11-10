"use client";
// Where a merchant can take payments: a shared link (no website), the
// button on a site, a call from their own server, AI agents, or a store
// plugin.
import { useState } from "react";
import type { Availability } from "@/content/claims";
import { docsUrl } from "@/lib/site-config";

type TabId = "link" | "html" | "server" | "agents" | "shopify" | "woocommerce";
type Tab = {
  id: TabId;
  label: string;
  steps?: string[];
  link: [string, string];
};

const tabs: Tab[] = [
  { id: "link", label: "Payment link", link: [docsUrl("payment-links"), "Payment links guide"] },
  { id: "html", label: "Website", link: [docsUrl("checkout-button"), "Checkout button guide"] },
  { id: "server", label: "Server", link: [docsUrl("sdks"), "SDKs"] },
  { id: "agents", label: "AI agents", link: [docsUrl("agents"), "Agentic payments guide"] },
  {
    id: "shopify",
    label: "Shopify",
    steps: ["Connect your store in PayRouta", "Add PayRouta as a manual payment method", "Buyers pay from the order page"],
    link: [docsUrl("shopify"), "Shopify guide"],
  },
  {
    id: "woocommerce",
    label: "WooCommerce",
    steps: ["Install the PayRouta Checkout plugin", "Paste your API key and webhook secret", "Orders are marked paid once PayRouta confirms"],
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
  statuses: Record<TabId, Availability>;
  initial?: TabId;
}) {
  const [id, setId] = useState<TabId>(initial);
  const tab = tabs.find((t) => t.id === id)!;
  return (
    <div className="aa">
      <div className="aa-tabs" role="tablist" aria-label="Where to take payments">
        {tabs.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={t.id === id} className="aa-tab" onClick={() => setId(t.id)}>
            {t.label}
            {statuses[t.id] === "planned" && <span className="aa-status">Coming</span>}
          </button>
        ))}
      </div>
      <div className="aa-panel" role="tabpanel" aria-label={tab.label}>
        {tab.id === "link" ? (
          <LinkPicture origin={origin} />
        ) : tab.id === "server" ? (
          <pre className="aa-code" tabIndex={0}>
            <code>{`const checkout = await payrouta.request("POST", "checkouts", {
  reference: "order-1042",
  amount: "49.99",
  currency: "USD",
  payerCountry: "NG",
  methods: ["card", "bank-transfer"],
  returnUrl: "https://shop.example/thanks",
}, "order-1042");

redirect(checkout.checkoutPath);`}</code>
          </pre>
        ) : tab.id === "agents" ? (
          <pre className="aa-code" tabIndex={0}>
            <code>{`{
  "mcpServers": {
    "payrouta": {
      "url": "${origin}/api/mcp",
      "headers": {
        "Authorization": "Bearer pr_production_…"
      }
    }
  }
}`}</code>
          </pre>
        ) : tab.id === "html" ? (
          <pre className="aa-code" tabIndex={0}>
            <code>{`<script src="${origin}/js/v1/payrouta.js" async></script>

<button data-payrouta-checkout="/create-checkout">
  Checkout
</button>`}</code>
          </pre>
        ) : (
          <ol className="aa-steps">
            {tab.steps!.map((title, i) => (
              <li key={title}>
                <span className="dg-step">{i + 1}</span>
                <b>{title}</b>
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
