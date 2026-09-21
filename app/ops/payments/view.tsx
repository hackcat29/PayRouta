"use client";
import { useState } from "react";
export function PaymentOperations({
  attempts,
  exceptions,
  deliveries,
}: {
  attempts: {
    id: string;
    reference: string;
    state: string;
    provider: string;
  }[];
  exceptions: { id: string; code: string; state: string; evidence: string }[];
  deliveries: { eventId: string; state: string; attempts: number }[];
}) {
  const [message, setMessage] = useState("");
  async function command(body: object) {
    const r = await fetch("/api/payments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const b = await r.json();
    setMessage(r.ok ? "Queued. Refresh to see the result." : b.error);
  }
  return (
    <>
      <p role="status">{message}</p>
      <h2>Execution attempts</h2>
      {attempts.map((a) => (
        <p key={a.id}>
          {a.reference} · {a.provider} · {a.state}{" "}
          <button
            className="p-button"
            onClick={() =>
              void command({ action: "reconcile", attemptId: a.id })
            }
          >
            Check status
          </button>
        </p>
      ))}
      <h2>Settlement exceptions</h2>
      {exceptions.map((e) => (
        <details key={e.id}>
          <summary>
            {e.code.replaceAll("_", " ")} · {e.state}
          </summary>
          <pre style={{ whiteSpace: "pre-wrap" }}>{e.evidence}</pre>
        </details>
      ))}
      <h2>Merchant notifications</h2>
      {deliveries.map((d) => (
        <p key={d.eventId}>
          {d.eventId} · {d.state} · {d.attempts} attempts{" "}
          <button
            className="p-button"
            onClick={() =>
              void command({ action: "redeliver", eventId: d.eventId })
            }
          >
            Redeliver
          </button>
        </p>
      ))}
    </>
  );
}
