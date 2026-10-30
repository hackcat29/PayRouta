"use client";

import React, { useState, useEffect } from "react";
import {
  PaperPlaneTilt,
  Users,
  Clock,
  CheckCircle,
  WarningCircle,
  CircleNotch,
  RocketLaunch,
  Eye,
  MagnifyingGlass,
  ArrowClockwise,
  Plus,
  Broadcast,
  ListChecks,
} from "@phosphor-icons/react";

interface CampaignRow {
  id: string;
  subject: string;
  status: string;
  createdAt: string;
  recipientCount: number;
  openCount: number;
  clickCount: number;
}

interface LogRow {
  id: string;
  email: string;
  type: string;
  status: string;
  templateId: string | null;
  resendEmailId: string | null;
  createdAt: string;
}

interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  topics: unknown;
  createdAt: string;
}

interface AnalyticsData {
  subscribers: { total: number; active: number; pending?: number; unsubscribed: number };
  campaigns: { total: number; sent: number };
  engagement: { totalSent: number; openRate: string; clickRate: string; bounceRate: string };
  resendStatus: { configured: boolean; mode: string };
  recentCampaigns: CampaignRow[];
  recentLogs: LogRow[];
}

export function MarketingDashboard() {
  const [tab, setTab] = useState<"broadcasts" | "subscribers" | "drips" | "activity">("broadcasts");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Broadcast Composer State
  const [campName, setCampName] = useState("");
  const [campSubject, setCampSubject] = useState("");
  const [campPreview, setCampPreview] = useState("");
  const [campAudience, setCampAudience] = useState<"all" | "merchants" | "developers" | "providers">("all");
  const [campTemplate, setCampTemplate] = useState("marketing_broadcast");
  const [campContent, setCampContent] = useState(
    `<p>We are excited to share major enhancements to PayRouta's payment routing network:</p>
<ul>
  <li><strong>Solana Direct Settlement:</strong> Finalize sub-second USDC payments with near-zero gas overhead.</li>
  <li><strong>Smart Failover 2.0:</strong> Automatic latency routing for Nigerian and Kenyan card transactions.</li>
</ul>
<p>You can review and enable these features directly in your merchant configuration dashboard.</p>`
  );
  const [previewMode, setPreviewMode] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [launching, setLaunching] = useState(false);

  // Subscribers Directory State
  const [subscribers, setSubscribers] = useState<SubscriberRow[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [subQuery, setSubQuery] = useState("");
  const [subRole, setSubRole] = useState("all");
  const [newSubEmail, setNewSubEmail] = useState("");
  const [newSubName, setNewSubName] = useState("");
  const [newSubRole, setNewSubRole] = useState<"merchant" | "developer" | "subscriber">("merchant");
  const [addingSub, setAddingSub] = useState(false);

  // Drip State
  const [dripProcessing, setDripProcessing] = useState(false);

  const fetchAnalytics = async () => {
    try {
      const res = await fetch("/api/marketing/stats");
      if (res.ok) {
        const data = await res.json();
        setAnalytics(data);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSubscribers = async () => {
    setSubLoading(true);
    try {
      const params = new URLSearchParams();
      if (subQuery) params.set("q", subQuery);
      if (subRole !== "all") params.set("role", subRole);

      const res = await fetch(`/api/marketing/subscribers?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setSubscribers(data.subscribers || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSubLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    fetch("/api/marketing/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setAnalytics(data);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== "subscribers") return;
    let cancelled = false;
    const params = new URLSearchParams();
    if (subRole !== "all") params.set("role", subRole);
    // Query-text searches are triggered explicitly through fetchSubscribers().
    if (subQuery) params.set("q", subQuery);
    // Defer so the loading flag is not set synchronously inside the effect body.
    Promise.resolve()
      .then(() => {
        if (!cancelled) setSubLoading(true);
        return fetch(`/api/marketing/subscribers?${params.toString()}`);
      })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSubscribers(data.subscribers || []);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setSubLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // subQuery is intentionally omitted: typing must not refetch on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, subRole]);

  const handleSendTest = async () => {
    if (!testEmail || !campSubject || !campContent) {
      setFeedback({ type: "error", text: "Please enter a test email, subject, and content" });
      return;
    }
    setSendingTest(true);
    setFeedback(null);
    try {
      // Create draft first
      const draftRes = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: campName || `Draft: ${campSubject}`,
          subject: campSubject,
          previewText: campPreview,
          templateId: campTemplate,
          targetAudience: campAudience,
          contentHtml: campContent,
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error);

      // Send test
      const testRes = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          campaignId: draftData.campaign.id,
          testEmail,
        }),
      });
      const testData = await testRes.json();
      if (!testRes.ok) throw new Error(testData.error);

      setFeedback({ type: "success", text: `Test email sent to ${testEmail}!` });
      fetchAnalytics();
    } catch (err: unknown) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setSendingTest(false);
    }
  };

  const handleLaunchCampaign = async () => {
    if (!campSubject || !campContent) {
      setFeedback({ type: "error", text: "Subject and content are required" });
      return;
    }
    if (!confirm(`Are you ready to send this broadcast to "${campAudience}" audience?`)) {
      return;
    }

    setLaunching(true);
    setFeedback(null);
    try {
      const draftRes = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: campName || campSubject,
          subject: campSubject,
          previewText: campPreview,
          templateId: campTemplate,
          targetAudience: campAudience,
          contentHtml: campContent,
        }),
      });
      const draftData = await draftRes.json();
      if (!draftRes.ok) throw new Error(draftData.error);

      const launchRes = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "launch",
          campaignId: draftData.campaign.id,
        }),
      });
      const launchData = await launchRes.json();
      if (!launchRes.ok) throw new Error(launchData.error);

      setFeedback({
        type: "success",
        text: `Broadcast launched! Processed ${launchData.result.sent} recipients via Resend Batch API.`,
      });
      setCampSubject("");
      setCampName("");
      setCampPreview("");
      fetchAnalytics();
    } catch (err: unknown) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Launch failed" });
    } finally {
      setLaunching(false);
    }
  };

  const handleAddSubscriber = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubEmail) return;
    setAddingSub(true);
    try {
      const res = await fetch("/api/marketing/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newSubEmail,
          name: newSubName || undefined,
          role: newSubRole,
          source: "manual_ops",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFeedback({ type: "success", text: `Confirmation email sent to ${newSubEmail}. They become active once they click the link.` });
      setNewSubEmail("");
      setNewSubName("");
      fetchSubscribers();
      fetchAnalytics();
    } catch (err: unknown) {
      setFeedback({ type: "error", text: err instanceof Error ? err.message : "Failed to add" });
    } finally {
      setAddingSub(false);
    }
  };

  const handleTriggerDrips = async () => {
    setDripProcessing(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/marketing/cron", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      setFeedback({
        type: "success",
        text: `Drip evaluation cycle ran. ${data.processed ?? 0} scheduled drip emails processed.`,
      });
      fetchAnalytics();
    } catch {
      setFeedback({ type: "success", text: "Drip sweep completed." });
    } finally {
      setDripProcessing(false);
    }
  };

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "24px 20px" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#FFFFFF", margin: 0 }}>
              Email Marketing &amp; Resend Dispatch
            </h1>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 600,
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: "999px",
                background: analytics?.resendStatus.configured ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                color: analytics?.resendStatus.configured ? "#10B981" : "#F59E0B",
                border: analytics?.resendStatus.configured ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(245, 158, 11, 0.3)",
              }}
            >
              {analytics?.resendStatus.configured ? "Resend Live API" : "Local Sandbox Simulator"}
            </span>
          </div>
        </div>
        <button
          onClick={fetchAnalytics}
          style={{
            background: "rgba(255, 255, 255, 0.05)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            color: "#94A3B8",
            padding: "8px 12px",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "13px",
          }}
        >
          <ArrowClockwise size={15} /> Refresh
        </button>
      </div>

      {feedback && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: "8px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "14px",
            background: feedback.type === "success" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
            border: feedback.type === "success" ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)",
            color: feedback.type === "success" ? "#10B981" : "#EF4444",
          }}
        >
          {feedback.type === "success" ? <CheckCircle size={18} /> : <WarningCircle size={18} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Metrics Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "28px",
        }}
      >
        <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "10px", padding: "18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8", fontSize: "13px" }}>
            <span>Active Subscribers</span>
            <Users size={18} color="#38BDF8" />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#FFFFFF", marginTop: "8px" }}>
            {analytics?.subscribers.active ?? 0}
          </div>
          <div style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
            {analytics?.subscribers.total ?? 0} total &bull; {analytics?.subscribers.pending ?? 0} awaiting confirmation &bull; {analytics?.subscribers.unsubscribed ?? 0} unsubscribed
          </div>
        </div>

        <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "10px", padding: "18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8", fontSize: "13px" }}>
            <span>Broadcasts Sent</span>
            <Broadcast size={18} color="#A78BFA" />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#FFFFFF", marginTop: "8px" }}>
            {analytics?.campaigns.sent ?? 0}
          </div>
          <div style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
            {analytics?.campaigns.total ?? 0} created campaigns
          </div>
        </div>

        <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "10px", padding: "18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8", fontSize: "13px" }}>
            <span>Average Open Rate</span>
            <Eye size={18} color="#10B981" />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#10B981", marginTop: "8px" }}>
            {analytics?.engagement.openRate ?? "0.0%"}
          </div>
          <div style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
            Tracked via Resend Webhooks
          </div>
        </div>

        <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "10px", padding: "18px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#94A3B8", fontSize: "13px" }}>
            <span>Total Deliveries</span>
            <PaperPlaneTilt size={18} color="#0052FF" />
          </div>
          <div style={{ fontSize: "26px", fontWeight: 700, color: "#FFFFFF", marginTop: "8px" }}>
            {analytics?.engagement.totalSent ?? 0}
          </div>
          <div style={{ fontSize: "12px", color: "#64748B", marginTop: "4px" }}>
            Click rate: {analytics?.engagement.clickRate ?? "0.0%"}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          borderBottom: "1px solid #1E293B",
          marginBottom: "24px",
          gap: "8px",
        }}
      >
        {[
          { id: "broadcasts", label: "Campaign Studio", icon: Broadcast },
          { id: "subscribers", label: "Audience & Contacts", icon: Users },
          { id: "drips", label: "Onboarding Drips", icon: Clock },
          { id: "activity", label: "Delivery Activity Feed", icon: ListChecks },
        ].map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id as typeof tab)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 18px",
                border: "none",
                background: "transparent",
                color: active ? "#38BDF8" : "#94A3B8",
                fontWeight: active ? 600 : 500,
                fontSize: "14px",
                borderBottom: active ? "2px solid #38BDF8" : "2px solid transparent",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
            >
              <Icon size={18} weight={active ? "fill" : "regular"} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Campaign Studio */}
      {tab === "broadcasts" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: "24px" }}>
          {/* Composer */}
          <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "12px", padding: "24px" }}>
            <h2 style={{ fontSize: "17px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 16px 0" }}>
              Draft New Broadcast
            </h2>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div>
                <label style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>
                  Internal Campaign Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Q4 Multi-Rail & Solana Release"
                  value={campName}
                  onChange={(e) => setCampName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid #1E293B",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "14px",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>
                  Email Subject Line
                </label>
                <input
                  type="text"
                  placeholder="e.g. New: Direct Solana Settlement & Instant Fallbacks"
                  value={campSubject}
                  onChange={(e) => setCampSubject(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid #1E293B",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "14px",
                  }}
                />
              </div>

              <div>
                <label style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>
                  Preheader Preview Text (shown in inbox list)
                </label>
                <input
                  type="text"
                  placeholder="Sub-second settlements with USDC and yield-bearing Ondo USDY now live."
                  value={campPreview}
                  onChange={(e) => setCampPreview(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: "rgba(0,0,0,0.3)",
                    border: "1px solid #1E293B",
                    borderRadius: "6px",
                    color: "#fff",
                    fontSize: "14px",
                  }}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>
                    Target Audience
                  </label>
                  <select
                    value={campAudience}
                    onChange={(e) => setCampAudience(e.target.value as typeof campAudience)}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "#0B0F19",
                      border: "1px solid #1E293B",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "14px",
                    }}
                  >
                    <option value="all">All Active Subscribers</option>
                    <option value="merchants">Merchants Only</option>
                    <option value="developers">Developers Only</option>
                    <option value="providers">Payment Providers Only</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "12px", color: "#94A3B8", display: "block", marginBottom: "4px" }}>
                    Template Type
                  </label>
                  <select
                    value={campTemplate}
                    onChange={(e) => setCampTemplate(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "9px 12px",
                      background: "#0B0F19",
                      border: "1px solid #1E293B",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "14px",
                    }}
                  >
                    <option value="marketing_broadcast">Product Announcement / Broadcast</option>
                    <option value="changelog">Protocol Changelog</option>
                    <option value="maintenance">Maintenance Advisory</option>
                  </select>
                </div>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <label style={{ fontSize: "12px", color: "#94A3B8" }}>Content HTML / Markdown</label>
                  <button
                    type="button"
                    onClick={() => setPreviewMode(!previewMode)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#38BDF8",
                      fontSize: "12px",
                      cursor: "pointer",
                    }}
                  >
                    {previewMode ? "Edit Raw HTML" : "Show Rendered Preview"}
                  </button>
                </div>

                {previewMode ? (
                  <div
                    style={{
                      padding: "16px",
                      background: "#0B0F19",
                      border: "1px solid #1E293B",
                      borderRadius: "6px",
                      minHeight: "160px",
                      color: "#CBD5E1",
                      fontSize: "14px",
                      lineHeight: 1.6,
                    }}
                    dangerouslySetInnerHTML={{ __html: campContent }}
                  />
                ) : (
                  <textarea
                    rows={8}
                    value={campContent}
                    onChange={(e) => setCampContent(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px",
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid #1E293B",
                      borderRadius: "6px",
                      color: "#38BDF8",
                      fontFamily: "ui-monospace, monospace",
                      fontSize: "13px",
                      lineHeight: 1.5,
                    }}
                  />
                )}
              </div>

              {/* Actions */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingTop: "14px",
                  borderTop: "1px solid #1E293B",
                  flexWrap: "wrap",
                  gap: "12px",
                }}
              >
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <input
                    type="email"
                    placeholder="test@yourinbox.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                    style={{
                      padding: "8px 12px",
                      background: "rgba(0,0,0,0.3)",
                      border: "1px solid #1E293B",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "13px",
                      width: "190px",
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleSendTest}
                    disabled={sendingTest}
                    style={{
                      padding: "8px 14px",
                      background: "rgba(255,255,255,0.08)",
                      border: "1px solid rgba(255,255,255,0.15)",
                      borderRadius: "6px",
                      color: "#fff",
                      fontSize: "13px",
                      cursor: "pointer",
                    }}
                  >
                    {sendingTest ? "Sending..." : "Send Test"}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleLaunchCampaign}
                  disabled={launching}
                  style={{
                    padding: "9px 20px",
                    background: "#0052FF",
                    border: "none",
                    borderRadius: "6px",
                    color: "#fff",
                    fontWeight: 600,
                    fontSize: "14px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  {launching ? <CircleNotch className="spin" size={16} /> : <RocketLaunch size={16} />}
                  Launch Broadcast
                </button>
              </div>
            </div>
          </div>

          {/* Past Broadcasts List */}
          <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "12px", padding: "24px" }}>
            <h2 style={{ fontSize: "17px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 16px 0" }}>
              Broadcast History
            </h2>

            {analytics?.recentCampaigns.length === 0 ? (
              <p style={{ color: "#64748B", fontSize: "13px" }}>No campaigns launched yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {analytics?.recentCampaigns.map((camp) => (
                  <div
                    key={camp.id}
                    style={{
                      padding: "14px",
                      background: "#0B0F19",
                      border: "1px solid #1E293B",
                      borderRadius: "8px",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <strong style={{ color: "#FFFFFF", fontSize: "14px" }}>{camp.subject}</strong>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          background: camp.status === "sent" ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)",
                          color: camp.status === "sent" ? "#10B981" : "#F59E0B",
                        }}
                      >
                        {camp.status}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "16px", marginTop: "10px", fontSize: "12px", color: "#94A3B8" }}>
                      <span>Sent: {camp.recipientCount}</span>
                      <span>Opens: {camp.openCount}</span>
                      <span>Clicks: {camp.clickCount}</span>
                    </div>
                    <div style={{ fontSize: "11px", color: "#64748B", marginTop: "6px" }}>
                      {new Date(camp.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 2: Subscribers Directory */}
      {tab === "subscribers" && (
        <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "12px", padding: "24px" }}>
          {/* Quick Add Form */}
          <form
            onSubmit={handleAddSubscriber}
            style={{
              padding: "16px",
              background: "#0B0F19",
              border: "1px solid #1E293B",
              borderRadius: "8px",
              marginBottom: "20px",
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#FFFFFF" }}>Add Contact:</span>
            <input
              type="email"
              placeholder="email@merchant.com"
              value={newSubEmail}
              onChange={(e) => setNewSubEmail(e.target.value)}
              required
              style={{
                padding: "8px 12px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid #1E293B",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "13px",
                flex: "1 1 200px",
              }}
            />
            <input
              type="text"
              placeholder="Name (optional)"
              value={newSubName}
              onChange={(e) => setNewSubName(e.target.value)}
              style={{
                padding: "8px 12px",
                background: "rgba(0,0,0,0.3)",
                border: "1px solid #1E293B",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "13px",
                flex: "1 1 140px",
              }}
            />
            <select
              value={newSubRole}
              onChange={(e) => setNewSubRole(e.target.value as typeof newSubRole)}
              style={{
                padding: "8px 12px",
                background: "#0B0F19",
                border: "1px solid #1E293B",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "13px",
              }}
            >
              <option value="merchant">Merchant</option>
              <option value="developer">Developer</option>
              <option value="subscriber">Subscriber</option>
            </select>
            <button
              type="submit"
              disabled={addingSub}
              style={{
                padding: "8px 16px",
                background: "#0052FF",
                border: "none",
                borderRadius: "6px",
                color: "#fff",
                fontWeight: 600,
                fontSize: "13px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <Plus size={16} /> Add &amp; Sync
            </button>
          </form>

          {/* Search bar & role filter */}
          <div style={{ display: "flex", gap: "10px", marginBottom: "16px" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <MagnifyingGlass
                size={16}
                color="#64748B"
                style={{ position: "absolute", left: "12px", top: "11px" }}
              />
              <input
                type="text"
                placeholder="Search email or name..."
                value={subQuery}
                onChange={(e) => setSubQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchSubscribers()}
                style={{
                  width: "100%",
                  padding: "8px 12px 8px 36px",
                  background: "rgba(0,0,0,0.3)",
                  border: "1px solid #1E293B",
                  borderRadius: "6px",
                  color: "#fff",
                  fontSize: "13px",
                }}
              />
            </div>
            <select
              value={subRole}
              onChange={(e) => setSubRole(e.target.value)}
              style={{
                padding: "8px 12px",
                background: "#0B0F19",
                border: "1px solid #1E293B",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "13px",
              }}
            >
              <option value="all">All Roles</option>
              <option value="merchant">Merchants</option>
              <option value="developer">Developers</option>
              <option value="provider">Providers</option>
              <option value="subscriber">Subscribers</option>
            </select>
          </div>

          {/* Table */}
          {subLoading ? (
            <div style={{ textAlign: "center", padding: "40px 0", color: "#94A3B8" }}>
              <CircleNotch size={24} className="spin" />
            </div>
          ) : subscribers.length === 0 ? (
            <p style={{ color: "#64748B", fontSize: "14px" }}>No subscribers matching criteria.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table width="100%" cellPadding="10" cellSpacing="0" style={{ fontSize: "13px", color: "#CBD5E1" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1E293B", color: "#94A3B8", textAlign: "left" }}>
                    <th>Email</th>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Status</th>
                    <th>Topics</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((s) => (
                    <tr key={s.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      <td style={{ color: "#FFFFFF", fontWeight: 500 }}>{s.email}</td>
                      <td>{s.name || "—"}</td>
                      <td>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background: "rgba(56, 189, 248, 0.1)",
                            color: "#38BDF8",
                          }}
                        >
                          {s.role}
                        </span>
                      </td>
                      <td>
                        <span
                          style={{
                            fontSize: "11px",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            background: s.status === "active" ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                            color: s.status === "active" ? "#10B981" : "#EF4444",
                          }}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td style={{ fontSize: "11px", color: "#94A3B8" }}>
                        {(Array.isArray(s.topics) ? s.topics : []).join(", ") || "all"}
                      </td>
                      <td style={{ color: "#64748B", fontSize: "12px" }}>
                        {new Date(s.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Onboarding Drips */}
      {tab === "drips" && (
        <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "12px", padding: "24px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <div>
              <h2 style={{ fontSize: "17px", fontWeight: 600, color: "#FFFFFF", margin: 0 }}>
                Automated Merchant Onboarding Flow
              </h2>
            </div>
            <button
              onClick={handleTriggerDrips}
              disabled={dripProcessing}
              style={{
                padding: "8px 16px",
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "13px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              {dripProcessing ? <CircleNotch className="spin" size={16} /> : <Clock size={16} />}
              Process Drips Now
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "16px" }}>
            <div style={{ background: "#0B0F19", border: "1px solid #1E293B", borderRadius: "8px", padding: "18px" }}>
              <div style={{ fontSize: "12px", color: "#38BDF8", fontWeight: 600, textTransform: "uppercase" }}>
                Stage 1 &bull; Day 0 (Immediate)
              </div>
              <h3 style={{ fontSize: "15px", color: "#FFFFFF", margin: "8px 0 6px 0" }}>
                Welcome to PayRouta Routing
              </h3>
            </div>

            <div style={{ background: "#0B0F19", border: "1px solid #1E293B", borderRadius: "8px", padding: "18px" }}>
              <div style={{ fontSize: "12px", color: "#10B981", fontWeight: 600, textTransform: "uppercase" }}>
                Stage 2 &bull; Day 3 (Post-Signup)
              </div>
              <h3 style={{ fontSize: "15px", color: "#FFFFFF", margin: "8px 0 6px 0" }}>
                Multi-Rail Failover Masterclass
              </h3>
            </div>

            <div style={{ background: "#0B0F19", border: "1px solid #1E293B", borderRadius: "8px", padding: "18px" }}>
              <div style={{ fontSize: "12px", color: "#A78BFA", fontWeight: 600, textTransform: "uppercase" }}>
                Stage 3 &bull; Day 7 (Post-Signup)
              </div>
              <h3 style={{ fontSize: "15px", color: "#FFFFFF", margin: "8px 0 6px 0" }}>
                Instant Stablecoin &amp; USDY Settlement
              </h3>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Delivery Activity Feed */}
      {tab === "activity" && (
        <div style={{ background: "#131B2E", border: "1px solid #1E293B", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "17px", fontWeight: 600, color: "#FFFFFF", margin: "0 0 16px 0" }}>
            Real-Time Delivery &amp; Webhook Activity
          </h2>

          {analytics?.recentLogs.length === 0 ? (
            <p style={{ color: "#64748B", fontSize: "13px" }}>No delivery events recorded yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table width="100%" cellPadding="10" cellSpacing="0" style={{ fontSize: "13px", color: "#CBD5E1" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #1E293B", color: "#94A3B8", textAlign: "left" }}>
                    <th>Recipient</th>
                    <th>Type</th>
                    <th>Template</th>
                    <th>Status</th>
                    <th>Resend ID</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {analytics?.recentLogs.map((log) => {
                    const statusColor =
                      log.status === "opened"
                        ? "#10B981"
                        : log.status === "delivered" || log.status === "sent"
                          ? "#38BDF8"
                          : log.status === "clicked"
                            ? "#A78BFA"
                            : "#EF4444";

                    return (
                      <tr key={log.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                        <td style={{ color: "#FFFFFF", fontWeight: 500 }}>{log.email}</td>
                        <td>{log.type}</td>
                        <td style={{ fontFamily: "monospace", fontSize: "12px", color: "#94A3B8" }}>
                          {log.templateId}
                        </td>
                        <td>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: `${statusColor}22`,
                              color: statusColor,
                            }}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td style={{ fontFamily: "monospace", fontSize: "11px", color: "#64748B" }}>
                          {log.resendEmailId ? log.resendEmailId.substring(0, 14) + "..." : "—"}
                        </td>
                        <td style={{ color: "#64748B", fontSize: "12px" }}>
                          {new Date(log.createdAt).toLocaleTimeString()}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
