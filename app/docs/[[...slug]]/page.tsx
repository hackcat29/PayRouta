import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import { readDocs, docEntries, findDoc } from "@/lib/docs";
import { DocsNavigation } from "@/components/docs-navigation";
import { CodeBlock } from "@/components/code-block";
import { trustedOrigin } from "@/lib/site-config";

export function generateStaticParams() {
  const direct = docEntries.map(([slug]) => ({
    slug: slug === "overview" ? [] : slug.split("/"),
  }));
  const aliases = docEntries
    .filter(([slug]) => slug.startsWith("providers/"))
    .map(([slug]) => ({
      slug: slug.replace(/^providers\//, "").split("/"),
    }));
  return [...direct, ...aliases];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const rawSlug = slug?.join("/") || "overview";
  const doc = findDoc(rawSlug);
  if (!doc) return {};
  const description =
    doc.content
      .split("\n")
      .find((line) => line.trim() && !line.startsWith("#") && !line.startsWith(">")) || doc.title;
  return {
    title: `${doc.title} — Documentation`,
    description,
    alternates: trustedOrigin() ? { canonical: doc.href } : undefined,
  };
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const docs = readDocs();
  const rawSlug = slug?.join("/") || "overview";
  const doc = findDoc(rawSlug);
  if (!doc) notFound();

  const index = docs.findIndex((d) => d.slug === doc.slug);

  // Hierarchical breadcrumbs
  const breadcrumbs: { href: string; label: string }[] = [
    { href: "/docs", label: "Documentation" },
  ];
  if (doc.slug.startsWith("providers/")) {
    breadcrumbs.push({ href: "/docs/providers", label: "Providers" });
    const parts = doc.slug.split("/");
    if (parts.length > 2) {
      const categorySlug = `providers/${parts[1]}`;
      const categoryDoc = docs.find((d) => d.slug === categorySlug);
      breadcrumbs.push({
        href: `/docs/${categorySlug}`,
        label: categoryDoc ? categoryDoc.title : parts[1],
      });
    }
  } else if (
    doc.category &&
    doc.category !== "Getting Started" &&
    doc.category !== "Core Concepts" &&
    doc.category !== "Integration"
  ) {
    breadcrumbs.push({ href: doc.href, label: doc.category });
  }
  breadcrumbs.push({ href: doc.href, label: doc.title });

  return (
    <div className="container docs-shell">
      <DocsNavigation key={doc.slug} items={docs} current={doc.slug} />
      <article className="docs-article">
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          {breadcrumbs.map((b, i) => (
            <span key={b.href + "-" + i}>
              {i > 0 && " / "}
              {i === breadcrumbs.length - 1 ? (
                <span>{b.label}</span>
              ) : (
                <Link href={b.href}>{b.label}</Link>
              )}
            </span>
          ))}
        </nav>
        <div className="docs-notice">
          Early access · Interfaces and SDKs are provisional. Examples are
          illustrative, not a published API contract.
        </div>
        <h1>{doc.title}</h1>
        <Markdown
          components={{
            h1: () => null,
            table: ({ children }) => (
              <div className="docs-table-wrapper">
                <table>{children}</table>
              </div>
            ),
            a: ({ href, children }) => {
              let targetHref = href || "";
              if (targetHref === "README.md" || targetHref === "overview.md") {
                targetHref = "/docs";
              } else if (targetHref.endsWith("/README.md")) {
                targetHref = `/docs/${targetHref.replace(/\/README\.md$/, "")}`;
              } else if (targetHref.endsWith(".md")) {
                targetHref = `/docs/${targetHref.replace(/\.md$/, "")}`;
              }
              if (targetHref.startsWith("/")) {
                return <Link href={targetHref}>{children}</Link>;
              }
              return (
                <a href={targetHref} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            },
            pre: ({ children }) => <>{children}</>,
            code: ({ children, className }) =>
              className ? (
                <CodeBlock
                  code={String(children).trimEnd()}
                  label="Illustrative JSON · proposed interface"
                />
              ) : (
                <code>{children}</code>
              ),
          }}
        >
          {doc.content}
        </Markdown>
        <nav
          className="docs-pagination"
          aria-label="Previous and next documentation"
        >
          {index > 0 ? (
            <Link href={docs[index - 1].href}>← {docs[index - 1].title}</Link>
          ) : (
            <span />
          )}
          {index >= 0 && index < docs.length - 1 && (
            <Link href={docs[index + 1].href}>{docs[index + 1].title} →</Link>
          )}
        </nav>
      </article>
    </div>
  );
}
