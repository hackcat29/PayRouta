"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import {
  ArrowRight,
  CaretDown,
  List,
  X,
  FlowArrow,
  SquaresFour,
  GitFork,
  Scales,
  Storefront,
  Buildings,
  Lightbulb,
  Terminal,
  BookOpenText,
  BracketsCurly,
  type Icon,
} from "@phosphor-icons/react";
import { BrandLogo } from "./brand-logo";
import { navigationGroups, paths } from "@/lib/site-config";

const meta: Record<string, { icon: Icon; blurb: string }> = {
  [paths.paymentFlow]: { icon: FlowArrow, blurb: "From intent to settlement, step by step" },
  [paths.paymentMethods]: { icon: SquaresFour, blurb: "Cards, bank, mobile money, wallets, stablecoins" },
  [paths.providerRouting]: { icon: GitFork, blurb: "Same-method failover across providers" },
  [paths.settlement]: { icon: Scales, blurb: "Reconciled across providers, exceptions surfaced" },
  [paths.merchants]: { icon: Storefront, blurb: "Apply once, own every provider account" },
  [paths.providers]: { icon: Buildings, blurb: "Onboard merchants who apply through PayRouta" },
  [paths.useCases]: { icon: Lightbulb, blurb: "SaaS, digital sellers and local merchants" },
  [paths.developers]: { icon: Terminal, blurb: "SDKs, sandbox and signed webhooks" },
  [paths.docs]: { icon: BookOpenText, blurb: "Guides and concepts" },
  [paths.apiReference]: { icon: BracketsCurly, blurb: "Every endpoint, typed" },
};

const features: Record<string, { img: string; title: string; copy: string; href: string }> = {
  Platform: {
    img: "night-market",
    title: "See a failover happen",
    copy: "Watch a payment reroute when its provider goes down.",
    href: paths.providerRouting,
  },
  Solutions: {
    img: "boutique-seller",
    title: "Sell to the world",
    copy: "Provider accounts in your name, one integration.",
    href: paths.merchants,
  },
  Developers: {
    img: "dev-team",
    title: "Ship your first payment",
    copy: "Sandbox keys, simulated outages, signed webhooks.",
    href: "/docs/quickstart",
  },
};

export function Navigation() {
  const path = usePathname();
  return <Nav key={path} />;
}

function Nav() {
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  const root = useRef<HTMLElement>(null);

  return (
    <header
      ref={root}
      className={`mk-nav${mobile ? " open" : ""}`}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(null);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (open) {
          root.current?.querySelector<HTMLButtonElement>(`[data-group="${open}"]`)?.focus();
          setOpen(null);
        } else if (mobile) {
          setMobile(false);
          root.current?.querySelector<HTMLButtonElement>(".mk-nav-toggle")?.focus();
        }
      }}
    >
      <div className="mk-wrap mk-nav-inner">
        <Link href="/" aria-label="PayRouta home">
          <BrandLogo />
        </Link>
        <button
          className="mk-nav-toggle"
          aria-label={mobile ? "Close navigation" : "Open navigation"}
          aria-expanded={mobile}
          aria-controls="main-navigation"
          onClick={() => setMobile(!mobile)}
        >
          {mobile ? <X size={20} /> : <List size={20} />}
        </button>
        <nav id="main-navigation" aria-label="Main navigation" className="mk-nav-links">
          {navigationGroups.map((g) => {
            const f = features[g.title];
            return (
              <div className="mk-nav-group" key={g.title}>
                <button
                  data-group={g.title}
                  aria-expanded={open === g.title}
                  aria-controls={`nav-${g.title}`}
                  onClick={() => setOpen(open === g.title ? null : g.title)}
                >
                  {g.title}
                  <CaretDown size={12} weight="bold" />
                </button>
                {open === g.title && (
                  <div id={`nav-${g.title}`} className="mk-mega">
                    <div className="mk-mega-list">
                      {g.links.map(([url, label]) => {
                        const m = meta[url];
                        const I = m?.icon ?? ArrowRight;
                        return (
                          <Link key={url} href={url} aria-label={label} aria-describedby={m ? `nav-desc-${url}` : undefined}>
                            <span className="mk-mega-icon" aria-hidden="true">
                              <I size={18} weight="bold" />
                            </span>
                            <span>
                              <strong>{label}</strong>
                              {m && <small id={`nav-desc-${url}`}>{m.blurb}</small>}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                    {f && (
                      <Link className="mk-mega-feature" href={f.href} tabIndex={-1} aria-hidden="true">
                        <Image src={`/images/${f.img}.webp`} alt="" fill sizes="240px" unoptimized />
                        <div>
                          <strong>{f.title}</strong>
                          <small>{f.copy}</small>
                        </div>
                      </Link>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          <Link href={paths.pricing}>Pricing</Link>
          <Link href={paths.docs}>Docs</Link>
        </nav>
        <div className="mk-nav-right">
          <Link className="mk-nav-text" href="/provider/sign-in">
            Sign in
          </Link>
          <Link className="mk-btn" href="/merchant">
            Get started <ArrowRight size={14} weight="bold" />
          </Link>
        </div>
      </div>
    </header>
  );
}
