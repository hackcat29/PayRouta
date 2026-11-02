"use client";
// Which receive stablecoin payments in other tokens settle into
// (lib/intents/checkout.ts setSwapSettlement).
import { useState } from "react";
import { errorText, offline } from "@/lib/error-copy";

export function SwapSettlement({
  orgId,
  choices,
  current,
  canConfigure,
}: {
  orgId: string;
  choices: { value: string; label: string }[];
  current: string;
  canConfigure: boolean;
}) {
  const [value, setValue] = useState(current);
  const [saved, setSaved] = useState(current);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      const [network, identifier] = value.split("|");
      const r = await fetch("/api/merchant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "swap-settlement", orgId, input: value ? { network, identifier } : null }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(errorText(body, r.status));
      setSaved(value);
      setMessage("Saved");
    } catch (e) {
      setMessage(e instanceof TypeError ? offline : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Payments in other tokens</h2>
      <div className="ms-inline-form">
        <label htmlFor="swap-settlement">Settle into</label>
        <select id="swap-settlement" value={value} disabled={!canConfigure || busy} onChange={(e) => setValue(e.target.value)}>
          <option value="">First available</option>
          {choices.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        {canConfigure && (
          <button className="ms-btn primary" type="button" disabled={busy || value === saved} onClick={() => void save()}>
            Save
          </button>
        )}
      </div>
      <p role="status" className="ms-dim">
        {message}
      </p>
    </section>
  );
}
