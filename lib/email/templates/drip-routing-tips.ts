import { greeting, renderBaseTemplate, siteUrl as defaultSite, stripHtmlToText } from "./base";

export interface DripRoutingTipsProps {
  name?: string;
  siteUrl?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

// Onboarding email 2 (day 3): what happens when a processor fails.
export function renderDripRoutingTipsEmail(props: DripRoutingTipsProps): {
  subject: string;
  html: string;
  text: string;
} {
  const { name, siteUrl = defaultSite(), unsubscribeUrl, preferencesUrl } = props;
  const subject = "What happens when a payment processor goes down";

  const bodyContent = `<p>${greeting(name)}</p>
<p>Every processor has outages and maintenance windows. Here's what PayRouta does when one of them can't take a payment:</p>
<ul>
  <li>Each payment method can have more than one processor behind it. If the first one can't start the payment, we send it to the next one for the same method.</li>
  <li>We never change how your customer chose to pay. A card payment is retried as a card payment, never switched to something else.</li>
  <li>A timeout doesn't count as a failure. We check with the first processor before trying another, so nobody is charged twice.</li>
</ul>
<p>You can watch it happen: in the sandbox, create a payment with <code>scenario: "fallback"</code> and the first processor will refuse it, so it goes through the backup instead.</p>`;

  const html = renderBaseTemplate({
    previewText: "Backups for every payment method, without charging anyone twice.",
    headline: subject,
    bodyContent,
    ctaText: "Try it in the sandbox",
    ctaUrl: `${siteUrl}/merchant`,
    secondaryCtaText: "How it works",
    secondaryCtaUrl: `${siteUrl}/how-it-works`,
    unsubscribeUrl,
    preferencesUrl,
  });
  return { subject, html, text: stripHtmlToText(html) };
}
