// The provider workspace frame, matching the merchant dashboard: a quiet
// sidebar, a top bar with the sandbox switch, and a page header with tabs.
import { themeScript } from "./theme-script";
import { ThemeToggle } from "./theme-toggle";
import { StepUpProvider } from "./step-up";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  Activity,
  ArrowLeftRight,
  BookOpen,
  Check,
  ChevronsUpDown,
  ClipboardCheck,
  CreditCard,
  House,
  Landmark,
  Plug,
  Settings,
  ShieldCheck,
} from "lucide-react";
import { allowedRoute } from "@/lib/portal/domain";
import { SignOutButton } from "./sign-out";
import { NavToggle } from "./nav-toggle";
import { docsUrl } from "@/lib/site-config";

type Item = { label: string; path: string; icon: ReactNode; also?: string[] };
type Tab = { label: string; path: string };
const s = 16;

const applicationTabs: Tab[] = [
  { label: "Checklist", path: "onboarding" },
  { label: "Company", path: "onboarding/company" },
  { label: "Coverage", path: "onboarding/coverage" },
  { label: "Payment methods", path: "onboarding/capabilities" },
  { label: "Settlement", path: "onboarding/settlement" },
  { label: "Documents", path: "onboarding/compliance" },
  { label: "Connection", path: "onboarding/integration" },
  { label: "Submit", path: "onboarding/review" },
  { label: "Review status", path: "application" },
];
const connectionTabs: Tab[] = [
  { label: "Setup", path: "integration" },
  { label: "API credentials", path: "integration/credentials" },
  { label: "Sandbox tests", path: "sandbox" },
  { label: "Events", path: "integration/events" },
  { label: "Status", path: "availability" },
];
const settingsTabs: Tab[] = [
  { label: "Account", path: "settings" },
  { label: "Team", path: "team" },
  { label: "Audit log", path: "audit-log" },
];
const tabSets = [applicationTabs, connectionTabs, settingsTabs];

const main: Item[] = [
  { label: "Home", path: "overview", icon: <House size={s} /> },
  { label: "Transactions", path: "transactions", icon: <ArrowLeftRight size={s} /> },
  { label: "Settlements", path: "settlements", icon: <Landmark size={s} /> },
  { label: "Reliability", path: "performance", icon: <Activity size={s} /> },
];
const setup: Item[] = [
  { label: "Payment methods", path: "capabilities", icon: <CreditCard size={s} /> },
  { label: "Connection", path: "integration", icon: <Plug size={s} />, also: connectionTabs.map((t) => t.path) },
];
const application: Item[] = [
  { label: "Application", path: "onboarding", icon: <ClipboardCheck size={s} />, also: applicationTabs.map((t) => t.path) },
];
const bottom: Item[] = [
  { label: "Settings", path: "settings", icon: <Settings size={s} />, also: settingsTabs.map((t) => t.path) },
];

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "P";

export function ProviderShell({
  route,
  role,
  org,
  orgs,
  environment,
  email,
  internalRole,
  merchantLink,
  title,
  actions,
  backLink,
  children,
}: {
  route: string;
  role: string;
  org: { id: string; name: string };
  orgs: { id: string; name: string }[];
  environment: string;
  email: string;
  internalRole?: string | null;
  merchantLink: boolean;
  title: ReactNode;
  actions?: ReactNode;
  backLink?: { href: string; label: string };
  children: ReactNode;
}) {
  const test = environment !== "production";
  const href = (path: string, env = environment) =>
    `/provider/${path}?${new URLSearchParams({ org: org.id, env })}`;
  const section = route.startsWith("transactions/") ? "transactions" : route;
  const link = (item: Item) => {
    if (!allowedRoute(role, item.path)) {
      // Roles without the section's first page still reach the pages they can use.
      const first = item.also?.find((p) => allowedRoute(role, p));
      if (!first) return null;
      item = { ...item, path: first };
    }
    const active = section === item.path || !!item.also?.includes(section);
    return (
      <li key={item.label}>
        <Link href={href(item.path)} className={active ? "active" : undefined} aria-current={active ? "page" : undefined}>
          {item.icon}
          {item.label}
        </Link>
      </li>
    );
  };
  const tabs = tabSets.find((set) => set.some((t) => t.path === section))?.filter((t) => allowedRoute(role, t.path));
  return (
    <div className={`portal ms-app${test ? " is-test" : ""}`} id="ms-app">
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <aside className="ms-side" id="ms-side">
        <div className="ms-side-in">
        <details className="ms-org">
          <summary>
            <span className="ms-org-mark" aria-hidden>
              {initials(org.name)}
            </span>
            <span className="ms-org-name">{org.name}</span>
            <ChevronsUpDown size={14} aria-hidden />
          </summary>
          <div className="ms-org-menu">
            <p className="ms-menu-label">Provider organizations</p>
            <ul>
              {orgs.map((o) => (
                <li key={o.id}>
                  <Link href={`/provider/overview?${new URLSearchParams({ org: o.id, env: environment })}`}>
                    <span className="ms-org-mark small" aria-hidden>
                      {initials(o.name)}
                    </span>
                    <span>{o.name}</span>
                    {o.id === org.id && <Check size={14} aria-label="Current" />}
                  </Link>
                </li>
              ))}
            </ul>
            {(merchantLink || internalRole) && <hr />}
            {merchantLink && <Link href="/merchant/overview">Merchant dashboard</Link>}
            {internalRole && <Link href="/ops/applications">Operations console</Link>}
          </div>
        </details>
        <nav aria-label="Provider workspace">
          <ul>{main.map(link)}</ul>
          <p className="ms-nav-label">Setup</p>
          <ul>{setup.map(link)}</ul>
          <ul>{application.map(link)}</ul>
          <ul className="ms-nav-bottom">{bottom.map(link)}</ul>
        </nav>
        <div className="ms-user">
          <span className="ms-user-email" title={email}>
            {email}
          </span>
          <SignOutButton className="ms-signout" to="/provider/sign-in" />
        </div>
        </div>
      </aside>
      <div className="ms-main">
        <header className="ms-top">
          <NavToggle />
          <Link className="ms-top-org" href={href("overview")}>
            {org.name}
          </Link>
          <span className="pv-tag">
            <ShieldCheck size={13} aria-hidden /> Provider
          </span>
          <div className="ms-top-right">
            <a className="ms-top-link" href={docsUrl("provider-integration")}>
              <BookOpen size={15} aria-hidden /> Docs
            </a>
            <ThemeToggle />
            <Link
              className="ms-switch"
              role="switch"
              aria-checked={test}
              href={href(route, test ? "production" : "sandbox")}
            >
              <span className="ms-switch-track" aria-hidden>
                <span />
              </span>
              Sandbox
            </Link>
          </div>
        </header>
        {test && (
          <div className="ms-testband" role="note">
            <span>Sandbox</span> Fictional scenarios and records. Nothing here reaches merchants or moves money.
          </div>
        )}
        <div className="ms-content">
          {backLink && (
            <Link className="ms-back" href={backLink.href}>
              ← {backLink.label}
            </Link>
          )}
          <div className="ms-page-head">
            <h1>{title}</h1>
            {actions && <div className="ms-page-actions">{actions}</div>}
          </div>
          {tabs && tabs.length > 1 && (
            <nav className="ms-tabs" aria-label="Section pages">
              {tabs.map((t) => (
                <Link key={t.path} href={href(t.path)} aria-current={t.path === section ? "page" : undefined}>
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="ms-body">
            <StepUpProvider securityHref="/provider/settings">{children}</StepUpProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
