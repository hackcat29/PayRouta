import { greeting, renderBaseTemplate, siteUrl as defaultSite, stripHtmlToText } from "./base";

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
  const { name, role = "merchant", siteUrl = defaultSite(), unsubscribeUrl, preferencesUrl } = props;
  const provider = role === "provider";

  const bodyContent = provider
    ? `<p>${greeting(name)}</p>
<p>Thanks for your interest in working with PayRouta. We'll send you news about the partner programme and changes to the Provider API.</p>
<p>If you'd like to talk about an integration now, reply to this email. It goes to the team, not a ticket queue.</p>`
    : `<p>${greeting(name)}</p>
<p>Thanks for signing up. Here's how to get started:</p>
<ol>
  <li><strong>Create a workspace.</strong> You get test API keys straight away, with no paperwork.</li>
  <li><strong>Make a test payment.</strong> The quickstart takes you from an API key to a paid checkout.</li>
  <li><strong>Apply to go live.</strong> Tell us about your business once. We verify it and set up processing with our partners.</li>
</ol>
<p>If you get stuck, reply to this email. It goes to the team, not a ticket queue.</p>`;

  const html = renderBaseTemplate({
    previewText: provider ? "Thanks for your interest in the partner programme." : "Three steps to your first test payment.",
    headline: "Welcome to PayRouta",
    bodyContent,
    ctaText: provider ? "How the partner programme works" : "Open your dashboard",
    ctaUrl: provider ? `${siteUrl}/solutions/providers` : `${siteUrl}/merchant`,
    secondaryCtaText: provider ? undefined : "Read the quickstart",
    secondaryCtaUrl: provider ? undefined : `${siteUrl}/docs/quickstart`,
    unsubscribeUrl,
    preferencesUrl,
  });
  return { subject: "Welcome to PayRouta", html, text: stripHtmlToText(html) };
}
