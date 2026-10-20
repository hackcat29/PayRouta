"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./brand-logo";
import { createLinkHref, navLinks, navSections, paths } from "@/lib/site-config";

export function Navigation() {
  const path = usePathname();
  return (
    <header className="mk-header">
      <div className="mk-wrap mk-header-row">
        <Link href="/" aria-label="PayRouta home" className="mk-logo">
          <BrandLogo />
        </Link>
        <nav aria-label="Main navigation" className="mk-nav">
          {navSections.map(([href, label]) => (
            <Link key={href} href={href} className="mk-nav-link mk-nav-section">
              {label}
            </Link>
          ))}
          {navLinks.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="mk-nav-link"
              aria-current={
                path === href || path.startsWith(href + "/")
                  ? "page"
                  : undefined
              }
            >
              {label}
            </Link>
          ))}
          <Link className="mk-btn soft" href={paths.signIn}>
            Sign in
          </Link>
          <Link className="mk-btn primary" href={createLinkHref}>
            <span className="mk-nav-cta-long">Create a payment link</span>
            <span className="mk-nav-cta-short">Get started</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
