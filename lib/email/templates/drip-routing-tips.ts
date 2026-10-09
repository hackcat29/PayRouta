import { renderBaseTemplate, stripHtmlToText } from "./base";

export interface DripRoutingTipsProps {
  name?: string;
  siteUrl?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

export function renderDripRoutingTipsEmail(props: DripRoutingTipsProps): {
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

  const subject = "How PayRouta Recovers 22% of Failed Transactions";
  const greeting = name ? `Hi ${name},` : "Hello,";

  const bodyContent = `
    <p>${greeting}</p>
    <p>
      Did you know that standard payment gateways suffer an average 4.8% failure rate due to temporary provider timeouts, issuer declines, and maintenance windows?
    </p>
    <p>
      With PayRouta's <strong>Adaptive Provider Failover</strong>, your payments are never locked to a single point of failure.
    </p>

    <table class="metric-grid" cellpadding="0" cellspacing="8">
      <tr>
        <td class="metric-card" width="50%">
          <div class="metric-val" style="color: #10B981;">+22.4%</div>
          <div class="metric-label">Avg. Conversion Uplift</div>
        </td>
        <td class="metric-card" width="50%">
          <div class="metric-val" style="color: #38BDF8;">&lt; 380ms</div>
          <div class="metric-label">Failover Latency</div>
        </td>
      </tr>
    </table>

    <h3 style="color: #FFFFFF; font-size: 16px; margin-top: 24px; margin-bottom: 12px;">3 Ways to Optimize Your Routing Strategy</h3>
    <ul style="padding-left: 20px; color: #CBD5E1; line-height: 1.7;">
      <li style="margin-bottom: 10px;">
        <strong style="color: #FFFFFF;">Enable Multi-Provider Redundancy:</strong> Route local Nigerian cards via Paystack with automated Flutterwave fallback.
      </li>
      <li style="margin-bottom: 10px;">
        <strong style="color: #FFFFFF;">Turn on Stablecoin Checkout:</strong> Allow global customers to pay with USDC on Solana or Stellar, bypassing international card processing fees completely.
      </li>
      <li style="margin-bottom: 10px;">
        <strong style="color: #FFFFFF;">Inspect Your Route Telemetry:</strong> Review live latency, provider health scores, and failover logs in your merchant analytics tab.
      </li>
    </ul>

    <p style="margin-top: 20px;">
      Ready to test a simulated outage? You can trigger provider failures in your sandbox environment without risking live volume.
    </p>
  `;

  const html = renderBaseTemplate({
    previewText: "Discover how intelligent payment failover preserves revenue and cuts cross-border fees.",
    headline: "Boost Authorization Rates with Multi-Rail Failover",
    bodyContent,
    ctaText: "Configure Routing Rules",
    ctaUrl: `${siteUrl}/merchant/providers`,
    secondaryCtaText: "Read Routing Docs",
    secondaryCtaUrl: `${siteUrl}/platform/provider-routing`,
    unsubscribeUrl,
    preferencesUrl,
  });

  return {
    subject,
    html,
    text: stripHtmlToText(html),
  };
}
