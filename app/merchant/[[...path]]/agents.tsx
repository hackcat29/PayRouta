"use client";
// Agent keys (lib/agents/keys.ts): a key an AI agent pays with through the
// agent API, and the limits it spends within.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorText, offline } from "@/lib/error-copy";

type Key = {
  id: string;
  name: string;
  prefix: string;
  period: string;
  budgetMinor: string;
  perPaymentMinor: string;
  merchants: number;
  payer: string | null;
  spentMinor: string;
  lastUsedAt: string | null;
  revoked: boolean;
  createdAt: string;
};

const usd = (minor: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(minor) / 100);

export function AgentKeys({ orgId, environment, keys }: { orgId: string; environment: string; keys: Key[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");

  async function command(body: object) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...body }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorText(data, response.status));
      if (data?.secret) setSecret(data.secret);
      router.refresh();
    } catch (e) {
      setMessage(e instanceof TypeError ? offline : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section>
        <h2>New agent key</h2>
        <form
          className="ms-link-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setSecret("");
            void command({
              action: "agent-key-create",
              input: {
                name: f.get("name"),
                budget: String(f.get("budget") || "").replace(/[,$\s]/g, ""),
                period: f.get("period"),
                perPayment: String(f.get("perPayment") || "").replace(/[,$\s]/g, ""),
                merchants: String(f.get("merchants") || "")
                  .split(/[\s,]+/)
                  .filter(Boolean),
                ...(String(f.get("payer") || "").trim() ? { payer: String(f.get("payer")).trim() } : {}),
              },
            });
          }}
        >
          <label>
            Name
            <input name="name" required maxLength={60} placeholder="Procurement agent" />
          </label>
          <label>
            Budget (USD)
            <input name="budget" required inputMode="decimal" placeholder="500" />
          </label>
          <label>
            Budget period
            <select name="period" defaultValue="week" aria-label="Budget period">
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label>
            Most per payment (USD)
            <input name="perPayment" required inputMode="decimal" placeholder="100" />
          </label>
          <label className="ms-link-wide">
            Only these merchants (optional)
            <textarea name="merchants" rows={2} placeholder="Payment link URLs or merchant IDs, one per line" />
          </label>
          <label className="ms-link-wide">
            Only from this NEAR Intents account (optional)
            <input name="payer" autoComplete="off" spellCheck={false} placeholder="agent.near or 0x…" />
          </label>
          <button className="ms-btn primary" disabled={busy}>
            {busy ? "Creating…" : `Create ${environment === "sandbox" ? "test" : "live"} key`}
          </button>
        </form>
        {message && <p className="p-notice error">{message}</p>}
        {secret && (
          <div className="ms-secret">
            <label>
              Copy this key now. It won&apos;t be shown again.
              <textarea readOnly value={secret} rows={2} />
            </label>
            <div className="ms-secret-actions">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(secret)}>
                Copy
              </button>
              <button type="button" onClick={() => setSecret("")}>
                Hide key
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="ms-flush">
        <div className="ms-card-head">
          <h2>Agent keys</h2>
        </div>
        {keys.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Key</th>
                  <th scope="col">Spent</th>
                  <th scope="col">Per payment</th>
                  <th scope="col">Merchants</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td>
                      <code>{k.prefix}…</code>
                    </td>
                    <td>
                      {usd(k.spentMinor)} of {usd(k.budgetMinor)} / {k.period}
                    </td>
                    <td>{usd(k.perPaymentMinor)}</td>
                    <td>{k.merchants ? k.merchants : "Any"}</td>
                    <td>
                      <span className={`ms-pill ${k.revoked ? "" : "good"}`}>{k.revoked ? "Revoked" : "Active"}</span>
                    </td>
                    <td className="ms-num">
                      {!k.revoked && (
                        <button className="danger" disabled={busy} onClick={() => void command({ action: "agent-key-revoke", id: k.id })}>
                          Revoke
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
            <strong>No agent keys yet</strong>
          </div>
        )}
      </section>
    </>
  );
}
