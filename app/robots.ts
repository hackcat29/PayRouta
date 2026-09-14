import { trustedOrigin } from "@/lib/site-config";
export const dynamic = "force-static";
export default function robots() {
  const origin = trustedOrigin();
  return origin
    ? {
        rules: { userAgent: "*", allow: "/", disallow: "/api/" },
        sitemap: origin + "/sitemap.xml",
      }
    : { rules: { userAgent: "*", disallow: "/" } };
}
