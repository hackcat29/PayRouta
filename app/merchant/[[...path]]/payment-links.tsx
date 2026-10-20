"use client";
// Payment links: get paid without a website. Create a link, share it
// anywhere; every customer who opens it gets their own checkout.
import { useState } from "react";
import { useRouter } from "next/navigation";

type Link = {
  id: string;
  slug: string;
  title: string;
  amount: string;
  currency: string;
  methods: string[];
  crypto: boolean;
  active: boolean;
  checkouts: number;
  created: string;
};

const methodOptions: [string, string][] = [
  ["card", "Card"],
  ["digital-wallet", "Digital wallets"],
  ["bank-transfer", "Bank transfer"],
  ["mobile-money", "Mobile money"],
  ["ussd", "USSD"],
  ["bnpl", "Pay with credit"],
];

function money(amount: string, currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

const errors: Record<string, string> = {
  PAYMENT_LINK_CRYPTO_REQUIRES_USD: "Stablecoins are offered on USD links only.",
  PAYMENT_LINK_CRYPTO_NOT_CONFIGURED: "Add stablecoin receive addresses under Payment methods first.",
  INVALID_AMOUNT: "Check the amount: it has more decimal places than the currency allows, or is zero.",
  UNSUPPORTED_CURRENCY: "That currency isn't supported.",
  MERCHANT_ACCESS_DENIED: "An owner or admin can create payment links.",
  PAYMENT_LINK_METHOD_NOT_ON: "One of those ways to pay isn't on for your account yet. Activate payments first.",
};

export function PaymentLinks({
  orgId,
  origin,
  links,
  canManage,
  defaultCountry,
  defaultCurrency,
  methodsOn,
  cryptoReady,
}: {
  orgId: string;
  origin: string;
  links: Link[];
  canManage: boolean;
  defaultCountry: string;
  defaultCurrency: string;
  methodsOn: string[];
  cryptoReady: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState("");
  const [copied, setCopied] = useState("");

  async function send(data: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...data }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(errors[body.error] ?? "Couldn't save. Try again.");
        return null;
      }
      router.refresh();
      return body;
    } catch {
      setMessage("Couldn't save. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
    } catch {
      setCopied("");
    }
  }

  const url = (slug: string) => `${origin}/pay/${slug}`;

  return (
    <>
      {canManage && (
        <section>
          <h2>New payment link</h2>
          <p>Share it on WhatsApp, Instagram, by SMS or on an invoice. Each customer gets their own checkout.</p>
          <form
            className="ms-link-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const result = await send({
                action: "payment-link",
                input: {
                  title: form.get("title"),
                  description: form.get("description") || undefined,
                  amount: String(form.get("amount") || "").replace(/,/g, ""),
                  currency: String(form.get("currency") || "").toUpperCase(),
                  country: String(form.get("country") || "").toUpperCase(),
                  methods: form.getAll("methods"),
                  crypto: form.get("crypto") === "on",
                },
              });
              if (result?.path) setCreated(`${origin}${result.path}`);
            }}
          >
            <label>
              What it&apos;s for
              <input name="title" required maxLength={80} placeholder="Smartphone, 128 GB" />
            </label>
            <label>
              Amount
              <input name="amount" required inputMode="decimal" placeholder="150000" />
            </label>
            <label>
              Currency
              <input name="currency" required maxLength={3} defaultValue={defaultCurrency} />
            </label>
            <label>
              Customers mostly in
              <input name="country" required maxLength={2} defaultValue={defaultCountry} />
            </label>
            <label className="ms-link-wide">
              Note for the customer (optional)
              <input name="description" maxLength={240} placeholder="Delivery in Lagos within 2 days" />
            </label>
            <fieldset className="ms-link-wide">
              <legend>Ways to pay</legend>
              {methodOptions.map(([id, label]) => {
                const on = methodsOn.includes(id);
                return (
                  <label key={id} className={`ms-check ${on ? "" : "ms-check-off"}`}>
                    <input type="checkbox" name="methods" value={id} defaultChecked={on} disabled={!on} /> {label}
                    {!on && <small>after activation</small>}
                  </label>
                );
              })}
              <label className={`ms-check ${cryptoReady ? "" : "ms-check-off"}`}>
                <input type="checkbox" name="crypto" defaultChecked={cryptoReady && !methodsOn.length} disabled={!cryptoReady} />{" "}
                Stablecoins (USD links)
                {!cryptoReady && <small>add receive addresses first</small>}
              </label>
            </fieldset>
            <button className="ms-btn primary" disabled={busy}>
              {busy ? "Creating…" : "Create link"}
            </button>
          </form>
          {message && <p className="p-notice error">{message}</p>}
          {created && (
            <div className="ms-link-created" role="status">
              <code>{created}</code>
              <button type="button" className="ms-btn" onClick={() => void copy(created)}>
                {copied === created ? "Copied" : "Copy link"}
              </button>
              <a className="ms-btn" href={`https://wa.me/?text=${encodeURIComponent(created)}`} target="_blank" rel="noreferrer">
                Share on WhatsApp
              </a>
            </div>
          )}
        </section>
      )}
      <section className="ms-flush">
        <div className="ms-card-head">
          <div>
            <h2>Your links</h2>
          </div>
        </div>
        {links.length === 0 ? (
          <p className="ms-empty-line">No links yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Link</th>
                <th>Amount</th>
                <th>Checkouts</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>
                    <strong>{l.title}</strong>
                    <br />
                    <a href={url(l.slug)} target="_blank" rel="noreferrer">
                      {url(l.slug).replace(/^https?:\/\//, "")}
                    </a>
                  </td>
                  <td className="ms-amount">{money(l.amount, l.currency)}</td>
                  <td>{l.checkouts}</td>
                  <td>
                    <span className={`ms-pill ${l.active ? "good" : ""}`}>{l.active ? "On" : "Off"}</span>
                  </td>
                  <td className="ms-link-actions">
                    <button type="button" className="ms-btn" onClick={() => void copy(url(l.slug))}>
                      {copied === url(l.slug) ? "Copied" : "Copy"}
                    </button>
                    {canManage && (
                      <button
                        type="button"
                        className="ms-btn"
                        disabled={busy}
                        onClick={() => void send({ action: "payment-link-active", id: l.id, active: !l.active })}
                      >
                        {l.active ? "Turn off" : "Turn on"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
