"use client";
// Payment links: get paid without a website. Create a link, share it
// anywhere; every customer who opens it gets their own checkout.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorText, offline } from "@/lib/error-copy";
import { countries, fiat } from "@/lib/portal/domain";

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
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

export function PaymentLinks({
  orgId,
  origin,
  links,
  canManage,
  defaultCountry,
  defaultCurrency,
  methodsOn,
  cryptoReady,
  startOpen,
}: {
  orgId: string;
  origin: string;
  links: Link[];
  canManage: boolean;
  defaultCountry: string;
  defaultCurrency: string;
  methodsOn: string[];
  cryptoReady: boolean;
  startOpen: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState("");
  const [copied, setCopied] = useState("");
  const [formOpen, setFormOpen] = useState(startOpen || links.length === 0);

  async function send(data: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...data }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setMessage(errorText(body, response.status));
        return null;
      }
      router.refresh();
      return body;
    } catch {
      setMessage(offline);
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
  const nothingOn = !methodsOn.length && !cryptoReady;
  const go = (path: string) => `/merchant/${path}?${new URLSearchParams({ orgId })}`;
  const showForm = canManage && !nothingOn && formOpen;

  return (
    <>
      {canManage && nothingOn && (
        <section className="ms-callout">
          <h2>Turn on a way to pay</h2>
          <Link className="ms-btn primary" href={go("activation")}>
            Activate payments
          </Link>
        </section>
      )}
      {showForm && (
        <section>
          <div className="ms-card-head">
            <h2>New payment link</h2>
            {links.length > 0 && (
              <button type="button" className="ms-btn" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
            )}
          </div>
          <form
            className="ms-link-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const formEl = event.currentTarget;
              const form = new FormData(formEl);
              const amount = String(form.get("amount") || "").replace(/[,\s]/g, "");
              if (!/^\d{1,13}(\.\d{1,8})?$/.test(amount) || Number(amount) === 0) {
                setMessage("Enter the amount as a number above zero, like 150000 or 49.99.");
                return;
              }
              if (!form.getAll("methods").length && form.get("crypto") !== "on") {
                setMessage("Choose at least one way to pay.");
                return;
              }
              const result = await send({
                action: "payment-link",
                input: {
                  title: form.get("title"),
                  description: form.get("description") || undefined,
                  amount,
                  currency: String(form.get("currency") || "").toUpperCase(),
                  country: String(form.get("country") || "").toUpperCase(),
                  methods: form.getAll("methods"),
                  crypto: form.get("crypto") === "on",
                },
              });
              if (result?.path) {
                setCreated(`${origin}${result.path}`);
                formEl.reset();
              }
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
              <select name="currency" required defaultValue={defaultCurrency}>
                {fiat.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Customers mostly in
              <select name="country" required defaultValue={defaultCountry}>
                {countries.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
                  </label>
                );
              })}
              <label className={`ms-check ${cryptoReady ? "" : "ms-check-off"}`}>
                <input
                  type="checkbox"
                  name="crypto"
                  defaultChecked={cryptoReady && !methodsOn.length}
                  disabled={!cryptoReady}
                />{" "}
                Stablecoins (USD links)
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
              <a
                className="ms-btn"
                href={`https://wa.me/?text=${encodeURIComponent(created)}`}
                target="_blank"
                rel="noreferrer"
              >
                Share on WhatsApp
              </a>
            </div>
          )}
        </section>
      )}
      {links.length > 0 && (
        <section className="ms-flush">
          <div className="ms-card-head">
            <h2>Your links</h2>
            {canManage && !nothingOn && !showForm && (
              <button type="button" className="ms-btn primary" onClick={() => setFormOpen(true)}>
                New link
              </button>
            )}
          </div>
          {
            <div className="p-table-wrap">
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
                            onClick={() =>
                              void send({
                                action: "payment-link-active",
                                id: l.id,
                                active: !l.active,
                              })
                            }
                          >
                            {l.active ? "Turn off" : "Turn on"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          }
        </section>
      )}
    </>
  );
}
