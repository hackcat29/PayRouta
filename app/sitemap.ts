import { primaryRoutes, trustedOrigin } from "@/lib/site-config";
export const dynamic = "force-static";
// Documentation has its own sitemap on the docs site.
export default function sitemap() {
  const origin = trustedOrigin();
  if (!origin) return [];
  return primaryRoutes.map(([route]) => ({ url: origin + route }));
}
