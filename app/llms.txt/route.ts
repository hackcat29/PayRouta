// /llms.txt: the site for AI assistants and agents, in plain Markdown
// (llmstxt.org). Built from the same sources as the pages (content/claims,
// lib/site-config), so it says only what the site says.
import { coverage, methodFamilies, pillars, platforms, pricing, publicLabel, settleIn } from "@/content/claims";
import { docsUrl, primaryRoutes, trustedOrigin } from "@/lib/site-config";

export const dynamic = "force-static";

export function GET() {
  const origin = trustedOrigin() ?? "https://payrouta.com";
  const families = Object.fromEntries(methodFamilies);
  const body = [
    "# PayRouta",
    "",
    "> One checkout for every way the world pays: a payment link or one checkout button, where customers pay by card, digital wallet, bank transfer, mobile money, credit from a licensed lender, or crypto from any wallet and chain.",
    "",
    "## What PayRouta does",
    "",
    ...pillars.map((p) => `- ${p.title}${publicLabel(p.availability) ? ` (${publicLabel(p.availability)})` : ""}: ${p.note}`),
    "",
    "## Where merchants add it",
    "",
    ...platforms.map((p) => `- ${p.name}: ${p.detail}`),
    "",
    "## What merchants are settled in",
    "",
    ...settleIn.map((o) => `- ${o.name}: ${o.detail}`),
    "",
    "## Where customers can pay",
    "",
    ...coverage.map(
      (c) =>
        `- ${c.region}: ${Object.entries(c.cells)
          .filter(([, a]) => a)
          .map(([k, a]) => `${families[k]}${publicLabel(a!) ? ` (${publicLabel(a!)})` : ""}`)
          .join(", ")}`,
    ),
    "",
    "## Pricing",
    "",
    `- ${pricing.partnerProcessed.methods}: ${pricing.partnerProcessed.rate} per successful payment, max ${pricing.partnerProcessed.cap}, ${pricing.partnerProcessed.note}.`,
    `- ${pricing.payroutaOnly.methods}: ${pricing.payroutaOnly.rate}, ${pricing.payroutaOnly.note}.`,
    "",
    "## Pages",
    "",
    ...primaryRoutes.map(([path, label]) => `- [${label}](${origin}${path})`),
    "",
    "## For developers and agents",
    "",
    `- [Quickstart](${docsUrl("quickstart")})`,
    `- [API reference](${docsUrl("api-reference")})`,
    `- [Webhooks](${docsUrl("webhooks")})`,
    `- [SDKs](${docsUrl("sdks")})`,
    `- [MCP server](${docsUrl("mcp")}): ${origin}/api/mcp, authorised with a PayRouta API key or agent key`,
    `- [Agentic payments](${docsUrl("agents")}): links and invoices answer agents with 402 Payment Required and the ways to pay`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
