export interface BaseEmailProps {
  previewText?: string;
  headline?: string;
  // Trusted HTML. Escape anything that came from a user with esc().
  bodyContent: string;
  ctaText?: string;
  ctaUrl?: string;
  secondaryCtaText?: string;
  secondaryCtaUrl?: string;
  // Trusted HTML shown below the button.
  afterCta?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
  footerNote?: string;
}

const INK = "#0b1b22";
const BODY = "#33434a";
const MUTED = "#6b7a80";
const RULE = "#e3e7e8";
const ACCENT = "#00756b";

// Escapes text for HTML element content and quoted attribute values.
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// First name only, trimmed, for greetings.
export function greeting(name?: string | null, fallback = "Hi,") {
  const first = name?.trim().split(/\s+/)[0];
  return first ? `Hi ${esc(first)},` : fallback;
}

// A two-column table of label/value rows. Values are escaped.
export function detailTable(rows: [string, string | undefined][]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-top:1px solid ${RULE};font-size:14px;">${rows
    .filter(([, v]) => v !== undefined && v !== "")
    .map(
      ([k, v]) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid ${RULE};color:${MUTED};">${esc(k)}</td><td align="right" style="padding:9px 0;border-bottom:1px solid ${RULE};color:${INK};">${esc(v)}</td></tr>`,
    )
    .join("")}</table>`;
}

export const siteUrl = () => process.env.SITE_URL || "https://payrouta.com";

export function renderBaseTemplate(props: BaseEmailProps): string {
  const {
    previewText = "",
    headline,
    bodyContent,
    ctaText,
    ctaUrl,
    secondaryCtaText,
    secondaryCtaUrl,
    afterCta = "",
    unsubscribeUrl,
    preferencesUrl,
    footerNote,
  } = props;
  const site = siteUrl();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<title>${esc(headline || "PayRouta")}</title>
<style>
  body { margin:0; padding:0; background:#f4f5f5; }
  a { color:${ACCENT}; }
  p { margin:0 0 16px; }
  ul, ol { margin:0 0 16px; padding-left:20px; }
  li { margin-bottom:6px; }
  .code-block { background:#f4f5f5; border:1px solid ${RULE}; border-radius:6px; padding:12px 14px; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; color:${INK}; margin:0 0 16px; white-space:pre-wrap; }
  .metric-grid { width:100%; margin:0 0 16px; border-collapse:separate; border-spacing:0 8px; }
  .metric-card { border:1px solid ${RULE}; border-radius:6px; padding:12px; }
  .metric-val { font-size:20px; font-weight:600; color:${INK}; }
  .metric-label { font-size:12px; color:${MUTED}; margin-top:2px; }
  @media (max-width:620px) { .card { padding:28px 20px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:#f4f5f5;">
${previewText ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(previewText)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f5f5;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
        <tr>
          <td style="padding:0 4px 16px;">
            <a href="${esc(site)}" style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:17px;font-weight:700;color:${INK};text-decoration:none;letter-spacing:-0.2px;">PayRouta</a>
          </td>
        </tr>
        <tr>
          <td class="card" style="background:#ffffff;border:1px solid ${RULE};border-radius:8px;padding:36px 36px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:${BODY};">
            ${headline ? `<h1 style="margin:0 0 20px;font-size:21px;line-height:1.3;font-weight:650;color:${INK};">${esc(headline)}</h1>` : ""}
            ${bodyContent}
            ${
              ctaText && ctaUrl
                ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;"><tr>
                    <td style="border-radius:6px;background:${INK};"><a href="${esc(ctaUrl)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">${esc(ctaText)}</a></td>
                    ${secondaryCtaText && secondaryCtaUrl ? `<td style="padding-left:16px;"><a href="${esc(secondaryCtaUrl)}" style="font-size:14px;font-weight:500;color:${ACCENT};">${esc(secondaryCtaText)}</a></td>` : ""}
                  </tr></table>`
                : ""
            }
            ${afterCta}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:${MUTED};">
            ${footerNote ? `<p style="margin:0 0 8px;">${footerNote}</p>` : ""}
            <p style="margin:0;">
              PayRouta, a service of Routa Solutions${preferencesUrl ? ` · <a href="${esc(preferencesUrl)}" style="color:${MUTED};">Email preferences</a>` : ""}${unsubscribeUrl ? ` · <a href="${esc(unsubscribeUrl)}" style="color:${MUTED};">Unsubscribe</a>` : ""} · <a href="${esc(site)}/privacy" style="color:${MUTED};">Privacy</a>
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<div style="display:none[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n$1\n\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n$1\n\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n$1\n\n")
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n")
    .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) =>
      label.trim() === href ? href : `${label} (${href})`,
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&bull;/g, "•")
    .replace(/&middot;/g, "·")
    .replace(/&#8199;|&#847;|&zwnj;/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
