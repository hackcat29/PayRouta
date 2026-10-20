import { detailTable, esc, greeting, renderBaseTemplate, siteUrl as defaultSite, stripHtmlToText } from "./base";

export interface SecurityAlertProps {
  name?: string;
  actionTitle: string;
  details: string;
  ipAddress?: string;
  timestamp: string;
  actionUrl?: string;
  actionButtonText?: string;
  siteUrl?: string;
}

export function renderSecurityAlertEmail(props: SecurityAlertProps): {
  subject: string;
  html: string;
  text: string;
} {
  const { siteUrl = defaultSite() } = props;
  const subject = `[Security Alert] ${props.actionTitle}`;
  const bodyContent = `<p>${greeting(props.name)}</p>
<p>This happened on your PayRouta account:</p>
<p><strong>${esc(props.actionTitle)}</strong><br>${esc(props.details)}</p>
${detailTable([
  ["Time (UTC)", props.timestamp],
  ["IP address", props.ipAddress],
])}
<p><strong>If this wasn't you</strong>, change your password, revoke any API keys you don't recognise, and reply to this email.</p>`;

  const html = renderBaseTemplate({
    previewText: props.actionTitle,
    headline: "Security notice",
    bodyContent,
    ctaText: props.actionButtonText || "Review account security",
    ctaUrl: props.actionUrl || `${siteUrl}/merchant/settings`,
    footerNote: "We send security notices for important account changes. They can't be turned off.",
  });
  return { subject, html, text: stripHtmlToText(html) };
}
