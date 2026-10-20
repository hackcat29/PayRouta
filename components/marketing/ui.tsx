import Link from "next/link";

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
    <Link className={`mk-btn ${variant}`} href={href}>
      {children}
    </Link>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link className="mk-more" href={href}>
      {children} <span aria-hidden="true">→</span>
    </Link>
  );
}

// Header of an inner page, set like the top of a newspaper article.
export function PageHeader({ title, lead, children }: { title: React.ReactNode; lead: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="mk-article-head">
      <h1 className="mk-h1">{title}</h1>
      <p className="mk-lead">{lead}</p>
      {children && <div className="mk-actions">{children}</div>}
    </header>
  );
}

// A status label from content/claims.ts availability, with an optional note.
export function Status({
  availability,
  children,
  tone = "light",
}: {
  availability: import("@/content/claims").Availability;
  children?: React.ReactNode;
  tone?: "light" | "night";
}) {
  const label = { available: "Live", testing: "In testing", planned: "Coming" }[availability];
  return (
    <span className={`mk-status mk-status-${availability} mk-status-${tone}`}>
      {label}
      {children ? <span className="mk-status-note"> · {children}</span> : null}
    </span>
  );
}
