// Titles and summaries for the pages in lib/site-config marketingPaths. The
// summary doubles as the meta description.
export const pages = {
  pricing: {
    title: "Pricing",
    intro:
      "1% capped at $5, plus the partner's standard fee, for cards, digital wallets, bank transfers, mobile money, USSD and credit. 1.5% for stablecoins and crypto. Test mode and failed payments are free.",
  },
  partners: {
    title: "For payment providers and lenders",
    intro:
      "Connect your payment service to PayRouta and process payments for the merchants who use us, or lend to their customers at checkout. Access is by invitation: request it below and our partnerships team will review your service.",
  },
} as const;
export type PageSlug = keyof typeof pages;
