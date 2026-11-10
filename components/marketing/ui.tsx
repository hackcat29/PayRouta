import Link from "next/link";

// A link that may leave the site (docs live on their own domain).
// Files (the WooCommerce plugin) download instead of navigating.
export function SmartLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  if (href.startsWith("/downloads/"))
    return (
      <a className={className} href={href} download>
        {children}
      </a>
    );
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

export function Btn({
  href,
  children,
  variant = "primary",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) {
  return (
    <SmartLink className={`mk-btn ${variant}`} href={href}>
      {children}
    </SmartLink>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <SmartLink className="hp-link" href={href}>
      {children} <span aria-hidden="true">→</span>
    </SmartLink>
  );
}

// Top of a product page: what it is on the left, the product on the right.
export function PageHero({
  title,
  actions,
  visual,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
  visual?: React.ReactNode;
}) {
  return (
    <section className={`pp-hero${visual ? "" : " pp-hero-plain"}`}>
      <div className="mk-wrap pp-hero-grid">
        <div className="pp-hero-copy">
          <h1 className="mk-h1">{title}</h1>
          {actions && <div className="mk-actions">{actions}</div>}
        </div>
        {visual && (
          <div className="pp-hero-visual" data-tilt>
            {visual}
          </div>
        )}
      </div>
    </section>
  );
}

// One idea per band: a short heading and paragraph beside a picture of it.
export function Feature({
  title,
  children,
  visual,
  tone,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  visual?: React.ReactNode;
  tone?: "paper" | "night";
}) {
  return (
    <section className={`pp-band${tone ? ` pp-${tone}` : ""}`}>
      <div className={`mk-wrap ${visual ? "pp-split" : "pp-single"}`}>
        <div className="pp-text" data-reveal>
          <h2 className="mk-h2">{title}</h2>
          {children}
        </div>
        {visual && (
          <div className="pp-visual" data-reveal>
            {visual}
          </div>
        )}
      </div>
    </section>
  );
}

// Numbered steps, read left to right (top to bottom on phones).
export function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="pp-steps" data-reveal="stagger">
      {steps.map((title, i) => (
        <li key={title}>
          <span className="pp-step-n">{i + 1}</span>
          <b>{title}</b>
        </li>
      ))}
    </ol>
  );
}
