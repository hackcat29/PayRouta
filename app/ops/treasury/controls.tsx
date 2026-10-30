"use client";
// Operations controls for the aggregator: underwriting decisions, sub-account
// opening, PayRouta companies and platform accounts, reconciliation re-runs.
// All actions require an Operations admin with a recent authenticator check.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { currencyExponent } from "@/lib/partners/money";

function useCommand() {
  const router = useRouter();
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(body: Record<string, unknown>, done = "Saved.") {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/treasury", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage({ text: String(data.error || "Request failed"), error: true });
        return null;
      }
      setMessage({ text: done, error: false });
      router.refresh();
      return data;
    } catch {
      setMessage({ text: "Request unavailable", error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, message, setMessage };
}

function Note({ message }: { message: { text: string; error: boolean } | null }) {
  if (!message) return null;
  return (
    <p role={message.error ? "alert" : "status"} className={`ot-note ${message.error ? "error" : ""}`}>
      {message.text}
    </p>
  );
}

const verbs: Record<string, string> = {
  Underwriting: "Start review",
  Returned: "Return to merchant",
  Restricted: "Restrict",
  Live: "Reinstate",
  Offboarding: "Start offboarding",
  Closed: "Close account",
};

// Transitions other than approval: each needs a recorded reason.
export function TransitionControls({
  orgId,
  environment,
  version,
  targets,
}: {
  orgId: string;
  environment: string;
  version: number;
  targets: string[];
}) {
  const { run, busy, message } = useCommand();
  const [reason, setReason] = useState("");
  if (!targets.length) return null;
  return (
    <div className="ot-box">
      <label>
        Reason for the merchant
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="At least 10 characters" />
      </label>
      <div className="ot-actions">
        {targets.map((to) => (
          <button
            key={to}
            className={["Restricted", "Closed"].includes(to) ? "ot-danger" : to === "Returned" ? "ot-secondary" : undefined}
            disabled={busy || reason.trim().length < 10}
            onClick={() =>
              void run(
                { action: "merchant-account-transition", orgId, environment, expectedVersion: version, to, reason },
                `Moved to ${to}.`,
              )
            }
          >
            {verbs[to] ?? to}
          </button>
        ))}
      </div>
      <Note message={message} />
    </div>
  );
}

const tierReserve: Record<string, number> = { low: 0, standard: 0, elevated: 5, high: 10 };

export function ApproveForm({
  orgId,
  environment,
  version,
  entities,
  currency,
}: {
  orgId: string;
  environment: string;
  version: number;
  entities: { id: string; name: string }[];
  currency: string;
}) {
  const { run, busy, message, setMessage } = useCommand();
  const [tier, setTier] = useState("standard");
  const [blockers, setBlockers] = useState<string[] | null>(null);
  function decision(f: FormData) {
    const pct = Number(f.get("reservePct") || 0);
    const days = Number(f.get("holdDays") || 0);
    const exp = currencyExponent(String(f.get("limitCurrency")).toUpperCase()) ?? 2;
    const minor = (v: FormDataEntryValue | null) => String(Math.round(Number(v || 0) * 10 ** exp));
    return {
      legalEntityId: String(f.get("legalEntityId")),
      riskTier: tier,
      terms: {
        reserve: { basisPoints: Math.round(pct * 100), holdDays: pct > 0 ? days : 0 },
        payout: { schedule: String(f.get("schedule")), delayDays: Number(f.get("delayDays") || 0) },
        taxMode: "merchant-seller",
        limits: {
          currency: String(f.get("limitCurrency")).toUpperCase(),
          maximumMinor: minor(f.get("maximum")),
          dailyMaximumMinor: minor(f.get("dailyMaximum")),
        },
      },
    };
  }
  return (
    <form
      className="ot-box"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const reason = String(f.get("reason") || "");
        void run(
          { action: "merchant-account-transition", orgId, environment, expectedVersion: version, to: "Live", reason, decision: decision(f) },
          "Approved. The merchant is live.",
        );
      }}
    >
      <div className="ot-grid">
        <label>
          PayRouta company
          <select name="legalEntityId" required>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Risk tier
          <select value={tier} onChange={(e) => setTier(e.target.value)}>
            <option value="low">Low</option>
            <option value="standard">Standard</option>
            <option value="elevated">Elevated (reserve ≥ 5%)</option>
            <option value="high">High (reserve ≥ 10%)</option>
          </select>
        </label>
        <label>
          Rolling reserve %
          <input name="reservePct" type="number" min={0} max={50} step={0.5} defaultValue={tierReserve[tier]} key={tier} />
        </label>
        <label>
          Reserve hold (days)
          <input name="holdDays" type="number" min={0} max={180} defaultValue={90} />
        </label>
        <label>
          Payout schedule
          <select name="schedule" defaultValue="daily">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly (Mondays)</option>
            <option value="monthly">Monthly (1st)</option>
            <option value="manual">On request</option>
          </select>
        </label>
        <label>
          Payout delay (days)
          <input name="delayDays" type="number" min={0} max={30} defaultValue={2} />
        </label>
        <label>
          Limit currency
          <input name="limitCurrency" defaultValue={currency} maxLength={3} required />
        </label>
        <label>
          Max per payment
          <input name="maximum" type="number" min={1} step="0.01" defaultValue={5000} required />
        </label>
        <label>
          Max per day
          <input name="dailyMaximum" type="number" min={1} step="0.01" defaultValue={50000} required />
        </label>
      </div>
      <label>
        Decision note
        <textarea name="reason" rows={2} minLength={10} required />
      </label>
      {blockers && (
        <div className={`ot-blockers ${blockers.length ? "" : "clear"}`}>
          {blockers.length ? (
            <>
              <strong>Not ready to approve:</strong>
              <ul>
                {blockers.map((b) => (
                  <li key={b}>{b.replace(/_/g, " ").toLowerCase()}</li>
                ))}
              </ul>
            </>
          ) : (
            <strong>All checks pass.</strong>
          )}
        </div>
      )}
      <div className="ot-actions">
        <button
          type="button"
          className="ot-secondary"
          disabled={busy}
          onClick={(e) => {
            const f = new FormData(e.currentTarget.form!);
            setMessage(null);
            void run({ action: "merchant-account-preview", orgId, environment, decision: decision(f) }, "Checked.").then(
              (r) => r && setBlockers(r.blockers),
            );
          }}
        >
          Check readiness
        </button>
        <button disabled={busy}>Approve and go live</button>
      </div>
      <Note message={message} />
    </form>
  );
}

export function OpenSubAccount({
  orgId,
  environment,
  platforms,
  hasSubAccounts,
}: {
  orgId: string;
  environment: string;
  platforms: { id: string; label: string }[];
  hasSubAccounts: boolean;
}) {
  const { run, busy, message } = useCommand();
  const [platform, setPlatform] = useState(platforms[0]?.id ?? "");
  if (!platforms.length)
    return (
      <p className="ot-muted">
        {hasSubAccounts
          ? "No other enabled platform account covers this merchant's country."
          : "No enabled platform account covers this merchant's country."}
      </p>
    );
  return (
    <div className="ot-inline">
      <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform account">
        {platforms.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
      <button
        disabled={busy || !platform}
        onClick={() => void run({ action: "platform-link", orgId, environment, platformAccountId: platform }, "Sub-account requested; the worker opens it shortly.")}
      >
        Open sub-account
      </button>
      <Note message={message} />
    </div>
  );
}

export function RerunReconciliation({ linkId }: { linkId: string }) {
  const { run, busy, message } = useCommand();
  return (
    <span className="ot-inline">
      <button
        className="ot-secondary"
        disabled={busy}
        onClick={() => void run({ action: "reconciliation-rerun", linkId, reason: "Re-run from the operations console" }, "Reconciled.")}
      >
        Re-run
      </button>
      <Note message={message} />
    </span>
  );
}

export function EntityForm() {
  const { run, busy, message } = useCommand();
  return (
    <form
      className="ot-box"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run({
          action: "legal-entity",
          name: f.get("name"),
          jurisdiction: String(f.get("jurisdiction")).toUpperCase(),
          licensedCountries: String(f.get("licensed") || "")
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
          reason: f.get("reason"),
        });
      }}
    >
      <h3>Add a PayRouta company</h3>
      <div className="ot-grid">
        <label>
          Name
          <input name="name" required placeholder="PayRouta Global Inc." />
        </label>
        <label>
          Jurisdiction
          <input name="jurisdiction" required placeholder="US-DE" />
        </label>
        <label>
          Licensed to hold funds in
          <input name="licensed" placeholder="NG, KE (or leave empty)" />
        </label>
        <label>
          Reason
          <input name="reason" required minLength={10} />
        </label>
      </div>
      <div className="ot-actions">
        <button disabled={busy}>Add company</button>
      </div>
      <Note message={message} />
    </form>
  );
}

export function PlatformForm({
  entities,
  providers,
}: {
  entities: { id: string; name: string }[];
  providers: { id: string; name: string; custody: string }[];
}) {
  const { run, busy, message } = useCommand();
  const [secrets, setSecrets] = useState(1);
  return (
    <form
      className="ot-box"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        let config: Record<string, unknown> = {};
        try {
          config = JSON.parse(String(f.get("config") || "{}"));
        } catch {
          return;
        }
        const values: Record<string, string> = {};
        for (let i = 0; i < secrets; i++) {
          const name = String(f.get(`secretName${i}`) || "").trim();
          const value = String(f.get(`secretValue${i}`) || "");
          if (name && value) values[name] = value;
        }
        const provider = providers.find((p) => p.id === f.get("provider"));
        void run({
          action: "platform-account",
          legalEntityId: f.get("legalEntityId"),
          provider: f.get("provider"),
          environment: f.get("environment"),
          custody: provider?.custody,
          merchantCountries: String(f.get("countries"))
            .split(",")
            .map((c) => c.trim().toUpperCase())
            .filter(Boolean),
          config,
          secrets: values,
          enabled: f.get("enabled") === "on",
          reason: f.get("reason"),
        });
      }}
    >
      <h3>Configure a platform account</h3>
      <div className="ot-grid">
        <label>
          Company
          <select name="legalEntityId">
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Provider
          <select name="provider">
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.custody})
              </option>
            ))}
          </select>
        </label>
        <label>
          Environment
          <select name="environment">
            <option value="sandbox">Sandbox</option>
            <option value="production">Production</option>
          </select>
        </label>
        <label>
          Merchant countries
          <input name="countries" required placeholder="US, GB" />
        </label>
      </div>
      <label>
        Non-secret configuration (JSON)
        <textarea name="config" rows={3} defaultValue="{}" />
      </label>
      {Array.from({ length: secrets }, (_, i) => (
        <div className="ot-grid" key={i}>
          <label>
            Secret setting name
            <input name={`secretName${i}`} placeholder="secretKeyRef" />
          </label>
          <label>
            Secret value
            <input name={`secretValue${i}`} type="password" autoComplete="off" />
          </label>
        </div>
      ))}
      <button type="button" className="ot-secondary" onClick={() => setSecrets(secrets + 1)}>
        Add another secret
      </button>
      <div className="ot-grid">
        <label className="ot-check">
          <input type="checkbox" name="enabled" /> Enabled
        </label>
        <label>
          Reason
          <input name="reason" required minLength={10} />
        </label>
      </div>
      <div className="ot-actions">
        <button disabled={busy}>Save platform account</button>
      </div>
      <Note message={message} />
    </form>
  );
}

export function QualifyPlatform({ platformAccountId }: { platformAccountId: string }) {
  const { run, busy, message } = useCommand();
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button className="ot-secondary" onClick={() => setOpen(true)}>
        Record qualification
      </button>
    );
  return (
    <form
      className="ot-box"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void run({
          action: "platform-account-qualify",
          platformAccountId,
          evidence: {
            onboarding: f.get("onboarding"),
            payment: f.get("payment"),
            payout: f.get("payout"),
            reconciliation: f.get("reconciliation"),
          },
          reason: f.get("reason"),
        });
      }}
    >
      {["onboarding", "payment", "payout", "reconciliation", "reason"].map((k) => (
        <label key={k}>
          {k === "reason" ? "Reason" : `Sandbox evidence: ${k}`}
          <input name={k} required minLength={10} />
        </label>
      ))}
      <div className="ot-actions">
        <button disabled={busy}>Mark sandbox qualified</button>
      </div>
      <Note message={message} />
    </form>
  );
}
