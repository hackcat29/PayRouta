import { renderBaseTemplate, stripHtmlToText } from "./base";

export interface WelcomeEmailProps {
  name?: string;
  role?: "merchant" | "developer" | "provider" | "subscriber";
  siteUrl?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

export function renderWelcomeEmail(props: WelcomeEmailProps): {
  subject: string;
  html: string;
  text: string;
} {
  const {
    name,
    role = "merchant",
    siteUrl = process.env.SITE_URL || "https://payrouta.com",
    unsubscribeUrl,
    preferencesUrl,
  } = props;

  const subject = "Welcome to PayRouta — Global Multi-Rail Payment Routing";
  const greeting = name ? `Hi ${name},` : "Welcome,";

  const isDeveloper = role === "developer";

  const bodyContent = `
    <p>${greeting}</p>
    <p>
      Welcome to PayRouta. You're now set up with the modern cross-border payment routing layer.
      With PayRouta, you connect once and gain access to resilient fiat providers (Paystack, Flutterwave, Stripe)
      alongside high-speed crypto and stablecoin rails (Solana, Stellar, USDC, USDT, and yield-bearing Ondo USDY).
    </p>

    <div style="background: rgba(0, 82, 255, 0.08); border-left: 3px solid #0052FF; padding: 14px 18px; margin: 20px 0; border-radius: 0 8px 8px 0;">
      <strong style="color: #FFFFFF; font-size: 14px;">Next steps to get started:</strong>
      <ol style="margin: 8px 0 0 0; padding-left: 20px; color: #CBD5E1;">
        <li style="margin-bottom: 6px;">Configure your preferred payment fallback rules in your dashboard.</li>
        <li style="margin-bottom: 6px;">Test your first sandbox checkout with simulated provider outages.</li>
        <li style="margin-bottom: 6px;">Deploy webhooks to receive signed notifications on payment confirmations.</li>
      </ol>
    </div>

    ${
      isDeveloper
        ? `
    <h3 style="color: #FFFFFF; font-size: 15px; margin-top: 24px; margin-bottom: 8px;">Quickstart API Request</h3>
    <div class="code-block">
curl -X POST ${siteUrl}/api/v1/payments/intents \\<br/>
&nbsp;&nbsp;-H "Authorization: Bearer sec_live_..." \\<br/>
&nbsp;&nbsp;-H "Content-Type: application/json" \\<br/>
&nbsp;&nbsp;-d '{"amount": "150.00", "currency": "USD", "settlement": {"target_instrument": "ondo_usdy"}}'
    </div>
    `
        : ""
    }

    <p style="margin-top: 20px;">
      Need any assistance or custom provider configuration? Our team of payment engineering specialists is available around the clock.
    </p>
  `;

  const html = renderBaseTemplate({
    previewText: "You are now plugged into PayRouta's resilient multi-rail routing gateway.",
    headline: "Never Lose a Payment to Provider Downtime",
    bodyContent,
    ctaText: isDeveloper ? "Explore API Docs" : "Open Merchant Dashboard",
    ctaUrl: isDeveloper ? `${siteUrl}/docs/quickstart` : `${siteUrl}/merchant`,
    secondaryCtaText: "View Interactive Demo",
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
