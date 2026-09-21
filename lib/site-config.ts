export const paths = {
  home: "/",
  paymentFlow: "/platform/payment-flow",
  paymentMethods: "/platform/payment-methods",
  providerRouting: "/platform/provider-routing",
  settlement: "/platform/settlement",
  merchants: "/solutions/merchants",
  providers: "/solutions/providers",
  useCases: "/solutions/use-cases",
  developers: "/developers",
  pricing: "/pricing",
  about: "/about",
  contact: "/contact",
  docs: "/docs",
  apiReference: "/docs/api-reference",
} as const;
export type CanonicalPath = (typeof paths)[keyof typeof paths];
export const marketingPaths = {
  "payment-flow": paths.paymentFlow,
  "payment-methods": paths.paymentMethods,
  "provider-routing": paths.providerRouting,
  settlement: paths.settlement,
  merchants: paths.merchants,
  providers: paths.providers,
  "use-cases": paths.useCases,
  developers: paths.developers,
  pricing: paths.pricing,
  about: paths.about,
} as const;
export const navigationGroups = [
  {
    title: "Platform",
    links: [
      [paths.paymentFlow, "Payment Flow"],
      [paths.paymentMethods, "Payment Methods"],
      [paths.providerRouting, "Provider Routing"],
      [paths.settlement, "Settlement"],
    ],
  },
  {
    title: "Solutions",
    links: [
      [paths.merchants, "For Merchants"],
      [paths.providers, "For Providers"],
      [paths.useCases, "Use Cases"],
    ],
  },
  {
    title: "Developers",
    links: [
      [paths.developers, "Overview"],
      [paths.docs, "Documentation"],
      [paths.apiReference, "API Reference"],
    ],
  },
  {
    title: "Testing Portals",
    links: [
      ["/merchant", "Merchant Portal"],
      ["/provider/sign-in", "Provider Login"],
      ["/ops", "Operations Dashboard"],
      ["/checkout/test_sess_123", "Checkout Demo"],
    ] as any, // Typecast to bypass CanonicalPath strictness for these testing routes
  },
] as const satisfies readonly {
  title: string;
  links: readonly (readonly [CanonicalPath, string])[];
}[];
export const primaryRoutes = [
  [paths.home, "Home"],
  ...navigationGroups[0].links,
  ...navigationGroups[1].links,
  [paths.developers, "Developers"],
  [paths.docs, "Documentation"],
  [paths.pricing, "Pricing"],
  [paths.about, "About"],
  [paths.contact, "Contact"],
] as const;
export const legacyRedirects = [
  { source: "/how-it-works", destination: paths.paymentFlow, permanent: true },
  {
    source: "/payment-methods",
    destination: paths.paymentMethods,
    permanent: true,
  },
  { source: "/merchants", destination: paths.merchants, permanent: true },
  { source: "/providers", destination: paths.providers, permanent: true },
  { source: "/use-cases", destination: paths.useCases, permanent: true },
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
export const intentExample = JSON.stringify(
  {
    amount: "1200.00",
    currency: "USD",
    payer_context: { country: "BR" },
    settlement: {
      currency: "USD",
      target_instrument: "ondo_usdy",
    },
    accepted_methods: [
      "instant_bank",
      "digital_wallet",
      "card",
      "direct_debit",
      "cash_voucher",
      "bnpl",
      "mobile_money",
      "stablecoin",
      "crypto_app",
      "rwa",
      "native_crypto",
    ],
  },
  null,
  2,
);
