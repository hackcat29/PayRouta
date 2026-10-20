import Link from "next/link";
import { BrandLogo } from "./brand-logo";
import { footerColumns, paths } from "@/lib/site-config";
import { NewsletterSignup } from "./marketing/newsletter-signup";

export function Footer() {
  return (
    <footer className="mk-footer">
      <div className="mk-wrap">
        <div className="mk-letter">
          <h2>
            The monthly letter.
            <br />
            <span className="mk-dim">What shipped, and what&apos;s next.</span>
          </h2>
          <NewsletterSignup />
        </div>
        <div className="mk-footer-grid">
          <div className="mk-footer-box mk-footer-brand">
            <BrandLogo />
          </div>
          <nav aria-label="Footer" className="mk-footer-nav">
            {footerColumns.map((c) => (
              <div className="mk-footer-box" key={c.title}>
                <h2>{c.title}</h2>
                <ul>
                  {c.links.map(([h, t]) => (
                    <li key={h}>
                      <Link href={h}>{t}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mk-footer-bottom">
          <span>
            © {new Date().getFullYear()} Routa Solutions. PayRouta is a service
            of Routa Solutions.
          </span>
          <span className="mk-footer-legal">
            <Link href={paths.privacy}>Privacy</Link>
            <Link href={paths.terms}>Terms</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}
