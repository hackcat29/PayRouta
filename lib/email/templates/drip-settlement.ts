import { renderBaseTemplate, stripHtmlToText } from "./base";

export interface DripSettlementProps {
  name?: string;
  siteUrl?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

export function renderDripSettlementEmail(props: DripSettlementProps): {
  subject: string;
  html: string;
  text: string;
} {
  const {
    name,
    siteUrl = process.env.SITE_URL || "https://payrouta.com",
    unsubscribeUrl,
    preferencesUrl,
  } = props;

  const subject = "Instant Global Settlement & Yield-Bearing Stablecoins with PayRouta";
  const greeting = name ? `Hi ${name},` : "Hello,";

  const bodyContent = `
    <p>${greeting}</p>
    <p>
      Traditional cross-border settlement ties up your capital for 3 to 5 business days,
      while bleeding 2.5% to 4.0% in hidden foreign exchange (FX) spreads and intermediary correspondent bank fees.
    </p>
    <p>
      PayRouta solves this through <strong>programmable multi-rail settlement</strong>:
    </p>

    <div style="background: #0B0F19; border: 1px solid #1E293B; border-radius: 8px; padding: 18px; margin: 20px 0;">
      <h4 style="margin: 0 0 10px 0; color: #38BDF8; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Settlement Rails Compared</h4>
      <table width="100%" cellpadding="6" cellspacing="0" style="font-size: 13px; color: #CBD5E1;">
        <tr style="border-bottom: 1px solid #1E293B; color: #94A3B8;">
          <th align="left">Rail</th>
          <th align="center">Speed</th>
          <th align="right">Typical Cost</th>
        </tr>
        <tr>
          <td>Legacy Wire / Swift</td>
          <td align="center" style="color: #F87171;">3-5 Days</td>
          <td align="right" style="color: #F87171;">$25 + 3.2% FX</td>
        </tr>
        <tr>
          <td>USDC (Solana / Stellar)</td>
          <td align="center" style="color: #10B981;">&lt; 5 Seconds</td>
          <td align="right" style="color: #10B981;">&lt; $0.01</td>
        </tr>
        <tr>
          <td>Ondo USDY (Yield-Bearing)</td>
          <td align="center" style="color: #10B981;">Instant</td>
          <td align="right" style="color: #10B981;">Earns ~5.0% APY</td>
        </tr>
      </table>
    </div>

    <p>
      With PayRouta, your customers can pay in their local fiat currency (NGN, KES, ZAR, USD, EUR) or crypto,
      and you can receive automated settlement directly in USD, USDC, or yield-bearing tokenized US Treasuries (Ondo USDY).
    </p>
  `;

  const html = renderBaseTemplate({
    previewText: "Learn how PayRouta unlocks sub-second settlement and yield-bearing treasury assets.",
    headline: "Eliminate Cross-Border FX Fees & Multi-Day Delays",
    bodyContent,
    ctaText: "Explore Settlement Settings",
    ctaUrl: `${siteUrl}/merchant/settlements`,
    secondaryCtaText: "Read Settlement Docs",
    secondaryCtaUrl: `${siteUrl}/platform/settlement`,
    unsubscribeUrl,
    preferencesUrl,
  });

  return {
    subject,
    html,
    text: stripHtmlToText(html),
  };
}
