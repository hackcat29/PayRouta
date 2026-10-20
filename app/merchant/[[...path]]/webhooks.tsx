"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function WebhookControls({
  orgId,
  url,
  keyId,
  events,
  canManage,
}: {
  orgId: string;
  url: string | null;
  keyId: string;
  events: { id: string; type: string; state: string; created: string }[];
  canManage: boolean;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function send(data: Record<string, unknown>) {
    setBusy(true);
    try {
      const response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, ...data }),
      });
      const body = await response.json();
      setMessage(response.ok ? "Saved." : body.error || "Unable to save.");
      if (response.ok) router.refresh();
    } catch {
      setMessage("Unable to save.");
    } finally {
      setBusy(false);
    }
  }
  const tone = (state: string) =>
    state === "Delivered" ? "good" : state === "Failed" || state === "Dead" ? "bad" : "";
  return (
    <>
      <section>
        <div className="ms-card-head">
          <div>
            <h2>Endpoint</h2>
            <p>We send signed events here when payments change.</p>
          </div>
          <span className={`ms-pill ${url ? "good" : ""}`}>{url ? "Enabled" : "Not set up"}</span>
        </div>
        {url && (
          <p>
            <code>{url}</code>
          </p>
        )}
        {canManage && (
          <>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void send({
                  action: "webhook",
                  input: {
                    url: form.get("url"),
                    secret: form.get("secret"),
                    keyId: form.get("keyId"),
                  },
                });
                event.currentTarget.reset();
              }}
            >
              <label>
                HTTPS endpoint
                <input
                  type="url"
                  name="url"
                  required
                  placeholder="https://example.com/webhooks/payrouta"
                  defaultValue={url?.startsWith("https:") ? url : ""}
                />
              </label>
              <label>
                Signing key ID
                <input name="keyId" required defaultValue={keyId} />
              </label>
              <label>
                Signing secret (at least 32 characters)
                <input
                  type="password"
                  name="secret"
                  autoComplete="new-password"
                  minLength={32}
                  required
                />
              </label>
              <div className="tr-actions">
                <button disabled={busy}>{url ? "Save or rotate secret" : "Save endpoint"}</button>
                {url && (
                  <button
                    type="button"
                    className="danger"
                    disabled={busy}
                    onClick={() => void send({ action: "disable-webhook" })}
                  >
                    Disable endpoint
                  </button>
                )}
              </div>
            </form>
            <p>
              When rotating, keep accepting the old secret until the new one is
              live. Check the key ID, timestamp, event ID and raw body on every
              event.
            </p>
          </>
        )}
        <p role="status">{message}</p>
      </section>
      <section className="ms-flush">
        <div className="ms-card-head">
          <h2>Recent events</h2>
        </div>
        {events.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Delivery</th>
                  <th scope="col">Created (UTC)</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <code>{e.type}</code>
                    </td>
                    <td>
                      <span className={`ms-pill ${tone(e.state)}`}>{e.state}</span>
                    </td>
                    <td className="ms-dim">{e.created}</td>
                    <td className="ms-num">
                      {canManage && (
                        <button
                          disabled={busy}
                          aria-label={`Redeliver ${e.id}`}
                          onClick={() =>
                            void send({ action: "redeliver", eventId: e.id })
                          }
                        >
                          Redeliver
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
            <strong>No events yet</strong>
            <p>Events appear when payments are created or change state.</p>
          </div>
        )}
      </section>
    </>
  );
}
