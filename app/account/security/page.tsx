// Account security outside a dashboard: for operations staff, and anyone
// sent here to set up two-step verification.
import Link from "next/link";
import { redirect } from "next/navigation";
import { identity } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import { BrandLogo } from "@/components/brand-logo";
import { AccountSecurity } from "@/components/portal/account-security";
import { StepUpProvider } from "@/components/portal/step-up";
import { ThemeToggle } from "@/components/portal/theme-toggle";
import { themeScript } from "@/components/portal/theme-script";
import "@/components/portal/portal.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account security", robots: { index: false, follow: false } };

export default async function SecurityPage() {
  let user;
  try {
    user = await identity();
  } catch (e) {
    if (e instanceof PortalError && e.status === 401) redirect("/sign-in?next=/account/security");
    throw e;
  }
  return (
    <div className="portal as-page">
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      <header className="as-page-head">
        <Link href="/merchant" aria-label="PayRouta dashboard">
          <BrandLogo />
        </Link>
        <ThemeToggle />
      </header>
      <main id="main">
        <h1>Account security</h1>
        <p className="as-page-who">{user.user.email}</p>
        <StepUpProvider securityHref="/account/security">
          <AccountSecurity twoFactorEnabled={!!user.user.twoFactorEnabled} />
        </StepUpProvider>
      </main>
    </div>
  );
}
