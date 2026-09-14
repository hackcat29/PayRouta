import { primaryRoutes, trustedOrigin } from "@/lib/site-config";
import { docEntries, docHref } from "@/lib/docs";
export const dynamic = "force-static";
export default function sitemap() {
  const origin = trustedOrigin();
  if (!origin) return [];
  return [
    ...primaryRoutes.map(([route]) => route),
    ...docEntries.slice(1).map(([slug]) => docHref(slug)),
  ].map((route) => ({ url: origin + route }));
}
