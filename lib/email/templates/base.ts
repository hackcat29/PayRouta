export interface BaseEmailProps {
  previewText?: string;
  headline?: string;
  bodyContent: string;
  ctaText?: string;
  ctaUrl?: string;
  secondaryCtaText?: string;
  secondaryCtaUrl?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
  footerNote?: string;
}

const BRAND_COLOR = "#0052FF";
const BG_DARK = "#0B0F19";
const CARD_BG = "#131B2E";
const TEXT_MUTED = "#94A3B8";
const TEXT_LIGHT = "#F8FAFC";
const BORDER_COLOR = "#1E293B";

export function renderBaseTemplate(props: BaseEmailProps): string {
  const {
    previewText = "PayRouta - The global multi-rail payment routing layer",
    headline,
    bodyContent,
    ctaText,
    ctaUrl,
    secondaryCtaText,
    secondaryCtaUrl,
    unsubscribeUrl,
    preferencesUrl,
    footerNote,
  } = props;

  const siteUrl = process.env.SITE_URL || "https://payrouta.com";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${headline || "PayRouta Update"}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: ${BG_DARK};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: ${TEXT_LIGHT};
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: ${BG_DARK};
      padding: 36px 16px;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: ${CARD_BG};
      border-radius: 12px;
      border: 1px solid ${BORDER_COLOR};
      overflow: hidden;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.4);
    }
    .header {
      padding: 32px 36px 24px;
      border-bottom: 1px solid ${BORDER_COLOR};
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.5px;
      color: #FFFFFF;
      text-decoration: none;
      display: inline-block;
    }
    .brand-tag {
      display: inline-block;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: rgba(0, 82, 255, 0.15);
      color: #38BDF8;
      border: 1px solid rgba(56, 189, 248, 0.3);
      padding: 3px 8px;
      border-radius: 9999px;
      float: right;
    }
    .content {
      padding: 36px;
      font-size: 15px;
      line-height: 1.65;
      color: #CBD5E1;
    }
    .headline {
      margin-top: 0;
      margin-bottom: 18px;
      font-size: 22px;
      font-weight: 700;
      line-height: 1.3;
      color: #FFFFFF;
      letter-spacing: -0.4px;
    }
    .btn-primary {
      display: inline-block;
      background-color: ${BRAND_COLOR};
      color: #FFFFFF !important;
      font-weight: 600;
      font-size: 14px;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      text-align: center;
      margin-top: 12px;
      margin-bottom: 8px;
    }
    .btn-secondary {
      display: inline-block;
      background-color: transparent;
      color: #94A3B8 !important;
      font-weight: 500;
      font-size: 14px;
      padding: 12px 20px;
      border-radius: 8px;
      border: 1px solid ${BORDER_COLOR};
      text-decoration: none;
      text-align: center;
      margin-left: 10px;
    }
    .code-block {
      background: #0B0F19;
      border: 1px solid #1E293B;
      border-radius: 8px;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      color: #38BDF8;
      overflow-x: auto;
      margin: 16px 0;
    }
    .metric-grid {
      width: 100%;
      margin: 20px 0;
      border-collapse: separate;
      border-spacing: 8px;
    }
    .metric-card {
      background: #0B0F19;
      border: 1px solid #1E293B;
      border-radius: 8px;
      padding: 14px;
      text-align: center;
    }
    .metric-val {
      font-size: 20px;
      font-weight: 700;
      color: #FFFFFF;
    }
    .metric-label {
      font-size: 11px;
      color: ${TEXT_MUTED};
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }
    .footer {
      padding: 24px 36px 32px;
      border-top: 1px solid ${BORDER_COLOR};
      font-size: 12px;
      line-height: 1.5;
      color: ${TEXT_MUTED};
      text-align: center;
      background-color: #0E1424;
    }
    .footer a {
      color: #64748B;
      text-decoration: underline;
    }
    .footer a:hover {
      color: #94A3B8;
    }
    .preview-text {
      display: none;
      font-size: 1px;
      line-height: 1px;
      max-height: 0px;
      max-width: 0px;
      opacity: 0;
      overflow: hidden;
    }
  </style>
</head>
<body>
  <!-- Preheader preview text for email clients -->
  <span class="preview-text">${previewText}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="wrapper">
    <tr>
      <td align="center">
        <div class="container">
          <div class="header">
            <table width="100%" border="0" cellpadding="0" cellspacing="0">
              <tr>
                <td align="left">
                  <a href="${siteUrl}" class="brand-title">
                    PayRouta
                  </a>
                </td>
                <td align="right">
                  <span class="brand-tag">Global Multi-Rail</span>
                </td>
              </tr>
            </table>
          </div>
          <div class="content">
            ${headline ? `<h1 class="headline">${headline}</h1>` : ""}
            ${bodyContent}
            ${
              ctaText && ctaUrl
                ? `<div style="margin-top: 24px;">
                     <a href="${ctaUrl}" class="btn-primary">${ctaText}</a>
                     ${
                       secondaryCtaText && secondaryCtaUrl
                         ? `<a href="${secondaryCtaUrl}" class="btn-secondary">${secondaryCtaText}</a>`
                         : ""
                     }
                   </div>`
                : ""
            }
          </div>
          <div class="footer">
            ${footerNote ? `<p style="margin-top: 0; margin-bottom: 12px;">${footerNote}</p>` : ""}
            <p style="margin: 0 0 8px 0;">
              PayRouta &bull; Multi-rail payment routing, instant stablecoin settlement &amp; compliance layer.
            </p>
            <p style="margin: 0; color: #64748B;">
              ${
                preferencesUrl
                  ? `<a href="${preferencesUrl}">Manage preferences</a> &bull; `
                  : ""
              }
              ${
                unsubscribeUrl
                  ? `<a href="${unsubscribeUrl}">Unsubscribe</a> &bull; `
                  : ""
              }
              <a href="${siteUrl}/privacy">Privacy Policy</a>
            </p>
          </div>
        </div>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "\n\n# $1\n\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "\n\n## $1\n\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "* $1\n")
    .replace(/<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&bull;/g, "•")
    .replace(/&amp;/g, "&")
    .replace(/\n\s+\n/g, "\n\n")
    .trim();
}
