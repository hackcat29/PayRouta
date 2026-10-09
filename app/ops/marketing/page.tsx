import React from "react";
import Link from "next/link";
import { MarketingDashboard } from "@/components/portal/marketing-dashboard";
import "@/components/portal/portal.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Email Marketing & Resend Dispatch | PayRouta Operations",
  robots: { index: false, follow: false },
};

export default function OpsMarketingPage() {
  return (
    <div className="portal" style={{ minHeight: "100vh", background: "#0B0F19" }}>
      <header
        style={{
          borderBottom: "1px solid #1E293B",
          background: "#101827",
          padding: "16px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <Link
            href="/ops"
            style={{
              color: "#38BDF8",
              textDecoration: "none",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            &larr; Operations Hub
          </Link>
          <span style={{ color: "#334155" }}>|</span>
          <span style={{ color: "#FFFFFF", fontWeight: 600, fontSize: "14px" }}>
            Marketing &amp; Resend Dispatch
          </span>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <Link
            href="/merchant"
            style={{
              color: "#94A3B8",
              textDecoration: "none",
              fontSize: "13px",
            }}
          >
            Merchant Portal
          </Link>
          <Link
            href="/"
            style={{
              color: "#94A3B8",
              textDecoration: "none",
              fontSize: "13px",
            }}
          >
            Website Home
          </Link>
        </div>
      </header>

      <main style={{ padding: "12px 0 48px" }}>
        <MarketingDashboard />
      </main>
    </div>
  );
}
