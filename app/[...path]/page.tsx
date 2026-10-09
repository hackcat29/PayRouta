import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pages, type PageSlug } from "@/content/marketing";
import { pageComponents } from "@/components/marketing/pages";
import { trustedOrigin, marketingPaths } from "@/lib/site-config";

export function generateStaticParams() {
  return Object.values(marketingPaths).map((path) => ({
    path: path.slice(1).split("/"),
  }));
}

function pageSlug(path: string[]): PageSlug | undefined {
  return (Object.keys(marketingPaths) as PageSlug[]).find(
    (key) => marketingPaths[key] === "/" + path.join("/"),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ path: string[] }>;
}): Promise<Metadata> {
  const { path } = await params;
  const slug = pageSlug(path);
  const p = slug ? pages[slug] : undefined;
  if (!p || !slug) return {};
  const origin = trustedOrigin();
  return {
    title: p.title,
    description: p.intro,
    alternates: origin ? { canonical: marketingPaths[slug] } : undefined,
    ...(origin
      ? {
          openGraph: { title: `${p.title} · PayRouta`, description: p.intro, images: [`/og/${slug}`] },
          twitter: { card: "summary_large_image", images: [`/og/${slug}`] },
        }
      : {}),
  };
}

export default async function MarketingPage({
  params,
}: {
  params: Promise<{ path: string[] }>;
}) {
  const { path } = await params;
  const slug = pageSlug(path);
  if (!slug) notFound();
  const Page = pageComponents[slug];
  return (
    <div className="mk">
      <Page />
    </div>
  );
}
