import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { BrandLogo } from "./brand-logo";
import { primaryRoutes, navigationGroups, paths } from "@/lib/site-config";
export function ButtonLink({
  href,
  children,
  secondary = false,
}: {
  href: string;
  children: React.ReactNode;
  secondary?: boolean;
}) {
  return (
    <Link className={`button ${secondary ? "secondary" : ""}`} href={href}>
      {children}
      <ArrowUpRight size={17} />
    </Link>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link className="text-link" href={href}>
      {children}
      <ArrowRight size={17} />
    </Link>
  );
}
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}
export function ClosingCTA() {
  return (
    <section className="closing">
      <div className="container split">
        <div>
          <h2>Discuss your payment requirements.</h2>
          <p>
            Tell us which methods your customers need and how you want to
            receive settlement.
          </p>
        </div>
        <div className="actions">
          <ButtonLink href="/contact?intent=merchant">
            Request access
          </ButtonLink>
          <ButtonLink href="/contact?intent=provider" secondary>
            Become a provider
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Link href={paths.home} aria-label="PayRouta home">
            <BrandLogo reverse />
          </Link>
          <p>The universal payment routing network.</p>
          <p className="early-access">Early access · In development</p>
        </div>
        <div>
          <h3>Explore PayRouta</h3>
          {[...navigationGroups[0].links, ...navigationGroups[1].links].map(
            ([h, t]) => (
              <Link key={h} href={h}>
                {t}
              </Link>
            ),
          )}
        </div>
        <div>
          <h3>Resources & company</h3>
          {primaryRoutes.slice(8).map(([h, t]) => (
            <Link key={h} href={h}>
              {t}
            </Link>
          ))}
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} PayRouta</span>
        <span>Starting with Nigeria. Building toward a connected world.</span>
      </div>
    </footer>
  );
}
export function Flow({ steps }: { steps: string[] }) {
  return (
    <ol className="flow">
      {steps.map((s, i) => (
        <li key={s}>
          <span>{s}</span>
          {i < steps.length - 1 && <ArrowRight aria-hidden="true" size={18} />}
        </li>
      ))}
    </ol>
  );
}
