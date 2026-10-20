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
    created: string;
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
  const live = keys.filter((k) => !k.revokedAt);
  return (
    <>
      <section>
        <div className="ms-card-head">
          <div>
            <h2>Create a secret key</h2>
            <p>
              Keys work in {environment === "production" ? "live mode" : "test mode"} only. Keep them on your
              server; creating one needs a recent authenticator check.
            </p>
          </div>
        </div>
        <form
          className="ms-inline"
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
          <div className="ms-secret">
            <label>
              Copy this secret now. It will not be shown again.
              <textarea readOnly value={secret} rows={2} />
            </label>
            <div className="ms-secret-actions">
              <button type="button" onClick={() => void navigator.clipboard?.writeText(secret)}>
                Copy
              </button>
              <button type="button" onClick={() => setSecret("")}>
                Hide secret
              </button>
            </div>
          </div>
        )}
      </section>
      <section className="ms-flush">
        <div className="ms-card-head">
          <h2>Your keys</h2>
          <span className="ms-dim">{live.length} active</span>
        </div>
        {keys.length ? (
          <div className="p-table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Key</th>
                  <th scope="col">Access</th>
                  <th scope="col">Created</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key.id}>
                    <td>
                      <code>{key.prefix}…</code>
                    </td>
                    <td className="ms-dim">
                      {key.permissions.includes("payments:write") ? "Create payments" : "Read only"}
                    </td>
                    <td className="ms-dim">{key.created}</td>
                    <td>
                      <span className={`ms-pill ${key.revokedAt ? "" : "good"}`}>
                        {key.revokedAt ? "Revoked" : "Active"}
                      </span>
                    </td>
                    <td className="ms-num">
                      {!key.revokedAt && (
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() =>
                            void command({ action: "revoke-key", orgId, id: key.id })
                          }
                        >
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
            <strong>No keys yet</strong>
            <p>Create a key to call the PayRouta API from your server.</p>
          </div>
        )}
      </section>
    </>
  );
}
