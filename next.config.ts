import type { NextConfig } from "next";
import { legacyRedirects } from "./lib/site-config";
const config: NextConfig = {
  output: "standalone",
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  devIndicators: false,
  async redirects() {
    return legacyRedirects.map(({ source, destination }) => ({
      source,
      destination,
      permanent: true,
    }));
  },
};
export default config;
