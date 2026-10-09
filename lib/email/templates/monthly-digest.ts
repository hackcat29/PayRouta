import { renderBaseTemplate, stripHtmlToText } from "./base";

export interface MonthlyDigestProps {
  merchantName: string;
  month: string;
  totalVolume: string;
  totalTransactions: number;
  successRate: string;
  recoveredVolume: string;
  topRails: { rail: string; volumePercent: string }[];
  siteUrl?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

export function renderMonthlyDigestEmail(props: MonthlyDigestProps): {
  subject: string;
  html: string;
  text: string;
} {
  const {
    merchantName,
    month,
    totalVolume,
    totalTransactions,
    successRate,
    recoveredVolume,
    topRails,
    siteUrl = process.env.SITE_URL || "https://payrouta.com",
    unsubscribeUrl,
    preferencesUrl,
  } = props;

  const subject = `Your PayRouta Performance Digest — ${month}`;

  const railsRows = topRails
    .map(
      (r) => `
    <tr>
      <td style="padding: 8px 0; color: #CBD5E1; font-weight: 500;">${r.rail}</td>
      <td align="right" style="padding: 8px 0; color: #38BDF8; font-weight: 600;">${r.volumePercent}</td>
    </tr>
  `,
    )
    .join("");

  const bodyContent = `
    <p>Hi ${merchantName},</p>
    <p>
      Here is your automated monthly routing summary for <strong>${month}</strong>.
      Smart routing actively shielded your checkout conversion from third-party provider failures.
    </p>

    <table class="metric-grid" cellpadding="0" cellspacing="8">
      <tr>
        <td class="metric-card" width="50%">
          <div class="metric-val" style="color: #FFFFFF;">${totalVolume}</div>
          <div class="metric-label">Processed Volume</div>
        </td>
        <td class="metric-card" width="50%">
          <div class="metric-val" style="color: #10B981;">${successRate}</div>
          <div class="metric-label">Success Rate</div>
        </td>
      </tr>
      <tr>
        <td class="metric-card" width="50%">
          <div class="metric-val" style="color: #38BDF8;">${totalTransactions.toLocaleString()}</div>
          <div class="metric-label">Transactions</div>
        </td>
        <td class="metric-card" width="50%">
          <div class="metric-val" style="color: #F59E0B;">${recoveredVolume}</div>
          <div class="metric-label">Recovered via Fallbacks</div>
        </td>
      </tr>
    </table>

    <div style="background: #0B0F19; border: 1px solid #1E293B; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <h4 style="margin: 0 0 10px 0; color: #FFFFFF; font-size: 14px;">Top Payment Rails</h4>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 13px;">
        ${railsRows}
      </table>
    </div>

    <p>
      Visit your merchant analytics portal to download reconciled reports, audit settlement statements, or adjust routing rules.
    </p>
  `;

  const html = renderBaseTemplate({
    previewText: `Monthly routing summary for ${merchantName}: ${totalVolume} processed with ${successRate} success rate.`,
    headline: `${month} Routing & Settlement Digest`,
    bodyContent,
    ctaText: "Open Merchant Analytics",
    ctaUrl: `${siteUrl}/merchant/analytics`,
    secondaryCtaText: "View Statements",
    secondaryCtaUrl: `${siteUrl}/merchant/billing`,
    unsubscribeUrl,
    preferencesUrl,
  });

  return {
    subject,
    html,
    text: stripHtmlToText(html),
  };
}
