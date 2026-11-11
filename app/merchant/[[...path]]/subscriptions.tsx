"use client";
// Subscriptions: plans (a price per period, usage meters, or both) and the
// customers on them. Each period the customer gets an invoice to pay from
// any wallet (lib/subscriptions).
import { confirmAction } from "@/components/portal/confirm-dialog";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { errorText, offline } from "@/lib/error-copy";

type Meter = { key: string; name: string; unitAmount: string; includedUnits: string };
type Plan = {
  id: string;
  name: string;
  amount: string;
  currency: string;
  interval: string;
  intervalCount: number;
  meters: Meter[];
  methods: string[];
  crypto: boolean;
  active: boolean;
};
type Invoice = {
  id: string;
  number: number;
  amount: string;
  currency: string;
  state: string;
  periodStart: string;
  periodEnd: string;
  dueAt: string;
  url: string;
  lines: { description: string; quantity: string; amount: string }[];
};
type Sub = {
  id: string;
  state: string;
  plan: { id: string; name: string; amount: string; currency: string; interval: string; intervalCount: number };
  customer: { email: string; name: string | null };
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  latestInvoice: Invoice | null;
};
type Detail = Sub & { invoices: Invoice[]; usageThisPeriod: { meter: string; name: string; quantity: string; records: number }[] };

const methodOptions: [string, string][] = [
  ["card", "Card"],
  ["digital-wallet", "Digital wallets"],
  ["bank-transfer", "Bank transfer"],
  ["mobile-money", "Mobile money"],
  ["ussd", "USSD"],
];

export function money(amount: string, currency: string) {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 8 }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const every = (interval: string, count: number) => (count === 1 ? interval : `${count} ${interval}s`);
const stateTone: Record<string, string> = { Active: "good", Incomplete: "", PastDue: "warn", Canceled: "", Open: "", Paid: "good", Void: "" };
export const stateLabel: Record<string, string> = { PastDue: "Past due" };

export function StatePill({ state }: { state: string }) {
  return <span className={`ms-pill ${stateTone[state] ?? ""}`}>{stateLabel[state] ?? state}</span>;
}

function useCommand(orgId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
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
      return body ?? {};
    } catch {
      setMessage(offline);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { send, busy, message };
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ms-btn"
      onClick={() =>
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setDone(true))
          .catch(() => setDone(false))
      }
    >
      {done ? "Copied" : "Copy pay link"}
    </button>
  );
}

export function Subscriptions({
  orgId,
  plans,
  subscriptions,
  canManage,
  methodsOn,
  cryptoReady,
  localCurrency,
  activateHref,
  detailBase,
  query,
}: {
  orgId: string;
  plans: Plan[];
  subscriptions: Sub[];
  canManage: boolean;
  methodsOn: string[];
  cryptoReady: boolean;
  localCurrency: string;
  activateHref: string;
  detailBase: string;
  query: string;
}) {
  const detailHref = (id: string) => `${detailBase}${id}${query}`;
  const { send, busy, message } = useCommand(orgId);
  const activePlans = plans.filter((p) => p.active);
  const [planOpen, setPlanOpen] = useState(plans.length === 0);
  const [subOpen, setSubOpen] = useState(false);
  const [meters, setMeters] = useState(0);
  const [created, setCreated] = useState<Sub | null>(null);
  const nothingOn = !methodsOn.length && !cryptoReady;

  return (
    <>
      {canManage && nothingOn && (
        <section className="ms-callout">
          <h2>Turn on a way to pay</h2>
          <Link className="ms-btn primary" href={activateHref}>
            Activate payments
          </Link>
        </section>
      )}

      {canManage && subOpen && activePlans.length > 0 && (
        <section>
          <div className="ms-card-head">
            <h2>New subscription</h2>
            <button type="button" className="ms-btn" onClick={() => setSubOpen(false)}>
              Cancel
            </button>
          </div>
          <form
            className="ms-link-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const formEl = event.currentTarget;
              const f = new FormData(formEl);
              const sub = await send({
                action: "subscription-create",
                input: {
                  plan: f.get("plan"),
                  customer: {
                    email: String(f.get("email") || "").trim(),
                    ...(String(f.get("name") || "").trim() ? { name: String(f.get("name")).trim() } : {}),
                  },
                },
              });
              if (sub) {
                setCreated(sub as Sub);
                formEl.reset();
              }
            }}
          >
            <label>
              Customer email
              <input name="email" type="email" required maxLength={200} />
            </label>
            <label>
              Customer name (optional)
              <input name="name" maxLength={120} />
            </label>
            <label className="ms-link-wide">
              Plan
              <select name="plan" required>
                {activePlans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {money(p.amount, p.currency)} / {every(p.interval, p.intervalCount)}
                  </option>
                ))}
              </select>
            </label>
            <button className="ms-btn primary" disabled={busy}>
              {busy ? "Subscribing…" : "Subscribe"}
            </button>
          </form>
          {message && <p className="p-notice error">{message}</p>}
          {created?.latestInvoice && (
            <div className="ms-link-created" role="status">
              <span>
                First invoice for <strong>{created.customer.email}</strong>: {money(created.latestInvoice.amount, created.latestInvoice.currency)}
              </span>
              <Copy text={created.latestInvoice.url} />
              <a
                className="ms-btn"
                href={`https://wa.me/?text=${encodeURIComponent(created.latestInvoice.url)}`}
                target="_blank"
                rel="noreferrer"
              >
                Share on WhatsApp
              </a>
            </div>
          )}
        </section>
      )}

      <section className="ms-flush">
        <div className="ms-card-head">
          <h2>Subscriptions</h2>
          {canManage && !nothingOn && activePlans.length > 0 && !subOpen && (
            <button type="button" className="ms-btn primary" onClick={() => setSubOpen(true)}>
              New subscription
            </button>
          )}
        </div>
        {subscriptions.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Status</th>
                  <th scope="col">Renews</th>
                  <th scope="col" className="ms-num">
                    Latest invoice
                  </th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link className="ms-rowlink" href={detailHref(s.id)}>
                        {s.customer.name ?? s.customer.email}
                      </Link>
                    </td>
                    <td>{s.plan.name}</td>
                    <td>
                      <StatePill state={s.state} />
                    </td>
                    <td className="ms-dim">{s.state === "Canceled" ? "—" : day(s.currentPeriodEnd)}</td>
                    <td className="ms-num">
                      {s.latestInvoice ? (
                        <>
                          {money(s.latestInvoice.amount, s.latestInvoice.currency)} <StatePill state={s.latestInvoice.state} />
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ms-empty">
            <strong>No subscriptions yet</strong>
          </div>
        )}
      </section>

      {canManage && planOpen && !nothingOn && (
        <section>
          <div className="ms-card-head">
            <h2>New plan</h2>
            {plans.length > 0 && (
              <button type="button" className="ms-btn" onClick={() => setPlanOpen(false)}>
                Cancel
              </button>
            )}
          </div>
          <form
            className="ms-link-form"
            onSubmit={async (event) => {
              event.preventDefault();
              const formEl = event.currentTarget;
              const f = new FormData(formEl);
              const amount = String(f.get("amount") || "0").replace(/[,\s]/g, "") || "0";
              const plan = await send({
                action: "subscription-plan",
                input: {
                  name: f.get("name"),
                  amount,
                  currency: f.get("currency"),
                  interval: f.get("interval"),
                  methods: f.getAll("methods"),
                  crypto: f.get("crypto") === "on",
                  meters: Array.from({ length: meters }, (_, i) => ({
                    key:
                      String(f.get(`meter${i}Name`) || "")
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "_")
                        .replace(/^_+|_+$/g, "")
                        .replace(/^(\d)/, "m_$1")
                        .slice(0, 40) || `meter_${i + 1}`,
                    name: String(f.get(`meter${i}Name`) || "").trim(),
                    unitAmount: String(f.get(`meter${i}Price`) || "").trim(),
                    includedUnits: String(f.get(`meter${i}Included`) || "0").trim() || "0",
                  })),
                },
              });
              if (plan) {
                formEl.reset();
                setMeters(0);
                setPlanOpen(false);
              }
            }}
          >
            <label className="ms-link-wide">
              Plan name
              <input name="name" required maxLength={80} placeholder="Pro" />
            </label>
            <label>
              Price per period
              <input name="amount" inputMode="decimal" placeholder="20.00" />
            </label>
            <label>
              Every
              <select name="interval" defaultValue="month">
                <option value="day">Day</option>
                <option value="week">Week</option>
                <option value="month">Month</option>
                <option value="year">Year</option>
              </select>
            </label>
            <label>
              Currency
              <select name="currency" defaultValue="USD">
                <option value="USD">USD</option>
                {localCurrency !== "USD" && <option value={localCurrency}>{localCurrency}</option>}
              </select>
            </label>
            <fieldset className="ms-link-wide">
              <legend>Ways to pay</legend>
              <label className={`ms-check ${cryptoReady ? "" : "ms-check-off"}`}>
                <input type="checkbox" name="crypto" defaultChecked={cryptoReady} disabled={!cryptoReady} /> Stablecoins and any token
              </label>
              {methodOptions.map(([id, label]) => {
                const on = methodsOn.includes(id);
                return (
                  <label key={id} className={`ms-check ${on ? "" : "ms-check-off"}`}>
                    <input type="checkbox" name="methods" value={id} disabled={!on} /> {label}
                  </label>
                );
              })}
            </fieldset>
            {Array.from({ length: meters }, (_, i) => (
              <fieldset key={i} className="ms-link-wide ms-meter">
                <legend>Usage meter {i + 1}</legend>
                <label>
                  What you count
                  <input name={`meter${i}Name`} required maxLength={60} placeholder="API calls" />
                </label>
                <label>
                  Price per unit
                  <input name={`meter${i}Price`} required inputMode="decimal" placeholder="0.002" />
                </label>
                <label>
                  Included each period
                  <input name={`meter${i}Included`} inputMode="decimal" placeholder="0" />
                </label>
              </fieldset>
            ))}
            <div className="ms-link-wide ms-link-actions" style={{ justifyContent: "flex-start" }}>
              {meters < 10 && (
                <button type="button" className="ms-btn" onClick={() => setMeters((n) => n + 1)}>
                  Add usage meter
                </button>
              )}
              <button className="ms-btn primary" disabled={busy}>
                {busy ? "Creating…" : "Create plan"}
              </button>
            </div>
          </form>
          {message && <p className="p-notice error">{message}</p>}
        </section>
      )}

      <section className="ms-flush">
        <div className="ms-card-head">
          <h2>Plans</h2>
          {canManage && !nothingOn && !planOpen && (
            <button type="button" className="ms-btn" onClick={() => setPlanOpen(true)}>
              New plan
            </button>
          )}
        </div>
        {plans.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Plan</th>
                  <th scope="col">Price</th>
                  <th scope="col">Usage</th>
                  <th scope="col">Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                    </td>
                    <td className="ms-amount">
                      {money(p.amount, p.currency)} / {every(p.interval, p.intervalCount)}
                    </td>
                    <td className="ms-dim">
                      {p.meters.length
                        ? p.meters.map((m) => `${money(m.unitAmount, p.currency)} per ${m.name} (${m.key})`).join(" · ")
                        : "—"}
                    </td>
                    <td>
                      <span className={`ms-pill ${p.active ? "good" : ""}`}>{p.active ? "On" : "Off"}</span>
                    </td>
                    <td className="ms-link-actions">
                      {canManage && (
                        <button
                          type="button"
                          className="ms-btn"
                          disabled={busy}
                          onClick={() => void send({ action: "subscription-plan-active", id: p.id, input: !p.active })}
                        >
                          {p.active ? "Turn off" : "Turn on"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ms-empty">
            <strong>No plans yet</strong>
          </div>
        )}
      </section>
    </>
  );
}

export function SubscriptionDetail({
  orgId,
  sub,
  canManage,
  test,
  meters,
}: {
  orgId: string;
  sub: Detail;
  canManage: boolean;
  test: boolean;
  meters: Meter[];
}) {
  const { send, busy, message } = useCommand(orgId);
  const live = sub.state !== "Canceled";
  const open = sub.invoices.find((i) => i.state === "Open");
  return (
    <>
      <section>
        <div className="ms-detail-head">
          <strong>
            {money(sub.plan.amount, sub.plan.currency)}
            <small>/ {every(sub.plan.interval, sub.plan.intervalCount)}</small>
          </strong>
          <StatePill state={sub.state} />
          {sub.cancelAtPeriodEnd && live && <span className="ms-pill">Ends {day(sub.currentPeriodEnd)}</span>}
        </div>
        <dl className="ms-props" style={{ marginTop: 18 }}>
          <dt>Customer</dt>
          <dd>
            {sub.customer.name ? `${sub.customer.name} · ` : ""}
            {sub.customer.email}
          </dd>
          <dt>Plan</dt>
          <dd>{sub.plan.name}</dd>
          {live && (
            <>
              <dt>Current period</dt>
              <dd>
                {day(sub.currentPeriodStart)} – {day(sub.currentPeriodEnd)}
              </dd>
            </>
          )}
          <dt>Subscription ID</dt>
          <dd>
            <code>{sub.id}</code>
          </dd>
        </dl>
        {canManage && live && (
          <div className="ms-link-actions" style={{ justifyContent: "flex-start", marginTop: 18 }}>
            {open && <Copy text={open.url} />}
            {test && (
              <button type="button" className="ms-btn" disabled={busy} onClick={() => void send({ action: "subscription-advance", id: sub.id })}>
                Advance to next period
              </button>
            )}
            {!sub.cancelAtPeriodEnd && (
              <button
                type="button"
                className="ms-btn"
                disabled={busy}
                onClick={() => void send({ action: "subscription-cancel", id: sub.id, input: { atPeriodEnd: true } })}
              >
                Cancel at period end
              </button>
            )}
            <button
              type="button"
              className="ms-btn danger"
              disabled={busy}
              onClick={() =>
                void confirmAction({
                  title: "Cancel this subscription now?",
                  body: "Usage so far is invoiced; unpaid invoices are voided.",
                  confirm: "Cancel subscription",
                  cancel: "Keep it",
                  danger: true,
                }).then((ok) => ok && send({ action: "subscription-cancel", id: sub.id, input: { atPeriodEnd: false } }))
              }
            >
              Cancel now
            </button>
          </div>
        )}
        {message && <p className="p-notice error">{message}</p>}
      </section>

      {meters.length > 0 && (
        <section className="ms-flush">
          <div className="ms-card-head">
            <h2>Usage this period</h2>
          </div>
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Meter</th>
                  <th scope="col" className="ms-num">
                    Quantity
                  </th>
                  <th scope="col" className="ms-num">
                    Price per unit
                  </th>
                </tr>
              </thead>
              <tbody>
                {meters.map((m) => (
                  <tr key={m.key}>
                    <td>
                      {m.name} <code>{m.key}</code>
                    </td>
                    <td className="ms-num">{sub.usageThisPeriod.find((u) => u.meter === m.key)?.quantity ?? "0"}</td>
                    <td className="ms-num ms-dim">
                      {money(m.unitAmount, sub.plan.currency)}
                      {m.includedUnits !== "0" && ` after ${m.includedUnits}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canManage && live && (
            <form
              className="ms-inline ms-flush-form"
              onSubmit={async (event) => {
                event.preventDefault();
                const formEl = event.currentTarget;
                const f = new FormData(formEl);
                const done = await send({
                  action: "subscription-usage",
                  id: sub.id,
                  input: { meter: f.get("meter"), quantity: String(f.get("quantity") || "").trim() },
                });
                if (done) formEl.reset();
              }}
            >
              <label>
                Meter
                <select name="meter">
                  {meters.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Quantity
                <input name="quantity" required inputMode="decimal" placeholder="100" />
              </label>
              <button disabled={busy}>Record usage</button>
            </form>
          )}
        </section>
      )}

      <section className="ms-flush">
        <div className="ms-card-head">
          <h2>Invoices</h2>
        </div>
        {sub.invoices.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Invoice</th>
                  <th scope="col" className="ms-num">
                    Amount
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Period</th>
                  <th scope="col">Due</th>
                </tr>
              </thead>
              <tbody>
                {sub.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <a className="ms-rowlink" href={i.url} target="_blank" rel="noreferrer">
                        #{i.number}
                      </a>
                    </td>
                    <td className="ms-num ms-amount">{money(i.amount, i.currency)}</td>
                    <td>
                      <StatePill state={i.state} />
                    </td>
                    <td className="ms-dim">
                      {day(i.periodStart)} – {day(i.periodEnd)}
                    </td>
                    <td className="ms-dim">{i.state === "Open" ? day(i.dueAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="ms-empty">
            <strong>No invoices yet</strong>
          </div>
        )}
      </section>
    </>
  );
}
