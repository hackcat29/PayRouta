"use client";

import React, { useState } from "react";
import { PaperPlaneTilt, CheckCircle, WarningCircle, CircleNotch } from "@phosphor-icons/react";

export function NewsletterSignup({
  variant = "footer",
  className = "",
}: {
  variant?: "footer" | "card" | "compact";
  className?: string;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"merchant" | "developer" | "subscriber">("merchant");
  const [topics, setTopics] = useState<string[]>([
    "product_updates",
    "weekly_digest",
    "developer_advisories",
  ]);
  const [honeypot, setHoneypot] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [showPreferences, setShowPreferences] = useState(false);

  const toggleTopic = (id: string) => {
    setTopics((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      setStatus("error");
      setMessage("Please enter a valid email address.");
      return;
    }

    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/marketing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role,
          topics,
          source: `marketing_${variant}`,
          website_url_hp: honeypot,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Subscription failed");
      }

      setStatus("success");
      setMessage(data.message || "You are subscribed! Welcome email sent.");
      setEmail("");
    } catch (err: unknown) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  };

  if (variant === "compact") {
    return (
      <form onSubmit={handleSubmit} className={`pr-subscribe-compact ${className}`}>
        <input
          type="text"
          name="website_url_hp"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
          style={{ display: "none" }}
          tabIndex={-1}
          autoComplete="off"
        />
        <div style={{ display: "flex", gap: "8px", maxWidth: "420px" }}>
          <input
            type="email"
            placeholder="developer@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={status === "loading" || status === "success"}
            required
            style={{
              flex: 1,
              padding: "10px 14px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.18)",
              borderRadius: "6px",
              color: "#fff",
              fontSize: "14px",
            }}
          />
          <button
            type="submit"
            disabled={status === "loading" || status === "success"}
            style={{
              padding: "10px 18px",
              background: "#0052FF",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontWeight: 600,
              fontSize: "14px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            {status === "loading" ? <CircleNotch className="spin" size={16} /> : "Subscribe"}
          </button>
        </div>
        {status === "success" && (
          <p style={{ color: "#10B981", fontSize: "13px", marginTop: "8px" }}>{message}</p>
        )}
        {status === "error" && (
          <p style={{ color: "#EF4444", fontSize: "13px", marginTop: "8px" }}>{message}</p>
        )}
      </form>
    );
  }

  return (
    <div
      className={`pr-newsletter-box ${className}`}
      style={{
        background: variant === "card" ? "#101827" : "rgba(255, 255, 255, 0.03)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        borderRadius: "12px",
        padding: "24px 28px",
        color: "#F8FAFC",
        maxWidth: "600px",
        margin: "0 auto",
      }}
    >
      <div style={{ marginBottom: "16px" }}>
        <h3
          style={{
            margin: "0 0 6px 0",
            fontSize: "18px",
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: "-0.3px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <PaperPlaneTilt size={20} color="#38BDF8" weight="duotone" />
          PayRouta Multi-Rail Dispatch
        </h3>
        <p style={{ margin: 0, fontSize: "14px", color: "#94A3B8", lineHeight: 1.5 }}>
          Get bi-weekly payment routing benchmarks, provider latency digests, and stablecoin settlement releases.
        </p>
      </div>

      {status === "success" ? (
        <div
          style={{
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "8px",
            padding: "16px",
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            color: "#10B981",
          }}
        >
          <CheckCircle size={22} weight="fill" style={{ flexShrink: 0, marginTop: "2px" }} />
          <div>
            <strong style={{ color: "#34D399", fontSize: "14px" }}>You are on the dispatch list!</strong>
            <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#A7F3D0" }}>{message}</p>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {/* Honeypot anti-spam */}
          <input
            type="text"
            name="website_url_hp"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
            style={{ display: "none" }}
            tabIndex={-1}
            autoComplete="off"
          />

          {/* Role selector pills */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span style={{ fontSize: "12px", color: "#94A3B8" }}>I am a:</span>
            {[
              { id: "merchant", label: "Merchant" },
              { id: "developer", label: "Developer" },
              { id: "subscriber", label: "Fintech Leader" },
            ].map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRole(r.id as typeof role)}
                style={{
                  padding: "4px 10px",
                  fontSize: "12px",
                  borderRadius: "999px",
                  border: role === r.id ? "1px solid #38BDF8" : "1px solid rgba(255,255,255,0.1)",
                  background: role === r.id ? "rgba(56, 189, 248, 0.15)" : "transparent",
                  color: role === r.id ? "#38BDF8" : "#94A3B8",
                  cursor: "pointer",
                  fontWeight: role === r.id ? 600 : 400,
                  transition: "all 0.15s ease",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={status === "loading"}
              required
              style={{
                flex: "1 1 240px",
                padding: "11px 16px",
                background: "rgba(0, 0, 0, 0.35)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "8px",
                color: "#FFFFFF",
                fontSize: "14px",
                outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={status === "loading"}
              style={{
                padding: "11px 22px",
                background: "#0052FF",
                color: "#FFFFFF",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                fontSize: "14px",
                cursor: status === "loading" ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                transition: "background 0.2s ease",
              }}
            >
              {status === "loading" ? (
                <>
                  <CircleNotch className="spin" size={16} /> Subscribing...
                </>
              ) : (
                <>Subscribe</>
              )}
            </button>
          </div>

          <div style={{ marginTop: "10px" }}>
            <button
              type="button"
              onClick={() => setShowPreferences(!showPreferences)}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "#64748B",
                fontSize: "12px",
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              {showPreferences ? "Hide topics" : "Customize topic preferences"}
            </button>

            {showPreferences && (
              <div
                style={{
                  marginTop: "10px",
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "8px",
                  fontSize: "12px",
                  color: "#CBD5E1",
                  background: "rgba(0, 0, 0, 0.25)",
                  padding: "12px",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {[
                  { id: "product_updates", label: "Product & Protocol Releases" },
                  { id: "weekly_digest", label: "Weekly Routing Digest" },
                  { id: "developer_advisories", label: "Developer & API Notes" },
                  { id: "market_insights", label: "FX & Stablecoin Yields" },
                ].map((t) => (
                  <label
                    key={t.id}
                    style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={topics.includes(t.id)}
                      onChange={() => toggleTopic(t.id)}
                    />
                    {t.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {status === "error" && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                color: "#EF4444",
                fontSize: "13px",
                marginTop: "10px",
              }}
            >
              <WarningCircle size={16} />
              <span>{message}</span>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
