export const paths = {
  home: "/",
  pricing: "/pricing",
  partners: "/partners",
  contact: "/contact",
  docs: "/docs",
  quickstart: "/docs/quickstart",
  apiReference: "/docs/api-reference",
  signIn: "/sign-in",
  signUp: "/sign-up",
  terms: "/terms",
  privacy: "/privacy",
} as const;
export type CanonicalPath = (typeof paths)[keyof typeof paths];

// Pages rendered by app/[...path] from components/marketing/pages.tsx.
export const marketingPaths = {
  pricing: paths.pricing,
  partners: paths.partners,
} as const;

// Payment providers join by invitation, so they're reached from the front
// page, the footer and the docs rather than the main navigation.
export const navLinks = [
  [paths.pricing, "Pricing"],
  [paths.docs, "Docs"],
] as const satisfies readonly (readonly [CanonicalPath, string])[];

// Front-page sections named in the header: the two things merchants come for.
export const navSections = [
  ["/#links", "Payment links"],
  ["/#credit", "Pay with credit"],
] as const;

// Where "Create a payment link" sends a new merchant after sign-up.
export const createLinkHref = `${paths.signUp}?next=${encodeURIComponent("/merchant/payment-links")}`;

export const footerColumns = [
  {
    title: "Product",
    links: [
      [paths.pricing, "Pricing"],
      [paths.quickstart, "Quickstart"],
      [paths.apiReference, "API reference"],
      [paths.signUp, "Create an account"],
    ],
  },
  {
    title: "Company",
    links: [
      [paths.partners, "For providers and lenders"],
      [paths.contact, "Contact"],
      [paths.terms, "Terms"],
      [paths.privacy, "Privacy"],
    ],
  },
] as const satisfies readonly { title: string; links: readonly (readonly [string, string])[] }[];

export const primaryRoutes = [
  [paths.home, "Home"],
  [paths.pricing, "Pricing"],
  [paths.partners, "For providers and lenders"],
  [paths.contact, "Contact"],
  [paths.docs, "Documentation"],
  [paths.terms, "Terms of Service"],
  [paths.privacy, "Privacy Policy"],
] as const;

// Old URLs keep working. Their content now lives on the front page or in
// the docs.
export const legacyRedirects = [
  { source: "/how-it-works", destination: paths.home, permanent: true },
  { source: "/payment-methods", destination: paths.home, permanent: true },
  { source: "/developers", destination: paths.docs, permanent: true },
  { source: "/about", destination: paths.home, permanent: true },
  { source: "/platform/payment-flow", destination: paths.home, permanent: true },
  { source: "/platform/provider-routing", destination: paths.home, permanent: true },
  { source: "/platform/settlement", destination: paths.home, permanent: true },
  { source: "/platform/payment-methods", destination: paths.home, permanent: true },
  { source: "/solutions/merchants", destination: paths.home, permanent: true },
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
