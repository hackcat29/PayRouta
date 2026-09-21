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
  events: { id: string; type: string; state: string }[];
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
  return (
    <section>
      <h2>Webhook endpoint</h2>
      <p>{url || "Not configured"}</p>
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
            <button disabled={busy}>Save endpoint or rotate secret</button>
          </form>
          <button
            disabled={busy}
            onClick={() => void send({ action: "disable-webhook" })}
          >
            Disable endpoint
          </button>
          <p>
            Keep the old signing secret in your receiver during rotation. Verify
            the key ID, timestamp, event ID, and unchanged raw body.
          </p>
        </>
      )}
      <p role="status">{message}</p>
      <h3>Recent deliveries</h3>
      <ul>
        {events.map((e) => (
          <li key={e.id}>
            {e.type} · {e.state}
            {canManage && (
              <button
                disabled={busy}
                onClick={() =>
                  void send({ action: "redeliver", eventId: e.id })
                }
              >
                Redeliver {e.id}
              </button>
            )}
          </li>
        ))}
      </ul>
      {!events.length && <p>No merchant events yet.</p>}
    </section>
  );
}
