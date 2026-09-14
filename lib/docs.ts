import fs from "node:fs";
import path from "node:path";
export const docEntries = [
  ["overview", "Overview"],
  ["quickstart", "Quickstart"],
  ["api-reference", "API Reference"],
  ["sdks", "SDKs"],
  ["payment-intents", "Payment Intents"],
  ["payment-methods", "Payment Methods"],
  ["webhooks", "Webhooks"],
  ["provider-integration", "Provider Integration"],
  ["settlement", "Settlement"],
  ["errors", "Errors & Recovery"],
] as const;
export function docHref(slug: string) {
  return slug === "overview" ? "/docs" : `/docs/${slug}`;
}
export function readDocs() {
  const docsDir = path.join(process.cwd(), "docs");
  const fallbackDir = path.join(process.cwd(), "content/docs");
  const dir = fs.existsSync(docsDir) ? docsDir : fallbackDir;

  return docEntries.map(([slug, title]) => {
    let filePath = path.join(dir, `${slug}.md`);
    if (slug === "overview" && !fs.existsSync(filePath)) {
      filePath = path.join(dir, "README.md");
    }
    return {
      slug,
      title,
      href: docHref(slug),
      content: fs.readFileSync(filePath, "utf8"),
    };
  });
}
