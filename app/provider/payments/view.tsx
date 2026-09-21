"use client";
import { useState } from "react";
export function DemoCheckout() {
  const [scenario, setScenario] = useState("action");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const call = async (b: object) => {
        const r = await fetch("/api/payments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(b),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error);
        return result;
      };
      const asset = { kind: "fiat", identifier: "NGN", network: "" };
      const i = await call({
        action: "create",
        orgId: "payment-demo-merchant",
        key: crypto.randomUUID(),
        intent: {
          reference: `Demo ${new Date().toLocaleTimeString()}`,
          amount: "100.00",
          asset,
          precision: 2,
          methods: ["bank-transfer", "card", "mobile-money"],
          settlement: asset,
          returnUrl: location.origin + "/provider/payments",
          scenario,
        },
      });
      const s = await call({
        action: "session",
        orgId: "payment-demo-merchant",
        intentId: i.id,
      });
      location.assign(s.checkoutPath);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <>
      <label>
        Sandbox scenario{" "}
        <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
          {[
            "action",
            "success",
            "timeout",
            "fallback",
            "rejected",
            "settlement-pending",
            "fee-mismatch",
          ].map((s) => (
            <option key={s} value={s}>
              {s.replaceAll("-", " ")}
            </option>
          ))}
        </select>
      </label>
      <p>
        <button
          className="p-button"
          disabled={busy}
          onClick={() => void create()}
        >
          {busy ? "Creating order…" : "Open checkout"}
        </button>
      </p>
      <p role="alert">{error}</p>
    </>
  );
}
