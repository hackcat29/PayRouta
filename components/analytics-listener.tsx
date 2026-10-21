"use client";
import { useEffect } from "react";
import { track } from "@/lib/analytics";
import { docsOrigin } from "@/lib/site-config";
export function AnalyticsListener() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element)?.closest?.("a[href]");
      if (!anchor) return;
      const href = anchor.getAttribute("href") || "";
      if (href.startsWith("/docs") || href.startsWith(docsOrigin)) track("docs", { action: "navigate" });
      else if (href.startsWith("/contact?intent=")) {
        const intent = new URL(href, window.location.origin).searchParams.get(
          "intent",
        );
        if (
          intent &&
          ["merchant", "provider", "pricing", "general"].includes(intent)
        )
          track("cta", { intent, action: "contact" });
      }
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
