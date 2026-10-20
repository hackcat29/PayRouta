import { greeting, renderBaseTemplate, siteUrl as defaultSite, stripHtmlToText } from "./base";

export interface DripSettlementProps {
  name?: string;
  siteUrl?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

// Onboarding email 3 (day 7): how money reaches the merchant.
export function renderDripSettlementEmail(props: DripSettlementProps): {
  subject: string;
  html: string;
  text: string;
} {
  const { name, siteUrl = defaultSite(), unsubscribeUrl, preferencesUrl } = props;
  const subject = "How you get paid with PayRouta";

  const bodyContent = `<p>${greeting(name)}</p>
<p>A quick guide to where your money goes after a customer pays:</p>
<ul>
  <li><strong>Your balance.</strong> Card, bank and mobile money payments go into your PayRouta balance. The money is held by our licensed processing partners, not in PayRouta's own bank accounts.</li>
  <li><strong>Payouts.</strong> We pay your balance to your bank account daily, weekly or monthly, whichever you choose.</li>
  <li><strong>Reserves.</strong> Some businesses have a small share of each payment held for a set period to cover refunds and chargebacks. If that applies to you, we'll tell you before you go live.</li>
  <li><strong>Stablecoins and crypto.</strong> These payments go straight to a wallet you control. We never hold them.</li>
</ul>
<p>Every payment, fee, refund and payout is in one ledger in your dashboard, and you can export it as CSV.</p>`;

  const html = renderBaseTemplate({
    previewText: "Balances, payouts and reserves, explained.",
    headline: subject,
    bodyContent,
    ctaText: "Read about payouts",
    ctaUrl: `${siteUrl}/docs/settlement`,
    unsubscribeUrl,
    preferencesUrl,
  });
  return { subject, html, text: stripHtmlToText(html) };
}
