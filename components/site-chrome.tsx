"use client";
import { usePathname } from "next/navigation";
import { Navigation } from "./navigation";
import { Footer } from "./shared";
import { AnalyticsListener } from "./analytics-listener";
export function SiteChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (
    pathname.startsWith("/provider") ||
    pathname.startsWith("/merchant") ||
    pathname.startsWith("/ops") ||
    pathname.startsWith("/checkout") ||
    ["/sign-in", "/sign-up", "/reset-password"].includes(pathname)
  )
    return <main id="main">{children}</main>;
  return (
    <>
      <AnalyticsListener />
      <Navigation />
      <main id="main">{children}</main>
      <Footer />
    </>
  );
}
