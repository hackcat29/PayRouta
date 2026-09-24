"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowUpRight, ChevronDown, Menu, X, Sparkles } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { navigationGroups, paths } from "@/lib/site-config";

export function Navigation() {
  const path = usePathname();
  return <Nav key={path} dark={path === "/"} />;
}

function Nav({ dark }: { dark: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const root = useRef<HTMLElement>(null);

  return (
    <header
      ref={root}
      className={`header ${dark ? "dark" : ""}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (open) {
            root.current
              ?.querySelector<HTMLButtonElement>(`[data-group="${open}"]`)
              ?.focus();
            setOpen(null);
          } else {
            setMobile(false);
            root.current
              ?.querySelector<HTMLButtonElement>(".mobile-toggle")
              ?.focus();
          }
        }
      }}
    >
      <div className="container nav-inner">
        <Link href="/" aria-label="PayRouta home">
          <BrandLogo reverse={dark} />
        </Link>
        <button
          className="mobile-toggle icon-button"
          aria-label={mobile ? "Close navigation" : "Open navigation"}
          aria-expanded={mobile}
          aria-controls="main-navigation"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X /> : <Menu />}
        </button>
        <nav
          id="main-navigation"
          aria-label="Main navigation"
          className={mobile ? "nav-links mobile-open" : "nav-links"}
        >
          {navigationGroups.map((g) => (
            <div className="nav-group" key={g.title}>
              <button
                data-group={g.title}
                aria-expanded={open === g.title}
                aria-controls={`nav-${g.title}`}
                onClick={() => setOpen(open === g.title ? null : g.title)}
              >
                {g.title}
                <ChevronDown size={14} />
              </button>
              {open === g.title && (
                <div id={`nav-${g.title}`} className="dropdown">
                  {g.links.map(([url, label]) => (
                    <Link key={url} href={url}>
                      {label}
                    </Link>
                  ))}
                  {g.title === "Solutions" && (
                    <>
                      <Link href="/merchant" className="dropdown-highlight">
                        Merchant Dashboard
                      </Link>
                      <Link href="/provider" className="dropdown-highlight">
                        Provider Portal
                      </Link>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          <Link className="demo-nav-link" href="/checkout/demo">
            <Sparkles size={13} className="text-teal" /> Live Checkout Demo
          </Link>

          <Link className="pricing-nav" href={paths.pricing}>
            Pricing
          </Link>

          <Link className="utility-contact" href={paths.docs}>
            Docs
          </Link>

          <Link className="sign-in-nav" href="/provider/sign-in">
            Sign In
          </Link>

          <Link
            className={`button ${dark ? "mint" : ""}`}
            href="/merchant"
          >
            Open Dashboard <ArrowUpRight size={16} />
          </Link>
        </nav>
      </div>
    </header>
  );
}
