"use client";
import { useCallback, useEffect, useState, useRef } from "react";
type Progress = {
  merchant: string;
  reference: string;
  amount: string;
  asset: { identifier: string };
  state: string;
  attemptState?: string;
  attemptId?: string;
  selectedMethod?: string;
  action?: { text: string };
  returnUrl: string;
  settlement: string[];
};
type Method = { method: string; status: string };
export function Checkout({ id }: { id: string }) {
  const [data, setData] = useState<Progress>();
  const [options, setOptions] = useState<Method[]>([]);
  const [route, setRoute] = useState<{
    routeId: string;
    payerAmount: string;
    expiresAt: string;
  }>();
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const api = useCallback(
    async (action?: object) => {
      const r = await fetch(
        `/api/checkout/${id}`,
        action
          ? {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(action),
            }
          : { cache: "no-store" },
      );
      const b = await r.json();
      if (!r.ok) throw new Error(b.error);
      return b;
    },
    [id],
  );
  const rejected = useRef<string | undefined>(undefined);
  const refresh = useCallback(async () => {
    const result = await api();
    setData(result);
    if (
      result.attemptState === "Rejected" &&
      result.attemptId !== rejected.current
    ) {
      rejected.current = result.attemptId;
      setRoute(undefined);
      setSelected(undefined);
    }
  }, [api]);
  const exchange = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    let alive = true;
    async function start() {
      try {
        const token = location.hash.slice(1);
        if (token) {
          history.replaceState(null, "", location.pathname);
          exchange.current = api({ action: "exchange", token });
        }
        if (exchange.current) await exchange.current;
        await refresh();
        const m = await api({ action: "methods" });
        if (alive) setOptions(m.methods);
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    }
    void start();
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [api, refresh]);
  async function act(action: object) {
    setBusy(true);
    setError("");
    try {
      const result = await api(action);
      await refresh();
      return result;
    } catch (e) {
      setError((e as Error).message);
      setRoute(undefined);
      setSelected(undefined);
    } finally {
      setBusy(false);
    }
  }
  const status =
    data?.state === "Confirmed"
      ? "Payment confirmed."
      : data?.attemptState === "Unknown" || data?.attemptState === "Dispatching"
        ? "Checking payment status."
        : data?.attemptState === "Requires action"
          ? "Complete your payment."
          : data?.state === "Processing"
            ? "Waiting for payment."
            : "Choose how to pay";
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#f4f6f8",
        padding: "40px 20px",
        color: "#152b38",
      }}
    >
      <div
        style={{
          maxWidth: 480,
          margin: "auto",
          background: "white",
          borderRadius: 20,
          padding: 28,
          boxShadow: "0 8px 40px #10203010",
        }}
      >
        <p style={{ fontWeight: 750, color: "#006e68" }}>PayRouta</p>
        <p>Sandbox · Fictional test payment</p>
        <h1 style={{ fontSize: 28, margin: "24px 0" }}>
          {data?.merchant || "Secure checkout"}
        </h1>
        {data && (
          <>
            <p>Order {data.reference}</p>
            <p
              style={{
                fontSize: 36,
                fontWeight: 700,
                overflowWrap: "anywhere",
              }}
            >
              {data.amount} {data.asset.identifier}
            </p>
          </>
        )}
        <h2 aria-live="polite" style={{ fontSize: 22, marginTop: 24 }}>
          {status}
        </h2>
        {error && (
          <p role="alert">
            {error.replaceAll("_", " ").toLowerCase()}. Refresh or return to the
            merchant for help.
          </p>
        )}
        {!data && !error && <p>Loading checkout…</p>}
        {data?.attemptState === "Rejected" && (
          <p role="status">
            Payment was not completed. Choose a method and try again.
          </p>
        )}
        {data?.state === "Open" && (
          <fieldset disabled={busy} style={{ border: 0, padding: 0 }}>
            <legend>Payment method</legend>
            {options.map((m) => (
              <label
                key={m.method}
                style={{
                  display: "block",
                  padding: 16,
                  border: "1px solid #d6dfe2",
                  borderRadius: 10,
                  margin: "10px 0",
                }}
              >
                <input
                  type="radio"
                  name="method"
                  checked={selected === m.method}
                  disabled={m.status !== "AVAILABLE"}
                  onChange={() => {
                    setSelected(m.method);
                    setRoute(undefined);
                    void act({ action: "select", method: m.method }).then(
                      (r) => r && setRoute(r),
                    );
                  }}
                />{" "}
                {m.method.replaceAll("-", " ")}
                {m.status !== "AVAILABLE" && (
                  <span>
                    {" "}
                    —{" "}
                    {m.status === "ACTION_REQUIRED"
                      ? "Verification required"
                      : "Currently unavailable"}
                  </span>
                )}
              </label>
            ))}
            {options.length === 0 && (
              <p>No payment methods available. Try again shortly.</p>
            )}
            {route && (
              <>
                <p>
                  You pay {route.payerAmount} {data.asset.identifier}. No extra
                  payer fee. Quote valid until{" "}
                  {new Date(route.expiresAt).toLocaleTimeString()}.
                </p>
                <button
                  style={button}
                  onClick={() =>
                    void act({ action: "confirm", routeId: route.routeId })
                  }
                >
                  Confirm payment
                </button>
              </>
            )}
            <button
              style={{ ...button, background: "#e8eeee", color: "#123" }}
              onClick={() =>
                void act({ action: "methods" }).then((r) => {
                  if (r) {
                    setOptions(r.methods);
                    setRoute(undefined);
                    setSelected(undefined);
                  }
                })
              }
            >
              Refresh methods
            </button>
          </fieldset>
        )}
        {data?.attemptState === "Requires action" && (
          <>
            <p>{data.action?.text}</p>
            <button
              disabled={busy}
              style={button}
              onClick={() => void act({ action: "complete" })}
            >
              Complete sandbox action
            </button>
          </>
        )}
        {data?.state === "Confirmed" && (
          <p>
            {data.settlement.includes("Completed")
              ? "Merchant settlement completed."
              : "Settlement pending. Your payment is confirmed."}
          </p>
        )}
        {data && (
          <a
            href={data.returnUrl}
            style={{ display: "inline-block", marginTop: 24 }}
          >
            Return to merchant
          </a>
        )}
      </div>
    </div>
  );
}
const button = {
  display: "block",
  width: "100%",
  padding: 14,
  border: 0,
  borderRadius: 10,
  marginTop: 14,
  background: "#006e68",
  color: "white",
  fontSize: 16,
  cursor: "pointer",
};
