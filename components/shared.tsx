import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { navigationGroups, paths } from "@/lib/site-config";
const footerColumns: { title: string; links: readonly (readonly [string, string])[] }[] = [
  { title: "Platform", links: navigationGroups[0].links },
  { title: "Solutions", links: navigationGroups[1].links },
  {
    title: "Developers",
    links: [
      [paths.developers, "Overview"],
      [paths.docs, "Documentation"],
      [paths.apiReference, "API Reference"],
      ["/docs/quickstart", "Quickstart"],
    ],
  },
  {
    title: "Company",
    links: [
      [paths.about, "About"],
      [paths.pricing, "Pricing"],
      [paths.contact, "Contact"],
      ["/provider/sign-in", "Sign in"],
    ],
  },
];
import { NewsletterSignup } from "./marketing/newsletter-signup";

export function Footer() {
  return (
    <footer className="mk-footer">
      <div className="mk-wrap" style={{ paddingBottom: 48 }}>
        <NewsletterSignup variant="footer" />
      </div>
      <div className="mk-wrap mk-footer-top">
        <div>
          <Link href={paths.home} aria-label="PayRouta home">
            <BrandLogo reverse />
          </Link>
          <p>
            The global payment routing layer. Every way the world pays, through
            one integration, with a backup route for every method.
          </p>
        </div>
        {footerColumns.map((c) => (
          <div className="mk-footer-col" key={c.title}>
            <h3>{c.title}</h3>
            {c.links.map(([h, t]) => (
              <Link key={h} href={h}>
                {t}
              </Link>
            ))}
          </div>
        ))}
      </div>
      <div className="mk-wrap mk-footer-bottom" style={{ marginTop: 72, borderTop: "1px solid rgba(255,255,255,0.14)" }}>
        <span>© {new Date().getFullYear()} PayRouta. All rights reserved.</span>
        <span>
          <span className="mk-dot-live" /> Built for merchants and customers everywhere
        </span>
      </div>
    </footer>
  );
}
