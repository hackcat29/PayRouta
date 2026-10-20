import React from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MarketingDashboard } from "@/components/portal/marketing-dashboard";
import { internal } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import "@/components/portal/portal.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Email marketing | PayRouta operations",
  robots: { index: false, follow: false },
};

export default async function OpsMarketingPage() {
  try {
    await internal(true);
  } catch (e) {
    if (e instanceof PortalError && e.status === 401)
      redirect("/provider/sign-in?next=/provider/settings");
    if (e instanceof PortalError)
      return (
        <div className="portal p-simple">
          <h1>Operations admins only</h1>
          <p>{e.message}</p>
          <Link className="p-button" href="/provider/settings">
            Open account security
          </Link>
        </div>
      );
    throw e;
  }
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
