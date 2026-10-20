"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandLogo } from "./brand-logo";
import { navLinks, paths } from "@/lib/site-config";

export function Navigation() {
  const path = usePathname();
  return (
    <header className="mk-header">
      <div className="mk-wrap mk-header-row">
        <Link href="/" aria-label="PayRouta home" className="mk-logo">
          <BrandLogo />
        </Link>
        <nav aria-label="Main navigation" className="mk-nav">
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
          <Link className="mk-btn primary" href={paths.signUp}>
            Start
          </Link>
        </nav>
      </div>
    </header>
  );
}
