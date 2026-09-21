"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function Keys({
  orgId,
  environment,
  keys,
}: {
  orgId: string;
  environment: string;
  keys: {
    id: string;
    prefix: string;
    revokedAt: string | null;
    permissions: string[];
  }[];
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  async function command(body: unknown) {
    setBusy(true);
    setMessage("");
    setSecret("");
    try {
      const response = await fetch("/api/merchant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      if (data.secret) setSecret(data.secret);
      setMessage("Saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>API keys</h2>
      <p>
        Owner or admin access and recent authenticator verification are
        required. Store secrets only on your server.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void command({
            action: "issue-key",
            orgId,
            input: {
              environment,
              permissions:
                form.get("access") === "write"
                  ? [
                      "payments:read",
                      "payments:write",
                      "settlements:read",
                      "configuration:read",
                      "webhooks:read",
                    ]
                  : [
                      "payments:read",
                      "settlements:read",
                      "configuration:read",
                      "webhooks:read",
                    ],
            },
          });
        }}
      >
        <label>
          Access
          <select name="access">
            <option value="read">Read only</option>
            <option value="write">Create payments and checkout sessions</option>
          </select>
        </label>
        <button disabled={busy}>Create key</button>
      </form>
      <p role="status">{message}</p>
      {secret && (
        <div>
          <label>
            Copy this secret now. It will not be shown again.
            <textarea readOnly value={secret} />
          </label>
          <button onClick={() => setSecret("")}>Hide secret</button>
        </div>
      )}
      <ul>
        {keys.map((key) => (
          <li key={key.id}>
            <code>{key.prefix}…</code> —{" "}
            {key.revokedAt ? "Revoked" : key.permissions.join(", ")}
            {!key.revokedAt && (
              <button
                disabled={busy}
                onClick={() =>
                  void command({ action: "revoke-key", orgId, id: key.id })
                }
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
