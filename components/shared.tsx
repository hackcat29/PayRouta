import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { createLinkHref, footerColumns, paths } from "@/lib/site-config";
import { NewsletterSignup } from "./marketing/newsletter-signup";

export function Footer() {
  return (
    <footer className="mk-footer">
      <div className="mk-wrap">
        <div className="mk-footer-cta">
          <h2>Start with one link. Add the button when you&apos;re ready.</h2>
          <Link className="mk-btn primary" href={createLinkHref}>
            Create a payment link
          </Link>
        </div>
        <div className="mk-footer-grid">
          <div className="mk-footer-brand">
            <BrandLogo reverse />
            <p>One checkout for every way the world pays.</p>
            <div className="mk-letter">
              <h2>The monthly letter</h2>
              <p>What shipped, and what&apos;s next.</p>
              <NewsletterSignup />
            </div>
          </div>
          <nav aria-label="Footer" className="mk-footer-nav">
            {footerColumns.map((c) => (
              <div key={c.title}>
                <h2>{c.title}</h2>
                <ul>
                  {c.links.map(([h, t]) => (
                    <li key={h}>{h.startsWith("http") ? <a href={h}>{t}</a> : <Link href={h}>{t}</Link>}</li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mk-footer-bottom">
          <span>© {new Date().getFullYear()} Routa Solutions. PayRouta is a service of Routa Solutions.</span>
          <span className="mk-footer-legal">
            <Link href={paths.privacy}>Privacy</Link>
            <Link href={paths.terms}>Terms</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
