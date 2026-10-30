// Public documentation lives on Mintlify (mintlify/). Each in-app docs slug
// (content/docs) maps to its page there.
export const docsOrigin = "https://docs.payrouta.com";
const docsPages: Record<string, string> = {
  overview: "",
  quickstart: "quickstart",
  "payment-links": "guides/payment-links",
  "checkout-button": "guides/checkout-button",
  credit: "guides/credit",
  "crypto-payments": "guides/crypto-payments",
  "cross-chain": "guides/cross-chain",
  "near-intents": "guides/near-intents",
  "payment-methods": "concepts/payment-methods",
  "payment-intents": "concepts/payment-intents",
  settlement: "concepts/settlement",
  billing: "concepts/billing",
  "provider-accounts": "concepts/provider-accounts",
  webhooks: "integrate/webhooks",
  sdks: "integrate/sdks",
  errors: "integrate/errors",
  shopify: "platforms/shopify",
  woocommerce: "platforms/woocommerce",
  "api-reference": "api-reference/introduction",
  "provider-integration": "partners/provider-integration",
  "provider-coverage": "partners/provider-coverage",
};
export function docsUrl(slug: keyof typeof docsPages | (string & {}) = "overview") {
  const page = docsPages[slug] ?? slug;
  return page ? `${docsOrigin}/${page}` : docsOrigin;
}

export const paths = {
  home: "/",
  paymentLinks: "/payment-links",
  checkout: "/checkout-button",
  integrations: "/integrations",
  paymentMethods: "/payment-methods",
  credit: "/credit",
  crypto: "/crypto",
  socialSellers: "/solutions/social-sellers",
  onlineStores: "/solutions/online-stores",
  saas: "/solutions/saas",
  pricing: "/pricing",
  partners: "/partners",
  contact: "/contact",
  signIn: "/sign-in",
  signUp: "/sign-up",
  dashboard: "/merchant/overview",
  terms: "/terms",
  privacy: "/privacy",
} as const;
export type CanonicalPath = (typeof paths)[keyof typeof paths];

// Pages rendered by app/[...path] from components/marketing/pages.tsx.
export const marketingPaths = {
  "payment-links": paths.paymentLinks,
  checkout: paths.checkout,
  integrations: paths.integrations,
  "payment-methods": paths.paymentMethods,
  credit: paths.credit,
  crypto: paths.crypto,
  "social-sellers": paths.socialSellers,
  "online-stores": paths.onlineStores,
  saas: paths.saas,
  pricing: paths.pricing,
  partners: paths.partners,
} as const;

// The header, modelled on Ramp and Lemon Squeezy: a few menus of described
// links, then plain links. Every entry is its own page (docs open on the
// docs site). Icons are lucide-react names, mapped in components/navigation.
export type NavItem = { href: string; label: string; description: string; icon: string };
export type NavMenu = {
  label: string;
  groups: { title: string; items: NavItem[] }[];
  feature: { href: string; kicker: string; title: string; text: string; cta: string };
};
export const navMenus: NavMenu[] = [
  {
    label: "Platform",
    groups: [
      {
        title: "Get paid",
        items: [
          { href: paths.paymentLinks, label: "Payment links", description: "Sell anywhere you can share a link", icon: "Link2" },
          { href: paths.checkout, label: "Checkout button", description: "One button for your site or app", icon: "MousePointerClick" },
          { href: paths.integrations, label: "Integrations", description: "Shopify, WooCommerce and your server", icon: "Blocks" },
        ],
      },
      {
        title: "Ways to pay",
        items: [
          { href: paths.paymentMethods, label: "Payment methods", description: "Cards, bank, mobile money and wallets", icon: "Globe" },
          { href: paths.credit, label: "Pay with credit", description: "Instalments from licensed lenders", icon: "CalendarClock" },
          { href: paths.crypto, label: "Crypto payments", description: "Any wallet, any chain, paid in stablecoins", icon: "Coins" },
        ],
      },
    ],
    feature: {
      href: "/sign-up",
      kicker: "Test mode is free",
      title: "Take your first test payment today",
      text: "Create an account, make a payment link and pay it yourself. No card or contract needed.",
      cta: "Create an account",
    },
  },
  {
    label: "Solutions",
    groups: [
      {
        title: "By business",
        items: [
          { href: paths.socialSellers, label: "Social sellers", description: "Sell on WhatsApp and Instagram", icon: "MessageCircle" },
          { href: paths.onlineStores, label: "Online stores", description: "Local ways to pay at your checkout", icon: "Store" },
          { href: paths.saas, label: "SaaS and digital", description: "Sell worldwide, priced locally", icon: "AppWindow" },
        ],
      },
      {
        title: "By region",
        items: [
          { href: `${paths.paymentMethods}#africa`, label: "Africa", description: "Cards, bank, USSD, M-Pesa, MoMo", icon: "MapPin" },
          { href: `${paths.paymentMethods}#latin-america`, label: "Latin America", description: "Pix, local cards and wallets", icon: "MapPin" },
          { href: `${paths.paymentMethods}#asia`, label: "Asia", description: "Cards, bank transfer, local wallets", icon: "MapPin" },
          { href: `${paths.paymentMethods}#europe`, label: "Europe and the UK", description: "Cards, Apple Pay, pay by bank", icon: "MapPin" },
        ],
      },
    ],
    feature: {
      href: paths.credit,
      kicker: "Only on PayRouta",
      title: "Let customers pay over time",
      text: "Most people in the world don't have a credit card. Credit at checkout lets them buy; you're paid in full.",
      cta: "How credit works",
    },
  },
  {
    label: "Resources",
    groups: [
      {
        title: "Developers",
        items: [
          { href: `${docsOrigin}/quickstart`, label: "Quickstart", description: "A test payment in ten minutes", icon: "Rocket" },
          { href: `${docsOrigin}/api-reference/introduction`, label: "API reference", description: "Checkouts, payments, refunds", icon: "Braces" },
          { href: `${docsOrigin}/integrate/webhooks`, label: "Webhooks", description: "Signed events for every payment", icon: "Webhook" },
          { href: `${docsOrigin}/integrate/sdks`, label: "SDKs", description: "Node and Python libraries", icon: "Package" },
        ],
      },
      {
        title: "Company",
        items: [
          { href: paths.contact, label: "Contact us", description: "A person reads every message", icon: "Mail" },
          { href: paths.partners, label: "Partners", description: "For payment providers and lenders", icon: "Handshake" },
          { href: paths.terms, label: "Legal", description: "Terms of service and privacy", icon: "Scale" },
        ],
      },
    ],
    feature: {
      href: docsOrigin,
      kicker: "Documentation",
      title: "Everything you need to build",
      text: "Guides for payment links, the checkout button, credit, crypto and store plugins.",
      cta: "Read the docs",
    },
  },
];
export const navLinks = [[paths.pricing, "Pricing"]] as const satisfies readonly (readonly [string, string])[];

// Where "Create a payment link" sends a new merchant after sign-up.
export const createLinkHref = `${paths.signUp}?next=${encodeURIComponent("/merchant/payment-links")}`;

export const footerColumns = [
  {
    title: "Platform",
    links: [
      [paths.paymentLinks, "Payment links"],
      [paths.checkout, "Checkout button"],
      [paths.integrations, "Integrations"],
      [paths.paymentMethods, "Payment methods"],
      [paths.credit, "Pay with credit"],
      [paths.crypto, "Crypto payments"],
      [paths.pricing, "Pricing"],
    ],
  },
  {
    title: "Solutions",
    links: [
      [paths.socialSellers, "Social sellers"],
      [paths.onlineStores, "Online stores"],
      [paths.saas, "SaaS and digital"],
    ],
  },
  {
    title: "Developers",
    links: [
      [docsUrl("overview"), "Documentation"],
      [docsUrl("quickstart"), "Quickstart"],
      [docsUrl("api-reference"), "API reference"],
      [docsUrl("webhooks"), "Webhooks"],
    ],
  },
  {
    title: "Company",
    links: [
      [paths.partners, "Partners"],
      [paths.contact, "Contact"],
      [paths.terms, "Terms"],
      [paths.privacy, "Privacy"],
    ],
  },
] as const satisfies readonly { title: string; links: readonly (readonly [string, string])[] }[];

export const primaryRoutes = [
  [paths.home, "Home"],
  [paths.paymentLinks, "Payment links"],
  [paths.checkout, "Checkout button"],
  [paths.integrations, "Integrations"],
  [paths.paymentMethods, "Payment methods"],
  [paths.credit, "Pay with credit"],
  [paths.crypto, "Crypto payments"],
  [paths.socialSellers, "Social sellers"],
  [paths.onlineStores, "Online stores"],
  [paths.saas, "SaaS and digital"],
  [paths.pricing, "Pricing"],
  [paths.partners, "For providers and lenders"],
  [paths.contact, "Contact"],
  [paths.terms, "Terms of Service"],
  [paths.privacy, "Privacy Policy"],
] as const;

// Old URLs keep working. Their content now lives on the front page or in
// the docs.
export const legacyRedirects = [
  { source: "/how-it-works", destination: paths.home, permanent: true },
  { source: "/developers", destination: paths.integrations, permanent: true },
  { source: "/about", destination: paths.home, permanent: true },
  { source: "/platform/payment-flow", destination: paths.home, permanent: true },
  { source: "/platform/provider-routing", destination: paths.home, permanent: true },
  { source: "/platform/settlement", destination: paths.home, permanent: true },
  { source: "/platform/payment-methods", destination: paths.paymentMethods, permanent: true },
  { source: "/solutions/merchants", destination: paths.onlineStores, permanent: true },
  { source: "/solutions/use-cases", destination: paths.home, permanent: true },
  { source: "/solutions/providers", destination: paths.partners, permanent: true },
  { source: "/merchants", destination: paths.home, permanent: true },
  { source: "/use-cases", destination: paths.home, permanent: true },
  { source: "/providers", destination: paths.partners, permanent: true },
];
export function trustedOrigin() {
  try {
    const u = new URL(process.env.SITE_URL || "");
    return u.protocol === "https:" && !u.username && !u.password
      ? u.origin
      : undefined;
  } catch {
    return undefined;
  }
}
