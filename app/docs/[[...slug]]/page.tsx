import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "react-markdown";
import { readDocs, docEntries } from "@/lib/docs";
import { DocsNavigation } from "@/components/docs-navigation";
import { CodeBlock } from "@/components/code-block";
import { trustedOrigin } from "@/lib/site-config";
export function generateStaticParams() {
  return docEntries.map(([slug]) => ({
    slug: slug === "overview" ? [] : [slug],
  }));
}
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const doc = readDocs().find(
    (d) => d.slug === (slug?.join("/") || "overview"),
  );
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
  const index = docs.findIndex(
    (d) => d.slug === (slug?.join("/") || "overview"),
  );
  if (index < 0) notFound();
  const doc = docs[index];
  return (
    <div className="container docs-shell">
      <DocsNavigation key={doc.slug} items={docs} current={doc.slug} />
      <article className="docs-article">
        <nav aria-label="Breadcrumb" className="breadcrumbs">
          <Link href="/docs">Documentation</Link> / {doc.title}
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
          {index < docs.length - 1 && (
            <Link href={docs[index + 1].href}>{docs[index + 1].title} →</Link>
          )}
        </nav>
      </article>
    </div>
  );
}
