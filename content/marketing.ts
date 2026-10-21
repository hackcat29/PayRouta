// Titles and summaries for the pages in lib/site-config marketingPaths. The
// summary doubles as the meta description.
export const pages = {
  "payment-links": {
    title: "Payment links",
    intro:
      "Get paid without a website. Create a link in your dashboard and share it on WhatsApp, Instagram, by SMS or on an invoice. Every customer who opens it gets their own checkout.",
  },
  checkout: {
    title: "Checkout button",
    intro:
      "Add one button to your site, app or store. Customers see the ways to pay that work where they are, and you get one payment record whatever they chose.",
  },
  integrations: {
    title: "Integrations",
    intro:
      "Take PayRouta wherever you sell: one script tag on any website, Node and Python SDKs on your server, and plugins for Shopify and WooCommerce.",
  },
  "payment-methods": {
    title: "Payment methods",
    intro:
      "The ways customers pay, region by region: cards and wallets worldwide, bank transfers, mobile money and USSD where that's how people pay, credit as lenders join, and stablecoins everywhere.",
  },
  credit: {
    title: "Pay with credit",
    intro:
      "Let customers who can't pay all at once spread the cost with a licensed lender, inside your checkout. You're paid in full; the lender collects the instalments and carries the risk.",
  },
  crypto: {
    title: "Crypto payments",
    intro:
      "Customers pay from whatever wallet and chain they hold. You receive exactly the stablecoin you chose, in your own wallet. 1.5% all in.",
  },
  "social-sellers": {
    title: "For social sellers",
    intro:
      "Sell on WhatsApp, Instagram and TikTok without a website. Send a payment link and your customer pays by bank transfer, USSD, mobile money, card or crypto.",
  },
  "online-stores": {
    title: "For online stores",
    intro:
      "Offer the ways your customers actually pay at your store's checkout, with a backup partner when one fails and one record of every payment.",
  },
  saas: {
    title: "For SaaS and digital products",
    intro:
      "Sell worldwide and let each customer pay the way that works where they are: cards and wallets, local bank transfers, stablecoins, or a yearly plan repaid monthly.",
  },
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
