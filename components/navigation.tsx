"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AppWindow,
  Blocks,
  Bot,
  Braces,
  CalendarClock,
  ChevronDown,
  Coins,
  Globe,
  Handshake,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  MousePointerClick,
  Package,
  Rocket,
  Scale,
  Store,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { navLinks, navMenus, paths, type NavMenu } from "@/lib/site-config";

const icons: Record<string, LucideIcon> = {
  AppWindow,
  Blocks,
  Bot,
  Braces,
  CalendarClock,
  Coins,
  Globe,
  Handshake,
  Link2,
  Mail,
  MapPin,
  MessageCircle,
  MousePointerClick,
  Package,
  Rocket,
  Scale,
  Store,
  Webhook,
};

// Whether someone is signed in, so the header offers the dashboard instead
// of sign-in. Unknown until the session check answers; the slot keeps its
// width meanwhile so the header doesn't jump.
function useSignedIn() {
  const [state, setState] = useState<"unknown" | "in" | "out">("unknown");
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/get-session", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => alive && setState(s?.session ? "in" : "out"))
      .catch(() => alive && setState("out"));
    return () => {
      alive = false;
    };
  }, []);
  return state;
}

function Account({ state }: { state: ReturnType<typeof useSignedIn> }) {
  if (state === "in")
    return (
      <Link className="mk-btn primary" href={paths.dashboard}>
        Dashboard
      </Link>
    );
  return (
    <>
      <Link className="mk-btn soft" href={paths.signIn} data-hidden={state === "unknown" || undefined}>
        Sign in
      </Link>
      <Link className="mk-btn primary" href={paths.signUp} data-hidden={state === "unknown" || undefined}>
        Get started
      </Link>
    </>
  );
}

function Go({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return href.startsWith("http") ? (
    <a className={className} href={href}>
      {children}
    </a>
  ) : (
    <Link className={className} href={href}>
      {children}
    </Link>
  );
}

// The links of one menu: described items in groups, then a featured card.
function MenuPanel({ menu }: { menu: NavMenu }) {
  return (
    <div className="mk-mega-grid">
      {menu.groups.map((g) => (
        <div key={g.title} className="mk-mega-group">
          <p className="mk-mega-title">{g.title}</p>
          <ul>
            {g.items.map((item) => {
              const Icon = icons[item.icon];
              return (
                <li key={item.href}>
                  <Go href={item.href} className="mk-mega-item">
                    <span className="mk-mega-icon" aria-hidden="true">
                      {Icon && <Icon size={18} strokeWidth={1.75} />}
                    </span>
                    <b>{item.label}</b>
                  </Go>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <Go href={menu.feature.href} className="mk-mega-feature">
        <b>{menu.feature.title}</b>
        <span className="hp-more">
          {menu.feature.cta} <span aria-hidden="true">→</span>
        </span>
      </Go>
    </div>
  );
}

export function Navigation() {
  const path = usePathname();
  const signedIn = useSignedIn();
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [section, setSection] = useState<string | null>(null);
  const header = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close menus on navigation.
  const [seen, setSeen] = useState(path);
  if (seen !== path) {
    setSeen(path);
    setOpen(null);
    setSheet(false);
  }

  useEffect(() => {
    if (!open && !sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const was = open;
      setOpen(null);
      setSheet(false);
      if (was) header.current?.querySelector<HTMLButtonElement>(`[data-menu="${was}"]`)?.focus();
    };
    const onDown = (e: PointerEvent) => {
      if (!header.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    if (sheet) document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      document.body.style.overflow = "";
    };
  }, [open, sheet]);

  // Hover opens a menu on devices that hover; a short delay on leave lets
  // the pointer cross the gap between the button and the panel.
  const hover = (label: string | null) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(label), label ? 60 : 140);
  };
  const active = navMenus.find((m) => m.label === open);
  const closeOnLink = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("a")) {
      setOpen(null);
      setSheet(false);
    }
  };

  return (
    <header
      ref={header}
      className="mk-header"
      data-open={sheet || undefined}
      data-menu-open={open ? "" : undefined}
      onPointerLeave={(e) => e.pointerType === "mouse" && hover(null)}
    >
      <div className="mk-wrap mk-header-row">
        <Link href="/" aria-label="PayRouta home" className="mk-logo">
          <BrandLogo />
        </Link>
        <nav aria-label="Main navigation" className="mk-nav">
          {navMenus.map((m) => (
            <button
              key={m.label}
              type="button"
              className="mk-nav-link mk-nav-menu"
              data-menu={m.label}
              aria-expanded={open === m.label}
              aria-controls="mk-mega"
              onClick={() => setOpen(open === m.label ? null : m.label)}
              onPointerEnter={(e) => e.pointerType === "mouse" && hover(m.label)}
            >
              {m.label}
              <ChevronDown size={15} aria-hidden="true" />
            </button>
          ))}
          {navLinks.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className="mk-nav-link"
              aria-current={path === href ? "page" : undefined}
              onPointerEnter={(e) => e.pointerType === "mouse" && hover(null)}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="mk-account">
          <Account state={signedIn} />
        </div>
        <button
          type="button"
          className="mk-menu-btn"
          aria-expanded={sheet}
          aria-controls="mk-menu"
          aria-label={sheet ? "Close menu" : "Open menu"}
          onClick={() => setSheet(!sheet)}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      {active && (
        <div id="mk-mega" className="mk-mega" role="region" aria-label={active.label} onClick={closeOnLink}>
          <div className="mk-wrap">
            <MenuPanel menu={active} />
          </div>
        </div>
      )}
      {sheet && (
        <div id="mk-menu" className="mk-menu" onClick={closeOnLink}>
          <nav aria-label="Menu" className="mk-menu-links">
            {navMenus.map((m) => (
              <div key={m.label} className="mk-menu-section">
                <button
                  type="button"
                  className="mk-nav-link mk-menu-toggle"
                  aria-expanded={section === m.label}
                  onClick={() => setSection(section === m.label ? null : m.label)}
                >
                  {m.label}
                  <ChevronDown size={20} aria-hidden="true" />
                </button>
                {section === m.label && <MenuPanel menu={m} />}
              </div>
            ))}
            {navLinks.map(([href, label]) => (
              <Link key={href} href={href} className="mk-nav-link" aria-current={path === href ? "page" : undefined}>
                {label}
              </Link>
            ))}
          </nav>
          <div className="mk-menu-account">
            <Account state={signedIn} />
          </div>
        </div>
      )}
    </header>
  );
}
