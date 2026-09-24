"use client";
import { useCallback, useEffect, useState, useRef } from "react";

type Progress = {
  merchant: string;
  reference: string;
  amount: string;
  asset: { identifier: string; network?: string };
  state: string;
  attemptState?: string;
  attemptId?: string;
  selectedMethod?: string;
  action?: { text: string };
  returnUrl: string;
  settlement: string[];
};

type Method = {
  method: string;
  label?: string;
  status: string;
  explanation?: string;
};

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
  const [copied, setCopied] = useState<string | null>(null);

  // Method specific field states
  const [cardNumber, setCardNumber] = useState("");
  const [cardExpiry, setCardExpiry] = useState("");
  const [cardCvv, setCardCvv] = useState("");
  const [mobilePhone, setMobilePhone] = useState("");

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
      if (id === "demo") {
        setData({
          merchant: "Acme Global Store",
          reference: "ORD-DEMO-8942",
          amount: "25,000.00",
          asset: { identifier: "NGN" },
          state: "Open",
          returnUrl: "/merchant",
          settlement: ["NGN Bank Account"],
        });
        setOptions([
          { method: "bank_transfer", label: "Bank Transfer (Instant NIP)", status: "AVAILABLE" },
          { method: "card", label: "Card (Visa, Mastercard, Verve)", status: "AVAILABLE" },
          { method: "mobile_money", label: "Mobile Money (MTN, M-Pesa)", status: "AVAILABLE" },
          { method: "stablecoin", label: "USDC on Base (Fast Finality)", status: "AVAILABLE" },
        ]);
        setSelected("bank_transfer");
        setRoute({
          routeId: "demo-route-1",
          payerAmount: "25,000.00",
          expiresAt: new Date(Date.now() + 1800000).toISOString(),
        });
        return;
      }
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
    if (id === "demo") return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [id, api, refresh]);

  async function act(action: object) {
    setBusy(true);
    setError("");
    if (id === "demo") {
      await new Promise((r) => setTimeout(r, 600));
      const a = action as { action?: string; method?: string };
      if (a.action === "select" && a.method) {
        setSelected(a.method);
        const r = {
          routeId: `demo-route-${a.method}`,
          payerAmount: "25,000.00",
          expiresAt: new Date(Date.now() + 1800000).toISOString(),
        };
        setRoute(r);
        setBusy(false);
        return r;
      }
      if (a.action === "confirm" || a.action === "complete") {
        setData((prev) =>
          prev ? { ...prev, state: "Confirmed", attemptState: "Confirmed" } : undefined,
        );
        setBusy(false);
        return { state: "Confirmed" };
      }
      setBusy(false);
      return {};
    }
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

  function copyToClipboard(text: string, label: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2500);
    }
  }

  const activeMethod = (selected ?? data?.selectedMethod ?? "").replace(/_/g, "-");
  const isConfirmed = data?.state === "Confirmed";

  // Virtual bank account details derived deterministically from the reference
  const bankAccountNumber = data
    ? `99${Math.abs(data.reference.split("").reduce((a, b) => a + b.charCodeAt(0), 0) * 1337).toString().padStart(8, "0").slice(0, 8)}`
    : "0123456789";

  // Virtual stablecoin address
  const depositAddress = data
    ? `0x${Math.abs(data.reference.split("").reduce((a, b) => a + b.charCodeAt(0), 0) * 98765).toString(16).padStart(40, "a").slice(0, 40)}`
    : "0x0000000000000000000000000000000000000000";

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#f4f6f8",
        padding: "32px 16px",
        color: "#152b38",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 460,
          margin: "0 auto",
          background: "white",
          borderRadius: 16,
          padding: "32px 24px",
          boxShadow: "0 4px 24px rgba(0, 30, 40, 0.08)",
          border: "1px solid #e2e8ea",
        }}
      >
        {/* Header: Merchant Identity & Amount */}
        <header style={{ borderBottom: "1px solid #edf2f4", paddingBottom: 20, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <span style={{ fontWeight: 700, color: "#006e68", letterSpacing: "-0.01em", fontSize: 18 }}>
              PayRouta
            </span>
            <span style={{ fontSize: 13, background: "#edf6f5", color: "#006e68", padding: "4px 8px", borderRadius: 6, fontWeight: 500 }}>
              Secure checkout
            </span>
          </div>

          <h1 style={{ fontSize: 20, margin: "0 0 4px 0", color: "#223540", fontWeight: 600 }}>
            {data?.merchant || "Merchant Payment"}
          </h1>
          <p style={{ margin: "0 0 16px 0", color: "#62757f", fontSize: 14 }}>
            Order {data?.reference || "..."}
          </p>

          {data && (
            <div style={{ fontSize: 32, fontWeight: 750, color: "#0e1e25" }}>
              {data.amount} <span style={{ fontSize: 20, fontWeight: 600, color: "#475965" }}>{data.asset.identifier}</span>
            </div>
          )}
        </header>

        {error && (
          <div
            role="alert"
            style={{
              padding: 12,
              background: "#fef2f2",
              border: "1px solid #fee2e2",
              borderRadius: 8,
              color: "#991b1b",
              fontSize: 14,
              marginBottom: 20,
            }}
          >
            {error.replaceAll("_", " ")}. Please try again or choose another method.
          </div>
        )}

        {!data && !error && <p style={{ textAlign: "center", color: "#62757f" }}>Loading checkout details…</p>}

        {/* State: Confirmed */}
        {isConfirmed && (
          <section aria-labelledby="confirmed-heading" style={{ textAlign: "center", padding: "20px 0" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "#e6f7f4",
                color: "#008779",
                fontSize: 28,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 16px",
              }}
            >
              ✓
            </div>
            <h2 id="confirmed-heading" style={{ fontSize: 22, margin: "0 0 8px", fontWeight: 700, color: "#0f2329" }}>
              Payment completed
            </h2>
            <p style={{ color: "#475965", fontSize: 15, margin: "0 0 24px" }}>
              Thank you. Your payment of {data.amount} {data.asset.identifier} has been verified and confirmed.
            </p>
            {data.returnUrl && (
              <a
                href={data.returnUrl}
                style={{
                  ...primaryBtn,
                  display: "inline-block",
                  textDecoration: "none",
                  textAlign: "center",
                }}
              >
                Return to {data.merchant || "merchant"}
              </a>
            )}
          </section>
        )}

        {/* State: Action Required (e.g. 3DS or customer authorization) */}
        {!isConfirmed && data?.attemptState === "Requires action" && (
          <section aria-labelledby="action-heading" style={{ padding: "16px 0" }}>
            <h2 id="action-heading" style={{ fontSize: 18, marginBottom: 12, color: "#0f2329" }}>
              Action required
            </h2>
            <p style={{ color: "#475965", fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>
              {data.action?.text || "Please complete authorization with your payment provider."}
            </p>
            <button
              disabled={busy}
              style={primaryBtn}
              onClick={() => void act({ action: "complete" })}
            >
              Authorize payment
            </button>
          </section>
        )}

        {/* State: Open & Selecting Payment Method */}
        {!isConfirmed && data?.state === "Open" && (
          <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontSize: 16, fontWeight: 600, color: "#223540", marginBottom: 12 }}>
              How would you like to pay?
            </legend>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              {options.map((m) => {
                const isSelected = selected === m.method;
                const isAvailable = m.status === "AVAILABLE";
                return (
                  <label
                    key={m.method}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "14px 16px",
                      border: isSelected ? "2px solid #006e68" : "1px solid #d6dfe2",
                      borderRadius: 10,
                      background: isSelected ? "#f7fcfb" : "white",
                      cursor: isAvailable ? "pointer" : "not-allowed",
                      opacity: isAvailable ? 1 : 0.6,
                      transition: "all 0.15s ease",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <input
                        type="radio"
                        name="method"
                        checked={isSelected}
                        disabled={!isAvailable}
                        onChange={() => {
                          setSelected(m.method);
                          setRoute(undefined);
                          void act({ action: "select", method: m.method }).then(
                            (r) => r && setRoute(r),
                          );
                        }}
                        style={{ accentColor: "#006e68", width: 18, height: 18 }}
                      />
                      <span style={{ fontWeight: isSelected ? 600 : 500, color: "#152b38", fontSize: 15 }}>
                        {m.label?.trim() || m.method.replaceAll("-", " ")}
                      </span>
                    </div>
                    {!isAvailable && (
                      <span style={{ fontSize: 12, color: "#768892" }}>
                        {m.status === "ACTION_REQUIRED" ? "Verification required" : "Unavailable"}
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            {/* Method-specific Interactive Panels */}
            {route && activeMethod === "bank-transfer" && (
              <div style={methodPanel}>
                <h3 style={methodHeading}>Transfer details</h3>
                <p style={{ fontSize: 13, color: "#4f636e", margin: "0 0 16px" }}>
                  Make a transfer of the exact amount to the bank account below. The payment will confirm automatically.
                </p>

                <div style={detailRow}>
                  <span style={detailLabel}>Bank</span>
                  <strong style={detailValue}>PayRouta Transfer Bank (Wema Bank)</strong>
                </div>

                <div style={detailRow}>
                  <span style={detailLabel}>Account Number</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ ...detailValue, fontFamily: "monospace", fontSize: 16 }}>{bankAccountNumber}</strong>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(bankAccountNumber, "account")}
                      style={copyBtn}
                    >
                      {copied === "account" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                <div style={detailRow}>
                  <span style={detailLabel}>Beneficiary</span>
                  <strong style={detailValue}>{data.merchant}</strong>
                </div>

                <div style={detailRow}>
                  <span style={detailLabel}>Exact Amount</span>
                  <strong style={{ ...detailValue, color: "#006e68" }}>{route.payerAmount} {data.asset.identifier}</strong>
                </div>

                <button
                  type="button"
                  style={primaryBtn}
                  onClick={() => void act({ action: "confirm", routeId: route.routeId })}
                >
                  I have transferred {route.payerAmount} {data.asset.identifier}
                </button>
              </div>
            )}

            {route && activeMethod === "card" && (
              <div style={methodPanel}>
                <h3 style={methodHeading}>Card details</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 16 }}>
                  <div>
                    <label htmlFor="card-number" style={inputLabel}>Card number</label>
                    <input
                      id="card-number"
                      type="text"
                      inputMode="numeric"
                      placeholder="4111 2222 3333 4444"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      style={textInput}
                    />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div>
                      <label htmlFor="card-expiry" style={inputLabel}>Expiry</label>
                      <input
                        id="card-expiry"
                        type="text"
                        placeholder="MM / YY"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(e.target.value)}
                        style={textInput}
                      />
                    </div>
                    <div>
                      <label htmlFor="card-cvv" style={inputLabel}>CVV</label>
                      <input
                        id="card-cvv"
                        type="password"
                        maxLength={4}
                        placeholder="123"
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value)}
                        style={textInput}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  style={primaryBtn}
                  onClick={() => void act({ action: "confirm", routeId: route.routeId })}
                >
                  Pay {route.payerAmount} {data.asset.identifier}
                </button>
              </div>
            )}

            {route && activeMethod === "mobile-money" && (
              <div style={methodPanel}>
                <h3 style={methodHeading}>Mobile Money</h3>
                <div style={{ marginBottom: 16 }}>
                  <label htmlFor="mobile-phone" style={inputLabel}>Phone number</label>
                  <input
                    id="mobile-phone"
                    type="tel"
                    placeholder="e.g. +233 24 123 4567"
                    value={mobilePhone}
                    onChange={(e) => setMobilePhone(e.target.value)}
                    style={textInput}
                  />
                  <p style={{ fontSize: 12, color: "#62757f", marginTop: 4 }}>
                    A prompt will be sent to your phone to approve the charge.
                  </p>
                </div>

                <button
                  type="button"
                  style={primaryBtn}
                  onClick={() => void act({ action: "confirm", routeId: route.routeId })}
                >
                  Send payment prompt
                </button>
              </div>
            )}

            {route && activeMethod === "stablecoin" && (
              <div style={methodPanel}>
                <h3 style={methodHeading}>Stablecoin transfer</h3>
                <p style={{ fontSize: 13, color: "#4f636e", margin: "0 0 16px" }}>
                  Send USDC on Base. The transaction will automatically confirm once detected on-chain.
                </p>

                <div style={detailRow}>
                  <span style={detailLabel}>Network</span>
                  <strong style={detailValue}>Base (EIP-155:8453)</strong>
                </div>

                <div style={detailRow}>
                  <span style={detailLabel}>Asset</span>
                  <strong style={detailValue}>USDC</strong>
                </div>

                <div style={{ ...detailRow, flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                  <span style={detailLabel}>Deposit address</span>
                  <div style={{ display: "flex", width: "100%", gap: 8, alignItems: "center" }}>
                    <code style={{ fontSize: 12, background: "white", padding: "8px 10px", borderRadius: 6, border: "1px solid #d6dfe2", flex: 1, overflowWrap: "anywhere" }}>
                      {depositAddress}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(depositAddress, "address")}
                      style={copyBtn}
                    >
                      {copied === "address" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>

                <div style={detailRow}>
                  <span style={detailLabel}>Amount</span>
                  <strong style={{ ...detailValue, color: "#006e68" }}>{data.amount} USDC</strong>
                </div>

                <button
                  type="button"
                  style={primaryBtn}
                  onClick={() => void act({ action: "confirm", routeId: route.routeId })}
                >
                  I have sent {data.amount} USDC
                </button>
              </div>
            )}
          </fieldset>
        )}

        {/* State: Processing / Waiting */}
        {!isConfirmed && data?.state === "Processing" && (
          <section aria-labelledby="processing-heading" style={{ textAlign: "center", padding: "24px 0" }}>
            <h2 id="processing-heading" style={{ fontSize: 18, color: "#223540", marginBottom: 8 }}>
              Checking payment…
            </h2>
            <p style={{ color: "#62757f", fontSize: 14, margin: "0 0 20px" }}>
              We are waiting for provider confirmation. This page updates automatically.
            </p>
          </section>
        )}

        {data && (
          <div style={{ textAlign: "center", marginTop: 24, paddingTop: 16, borderTop: "1px solid #f0f4f5" }}>
            <a
              href={data.returnUrl}
              style={{ color: "#62757f", fontSize: 13, textDecoration: "none" }}
            >
              Cancel and return to {data.merchant || "merchant"}
            </a>
          </div>
        )}
      </div>
    </main>
  );
}

const primaryBtn: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "14px 18px",
  border: 0,
  borderRadius: 8,
  marginTop: 16,
  background: "#006e68",
  color: "white",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
  boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
};

const copyBtn: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 6,
  border: "1px solid #c2d1d6",
  background: "#f4f8f9",
  color: "#1a3b45",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const methodPanel: React.CSSProperties = {
  marginTop: 16,
  padding: 16,
  background: "#f8fbfb",
  border: "1px solid #d4e4e7",
  borderRadius: 10,
};

const methodHeading: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: "#152b38",
  margin: "0 0 8px 0",
};

const detailRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: "1px solid #e9f0f2",
  fontSize: 14,
};

const detailLabel: React.CSSProperties = {
  color: "#5f737e",
};

const detailValue: React.CSSProperties = {
  color: "#152b38",
  fontWeight: 600,
};

const inputLabel: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "#33454f",
  marginBottom: 6,
};

const textInput: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "10px 12px",
  border: "1px solid #d4dfe2",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};
