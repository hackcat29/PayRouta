import type { NextConfig } from "next";
import { legacyRedirects } from "./lib/site-config";
const config: NextConfig = {
  output: "standalone",
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  devIndicators: false,
  // Set by the Next.js security upgrade (16.4.0 → 16.4.3).
  experimental: { agentUpgrade: "security" },
  async headers() {
    const https = (process.env.BETTER_AUTH_URL || "").startsWith("https://");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
          },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
          },
          ...(https
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
            : []),
        ],
      },
      // Checkout never leaks its session path to providers or other sites.
      { source: "/checkout/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      // The checkout button script is loaded by merchants' sites. Versioned
      // path, short cache, so fixes reach every merchant within minutes.
      {
        source: "/js/v1/:file*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, stale-while-revalidate=3600" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
  async redirects() {
    return legacyRedirects.map(({ source, destination }) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};
export default config;
