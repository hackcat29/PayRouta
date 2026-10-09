import { renderBaseTemplate, stripHtmlToText } from "./base";

export interface MarketingBroadcastProps {
  headline: string;
  previewText?: string;
  bodyHtml: string;
  ctaText?: string;
  ctaUrl?: string;
  secondaryCtaText?: string;
  secondaryCtaUrl?: string;
  siteUrl?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
}

export function renderMarketingBroadcastEmail(props: MarketingBroadcastProps): {
  html: string;
  text: string;
} {
  const {
    headline,
    previewText,
    bodyHtml,
    ctaText,
    ctaUrl,
    secondaryCtaText,
    secondaryCtaUrl,
    unsubscribeUrl,
    preferencesUrl,
  } = props;

  const html = renderBaseTemplate({
    previewText: previewText || headline,
    headline,
    bodyContent: bodyHtml,
    ctaText,
    ctaUrl,
    secondaryCtaText,
    secondaryCtaUrl,
    unsubscribeUrl,
    preferencesUrl,
  });

  return {
    html,
    text: stripHtmlToText(html),
  };
}
