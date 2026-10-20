import { detailTable, esc, renderBaseTemplate, siteUrl as defaultSite, stripHtmlToText } from "./base";

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
  const { merchantName, month, siteUrl = defaultSite(), unsubscribeUrl, preferencesUrl } = props;
  const subject = `Your PayRouta summary for ${month}`;
  const bodyContent = `<p>Hi ${esc(merchantName)},</p>
<p>Here's how ${esc(month)} went.</p>
${detailTable([
  ["Payments", props.totalTransactions.toLocaleString("en")],
  ["Volume", props.totalVolume],
  ["Success rate", props.successRate],
  ["Completed by a backup processor", props.recoveredVolume],
])}
${props.topRails.length ? `<p style="margin-bottom:8px;"><strong>Volume by payment method</strong></p>${detailTable(props.topRails.map((r) => [r.rail, r.volumePercent]))}` : ""}`;

  const html = renderBaseTemplate({
    previewText: `${props.totalVolume} across ${props.totalTransactions.toLocaleString("en")} payments.`,
    headline: `${month} summary`,
    bodyContent,
    ctaText: "Open your dashboard",
    ctaUrl: `${siteUrl}/merchant`,
    unsubscribeUrl,
    preferencesUrl,
  });
  return { subject, html, text: stripHtmlToText(html) };
}
