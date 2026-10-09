"use client";

import React, { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/brand-logo";
import {
  CheckCircle,
  WarningCircle,
  CircleNotch,
  EnvelopeSimple,
  ShieldCheck,
  Check,
} from "@phosphor-icons/react";

interface PreferenceData {
  email: string;
  name?: string;
  status: string;
  topics: string[];
  availableTopics: { id: string; label: string }[];
}

export default function PreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; action?: string }>;
}) {
  const resolvedParams = use(searchParams);
  const token = resolvedParams.token;
  const initialAction = resolvedParams.action;

  const [loading, setLoading] = useState(Boolean(token));
  const [data, setData] = useState<PreferenceData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const error = token
    ? fetchError
    : "No preference token provided. Please use the link from your email.";
  const [topics, setTopics] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isUnsubscribed, setIsUnsubscribed] = useState(false);

  const handleUnsubscribeAll = useCallback(async (targetToken = token) => {
    if (!targetToken) return;

    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/marketing/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: targetToken,
          unsubscribeAll: true,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Unsubscribe failed");

      setIsUnsubscribed(true);
      setTopics([]);
      setFeedback("You have been unsubscribed from all PayRouta marketing emails.");
    } catch (err: unknown) {
      setFeedback(err instanceof Error ? err.message : "Error unsubscribing");
    } finally {
      setSaving(false);
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;

    fetch(`/api/marketing/preferences?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to load preferences");
        }
        return res.json();
      })
      .then((prefData: PreferenceData) => {
        setData(prefData);
        setTopics(prefData.topics || []);
        setIsUnsubscribed(prefData.status === "unsubscribed");

        // If direct action=unsub link was clicked, trigger unsubscribe immediately
        if (initialAction === "unsub" && prefData.status !== "unsubscribed") {
          handleUnsubscribeAll(token);
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        setFetchError(err.message);
        setLoading(false);
      });
  }, [token, initialAction, handleUnsubscribeAll]);

  const handleToggleTopic = (topicId: string) => {
    setTopics((prev) =>
      prev.includes(topicId)
        ? prev.filter((t) => t !== topicId)
        : [...prev, topicId],
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;

    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/marketing/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          topics,
          unsubscribeAll: false,
        }),
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Save failed");

      setIsUnsubscribed(false);
      setFeedback("Your email topic preferences have been saved.");
    } catch (err: unknown) {
      setFeedback(err instanceof Error ? err.message : "Error saving");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0B0F19",
        color: "#F8FAFC",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 16px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div style={{ marginBottom: "32px" }}>
        <Link href="/" aria-label="PayRouta Home">
          <BrandLogo reverse />
        </Link>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: "540px",
          backgroundColor: "#131B2E",
          border: "1px solid #1E293B",
          borderRadius: "16px",
          padding: "36px",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
          <EnvelopeSimple size={24} color="#38BDF8" weight="duotone" />
          <h1
            style={{
              margin: 0,
              fontSize: "22px",
              fontWeight: 700,
              color: "#FFFFFF",
              letterSpacing: "-0.5px",
            }}
          >
            Email Preferences Center
          </h1>
        </div>

        <p style={{ margin: "0 0 24px 0", color: "#94A3B8", fontSize: "14px", lineHeight: 1.5 }}>
          Manage the communications you receive from PayRouta. You can choose specific topics or unsubscribe anytime.
        </p>

        {loading ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#94A3B8" }}>
            <CircleNotch size={32} className="spin" style={{ margin: "0 auto 12px" }} />
            <p style={{ margin: 0, fontSize: "14px" }}>Loading your preferences...</p>
          </div>
        ) : error ? (
          <div
            style={{
              background: "rgba(239, 68, 68, 0.1)",
              border: "1px solid rgba(239, 68, 68, 0.25)",
              borderRadius: "8px",
              padding: "16px",
              display: "flex",
              alignItems: "flex-start",
              gap: "12px",
              color: "#EF4444",
            }}
          >
            <WarningCircle size={22} weight="fill" style={{ flexShrink: 0 }} />
            <div>
              <strong style={{ color: "#F87171" }}>Invalid Link</strong>
              <p style={{ margin: "4px 0 0 0", fontSize: "13px", color: "#FCA5A5" }}>{error}</p>
            </div>
          </div>
        ) : (
          <div>
            <div
              style={{
                background: "rgba(0, 0, 0, 0.3)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "8px",
                padding: "14px 16px",
                marginBottom: "24px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div>
                <span style={{ fontSize: "12px", color: "#94A3B8", display: "block" }}>
                  Recipient Email
                </span>
                <span style={{ fontSize: "14px", color: "#FFFFFF", fontWeight: 600 }}>
                  {data?.email}
                </span>
              </div>
              <div>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    padding: "4px 10px",
                    borderRadius: "999px",
                    background: isUnsubscribed ? "rgba(239, 68, 68, 0.15)" : "rgba(16, 185, 129, 0.15)",
                    color: isUnsubscribed ? "#EF4444" : "#10B981",
                    border: isUnsubscribed ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(16, 185, 129, 0.3)",
                  }}
                >
                  {isUnsubscribed ? "Unsubscribed" : "Subscribed"}
                </span>
              </div>
            </div>

            {feedback && (
              <div
                style={{
                  background: "rgba(16, 185, 129, 0.1)",
                  border: "1px solid rgba(16, 185, 129, 0.3)",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  marginBottom: "20px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  color: "#10B981",
                  fontSize: "13px",
                }}
              >
                <CheckCircle size={18} weight="fill" />
                <span>{feedback}</span>
              </div>
            )}

            <form onSubmit={handleSave}>
              <h2 style={{ fontSize: "15px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 12px 0" }}>
                Select topics you want to receive:
              </h2>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
                {data?.availableTopics.map((topic) => {
                  const checked = topics.includes(topic.id);
                  return (
                    <label
                      key={topic.id}
                      onClick={() => handleToggleTopic(topic.id)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "12px 14px",
                        background: checked ? "rgba(0, 82, 255, 0.1)" : "rgba(255, 255, 255, 0.02)",
                        border: checked ? "1px solid #0052FF" : "1px solid rgba(255, 255, 255, 0.08)",
                        borderRadius: "8px",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div
                        style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "4px",
                          border: checked ? "1px solid #0052FF" : "1px solid #64748B",
                          backgroundColor: checked ? "#0052FF" : "transparent",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {checked && <Check size={12} color="#FFFFFF" weight="bold" />}
                      </div>
                      <span style={{ fontSize: "14px", color: checked ? "#FFFFFF" : "#CBD5E1", fontWeight: checked ? 500 : 400 }}>
                        {topic.label}
                      </span>
                    </label>
                  );
                })}
              </div>

              <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="submit"
                  disabled={saving}
                  style={{
                    padding: "11px 24px",
                    background: "#0052FF",
                    color: "#FFFFFF",
                    border: "none",
                    borderRadius: "8px",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: saving ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {saving && <CircleNotch className="spin" size={16} />}
                  Save Topic Preferences
                </button>

                <button
                  type="button"
                  onClick={() => handleUnsubscribeAll()}
                  disabled={saving || isUnsubscribed}
                  style={{
                    padding: "11px 18px",
                    background: "transparent",
                    color: isUnsubscribed ? "#64748B" : "#EF4444",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    borderRadius: "8px",
                    fontWeight: 500,
                    fontSize: "14px",
                    cursor: saving || isUnsubscribed ? "not-allowed" : "pointer",
                  }}
                >
                  {isUnsubscribed ? "Unsubscribed from All" : "Unsubscribe from All"}
                </button>
              </div>
            </form>

            <div
              style={{
                marginTop: "32px",
                paddingTop: "20px",
                borderTop: "1px solid rgba(255, 255, 255, 0.08)",
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                color: "#64748B",
                fontSize: "12px",
                lineHeight: 1.5,
              }}
            >
              <ShieldCheck size={18} color="#94A3B8" style={{ flexShrink: 0, marginTop: "2px" }} />
              <div>
                <span>
                  <strong>Note on Essential Notices:</strong> Security alerts, account verification, and transaction receipts are non-marketing transactional messages and cannot be opted out of.
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: "32px", color: "#64748B", fontSize: "12px", textAlign: "center" }}>
        <span>&copy; {new Date().getFullYear()} PayRouta. Global Multi-Rail Routing &amp; Settlement.</span>
      </div>
    </div>
  );
}
