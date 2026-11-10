// The merchant dashboard frame: a quiet sidebar, a top bar with the test
// mode switch, and a page header with optional tabs. Patterned on the
// processor dashboards merchants already know (Stripe, Adyen, Paystack).
import { themeScript } from "@/components/portal/theme-script";
import { ThemeToggle } from "@/components/portal/theme-toggle";
import { StepUpProvider } from "@/components/portal/step-up";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  CreditCard,
  House,
  KeyRound,
  Landmark,
  Link2,
  Repeat,
  Settings,
  ShieldAlert,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import { SignOutButton } from "@/components/portal/sign-out";
import { NavToggle } from "@/components/portal/nav-toggle";
import { docsUrl } from "@/lib/site-config";
import { OrgSwitcher } from "./org-switcher";

export const routeTitles = {
  onboarding: "Business setup",
  activation: "Activate payments",
  balances: "Balances",
  "crypto-balance": "Balances",
  disputes: "Disputes",
  overview: "Home",
  payments: "Transactions",
  "payment-links": "Payment links",
  subscriptions: "Subscriptions",
  "payment-methods": "Payment methods",
  providers: "Providers",
  settlements: "Settlements",
  reconciliation: "Payment issues",
  analytics: "Analytics",
  billing: "Billing",
  "developers/api-keys": "API keys",
  "developers/agents": "Agent keys",
  "developers/webhooks": "Webhooks",
  "developers/logs": "API logs",
  "developers/integrations": "Integrations",
  settings: "Settings",
  security: "Security",
  team: "Team",
} as const;
export type MerchantRoute = keyof typeof routeTitles;

type Item = { label: string; path: MerchantRoute; icon: ReactNode; also?: MerchantRoute[] };
const s = 16;
const main: Item[] = [
  { label: "Home", path: "overview", icon: <House size={s} /> },
  { label: "Payment links", path: "payment-links", icon: <Link2 size={s} /> },
  { label: "Subscriptions", path: "subscriptions", icon: <Repeat size={s} /> },
  { label: "Transactions", path: "payments", icon: <ArrowLeftRight size={s} /> },
  { label: "Balances", path: "balances", icon: <Wallet size={s} />, also: ["crypto-balance"] },
  { label: "Disputes", path: "disputes", icon: <ShieldAlert size={s} /> },
];
const setup: Item[] = [
  { label: "Payment methods", path: "payment-methods", icon: <CreditCard size={s} />, also: ["providers"] },
];
const reports: Item[] = [
  { label: "Analytics", path: "analytics", icon: <BarChart3 size={s} /> },
  { label: "Settlements", path: "settlements", icon: <Landmark size={s} /> },
  { label: "Payment issues", path: "reconciliation", icon: <TriangleAlert size={s} /> },
];
const bottom: Item[] = [
  {
    label: "Developers",
    path: "developers/api-keys",
    icon: <KeyRound size={s} />,
    also: ["developers/webhooks", "developers/logs", "developers/integrations"],
  },
  {
    label: "Settings",
    path: "settings",
    icon: <Settings size={s} />,
    also: ["activation", "onboarding", "billing", "team", "security"],
  },
];

// Sections reached through tabs rather than the sidebar.
export const tabSets: Partial<Record<MerchantRoute, { label: string; path: MerchantRoute }[]>> = {};
const developerTabs = [
  { label: "API keys", path: "developers/api-keys" as const },
  { label: "Agent keys", path: "developers/agents" as const },
  { label: "Webhooks", path: "developers/webhooks" as const },
  { label: "API logs", path: "developers/logs" as const },
  { label: "Integrations", path: "developers/integrations" as const },
];
const settingsTabs = [
  { label: "Business", path: "settings" as const },
  { label: "Activate payments", path: "activation" as const },
  { label: "Billing", path: "billing" as const },
  { label: "Team", path: "team" as const },
  { label: "Security", path: "security" as const },
];
const balanceTabs = [
  { label: "Fiat", path: "balances" as const },
  { label: "Crypto", path: "crypto-balance" as const },
];
for (const t of balanceTabs) tabSets[t.path] = balanceTabs;
for (const t of developerTabs) tabSets[t.path] = developerTabs;
for (const t of settingsTabs) tabSets[t.path] = settingsTabs;

export function MerchantShell({
  section,
  orgName,
  orgs,
  orgId,
  env,
  email,
  href,
  providerLink,
  actions,
  backLink,
  title,
  children,
}: {
  section: MerchantRoute;
  orgName: string;
  orgs: { id: string; name: string }[];
  orgId: string;
  env: string;
  email: string;
  href: (path: string) => string;
  providerLink: boolean;
  actions?: ReactNode;
  backLink?: { href: string; label: string };
  title?: ReactNode;
  children: ReactNode;
}) {
  const test = env !== "production";
  const link = (item: Item) => {
    const active = section === item.path || !!item.also?.includes(section);
    return (
      <li key={item.path}>
        <Link
          href={href(item.path)}
          className={active ? "active" : undefined}
          aria-current={active ? "page" : undefined}
        >
          {item.icon}
          {item.label}
        </Link>
      </li>
    );
  };
  const tabs = tabSets[section];
  return (
    <div className={`portal ms-app${test ? " is-test" : ""}`} id="ms-app">
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <aside className="ms-side" id="ms-side">
        <div className="ms-side-in">
        <OrgSwitcher orgName={orgName} orgs={orgs} orgId={orgId} providerLink={providerLink} />
        <nav aria-label="Merchant workspace">
          <ul>{main.map(link)}</ul>
          <ul>{setup.map(link)}</ul>
          <p className="ms-nav-label">Reports</p>
          <ul>{reports.map(link)}</ul>
          <ul className="ms-nav-bottom">{bottom.map(link)}</ul>
        </nav>
        <div className="ms-user">
          <span className="ms-user-email" title={email}>
            {email}
          </span>
          <SignOutButton className="ms-signout" />
        </div>
        </div>
      </aside>
      <div className="ms-main">
        <header className="ms-top">
          <NavToggle />
          <Link className="ms-top-org" href={href("overview")}>
            {orgName}
          </Link>
          <div className="ms-top-right">
            <a className="ms-top-link" href={docsUrl("overview")}>
              <BookOpen size={15} aria-hidden /> Docs
            </a>
            <ThemeToggle />
            <form className="ms-mode" action={`/merchant/${section}`}>
              <input type="hidden" name="orgId" value={orgId} />
              <input type="hidden" name="environment" value={test ? "production" : "sandbox"} />
              <button type="submit" role="switch" aria-checked={test} className="ms-switch">
                <span className="ms-switch-track" aria-hidden>
                  <span />
                </span>
                Test mode
              </button>
            </form>
          </div>
        </header>
        {test && (
          <div className="ms-testband" role="note">
            <span>Test mode</span> You&apos;re viewing test data. Nothing here moves real money.
          </div>
        )}
        <div className="ms-content">
          {backLink && (
            <Link className="ms-back" href={backLink.href}>
              ← {backLink.label}
            </Link>
          )}
          <div className="ms-page-head">
            <h1>{title ?? routeTitles[section]}</h1>
            {actions && <div className="ms-page-actions">{actions}</div>}
          </div>
          {tabs && (
            <nav className="ms-tabs" aria-label={`${[...main, ...bottom].find((b) => b.also?.includes(section) || b.path === section)?.label} sections`}>
              {tabs.map((t) => (
                <Link key={t.path} href={href(t.path)} aria-current={t.path === section ? "page" : undefined}>
                  {t.label}
                </Link>
              ))}
            </nav>
          )}
          <div className="ms-body">
            <StepUpProvider securityHref={href("security")}>{children}</StepUpProvider>
          </div>
        </div>
      </div>
    </div>
  );
}
