import { renderBaseTemplate, stripHtmlToText } from "./base";

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
  const {
    name,
    actionTitle,
    details,
    ipAddress,
    timestamp,
    actionUrl,
    actionButtonText = "Review Security Settings",
    siteUrl = process.env.SITE_URL || "https://payrouta.com",
  } = props;

  const subject = `[Security Alert] ${actionTitle} — PayRouta`;

  const bodyContent = `
    <p>Hi ${name || "there"},</p>
    <p>
      We are writing to alert you of a security event that occurred on your PayRouta account:
    </p>

    <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-left: 4px solid #EF4444; border-radius: 8px; padding: 18px; margin: 20px 0;">
      <h3 style="margin: 0 0 8px 0; color: #FFFFFF; font-size: 16px;">${actionTitle}</h3>
      <p style="margin: 0 0 12px 0; color: #CBD5E1; font-size: 14px;">${details}</p>

      <table width="100%" cellpadding="4" cellspacing="0" style="font-size: 13px; color: #94A3B8; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px;">
        <tr>
          <td>Time (UTC):</td>
          <td align="right" style="color: #CBD5E1;">${timestamp}</td>
        </tr>
        ${
          ipAddress
            ? `<tr>
                 <td>IP Address:</td>
                 <td align="right" style="color: #CBD5E1; font-family: monospace;">${ipAddress}</td>
               </tr>`
            : ""
        }
      </table>
    </div>

    <p style="color: #EF4444; font-weight: 500;">
      If you did not perform this action, revoke your API keys immediately and rotate your account credentials.
    </p>
  `;

  const html = renderBaseTemplate({
    previewText: `Security notification: ${actionTitle} on PayRouta.`,
    headline: "Security Notice",
    bodyContent,
    ctaText: actionButtonText,
    ctaUrl: actionUrl || `${siteUrl}/merchant/security`,
    footerNote: "This is an automated critical security alert sent for your protection.",
  });

  return {
    subject,
    html,
    text: stripHtmlToText(html),
  };
}
