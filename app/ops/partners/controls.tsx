"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

function useCommand() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/partners", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      setMessage(response.ok ? "Saved." : data.error || "Unable to save");
      if (response.ok) router.refresh();
    } catch {
      setMessage("Request unavailable");
    } finally {
      setBusy(false);
    }
  }
  return { run, message, busy };
}

// Secret values are sent once, stored in the secret manager and never shown
// again; only their reference names appear on this page.
export function ConnectionForm({
  partners,
}: {
  partners: { id: string; name: string; requiresPartnerApproval: boolean }[];
}) {
  const { run, message, busy } = useCommand();
  const [secrets, setSecrets] = useState(1);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        let config: unknown = {};
        try {
          config = JSON.parse(String(f.get("config") || "{}"));
        } catch {
          return;
        }
        const secretValues: Record<string, string> = {};
        for (let i = 0; i < secrets; i++) {
          const name = String(f.get(`secretName${i}`) || "").trim();
          const value = String(f.get(`secretValue${i}`) || "");
          if (name && value) secretValues[name] = value;
        }
        void run({
          action: "partner-connection",
          partnerId: f.get("partnerId"),
          environment: f.get("environment"),
          enabled: f.get("enabled") === "on",
          config,
          secrets: secretValues,
          reason: f.get("reason"),
        });
        event.currentTarget.reset();
      }}
    >
      <h3>Configure a connection</h3>
      <label>
        Partner
        <select name="partnerId" required>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.requiresPartnerApproval ? " (partner approval required)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Environment
        <select name="environment" required>
          <option value="sandbox">Sandbox</option>
          <option value="production">Production</option>
        </select>
      </label>
      <label>
        Non-secret configuration (JSON)
        <textarea name="config" defaultValue="{}" />
      </label>
      {Array.from({ length: secrets }, (_, i) => (
        <div key={i} role="group" aria-label={`Secret ${i + 1}`}>
          <label>
            Secret reference name (e.g. secretKeyRef)
            <input name={`secretName${i}`} pattern="[a-zA-Z][a-zA-Z0-9]{1,40}Ref" />
          </label>
          <label>
            Secret value
            <input name={`secretValue${i}`} type="password" autoComplete="off" />
          </label>
        </div>
      ))}
      <button type="button" onClick={() => setSecrets((n) => Math.min(n + 1, 6))}>
        Add another secret
      </button>
      <label>
        <input type="checkbox" name="enabled" /> Enabled
      </label>
      <label>
        Reason
        <input name="reason" required minLength={10} maxLength={1000} />
      </label>
      <button disabled={busy}>Save connection</button>
      <p role="status">{message}</p>
    </form>
  );
}

export function ScreeningReviewForm({
  orgId,
  profileVersion,
}: {
  orgId: string;
  profileVersion: number;
}) {
  const { run, message, busy } = useCommand();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        void run({
          action: "partner-screening-review",
          orgId,
          profileVersion,
          verdict: f.get("verdict"),
          note: f.get("note"),
        });
      }}
    >
      <label>
        Decision
        <select name="verdict" required>
          <option value="clear">Clear — continue to partners</option>
          <option value="match">Confirmed match — stop</option>
        </select>
      </label>
      <label>
        Note (kept internal)
        <textarea name="note" required minLength={10} maxLength={2000} />
      </label>
      <button disabled={busy}>Record decision</button>
      <p role="status">{message}</p>
    </form>
  );
}

export function QualifyForm({ partners }: { partners: { id: string; name: string }[] }) {
  const { run, message, busy } = useCommand();
  const steps = [
    ["onboarding", "Onboarding: account created or referred, hosted flow completed, status Approved"],
    ["accountEvents", "Account events: signed webhook received, verified and matched"],
    ["payment", "Payment: test payment created, customer redirect completed, Confirmed"],
    ["statusRecovery", "Recovery: a lost response or missed webhook resolved by status read"],
  ] as const;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        void run({
          action: "partner-qualify",
          partnerId: f.get("partnerId"),
          evidence: Object.fromEntries(steps.map(([k]) => [k, String(f.get(k) || "")])),
          reason: f.get("reason"),
        });
      }}
    >
      <h3>Record sandbox qualification</h3>
      <p>
        Only after an end-to-end run in the provider&apos;s own sandbox. Reference the test
        account, event and payment IDs for each step. Production connections cannot be enabled
        without this.
      </p>
      <label>
        Partner
        <select name="partnerId" required>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      {steps.map(([k, label]) => (
        <label key={k}>
          {label}
          <textarea name={k} required minLength={10} maxLength={1000} />
        </label>
      ))}
      <label>
        Reason
        <input name="reason" required minLength={10} maxLength={1000} />
      </label>
      <button disabled={busy}>Record qualification</button>
      <p role="status">{message}</p>
    </form>
  );
}
