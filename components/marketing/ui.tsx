import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { lines, type LineKey } from "@/content/claims";

// A transit-style route bullet: a coloured disc with a letter or number.
export function Bullet({
  line,
  children,
  small = false,
  className = "",
}: {
  line?: LineKey;
  children?: React.ReactNode;
  small?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`mk-bullet${small ? " sm" : ""}${line ? "" : " plain"} ${className}`}
      style={line ? { background: lines[line].color } : undefined}
      aria-hidden="true"
    >
      {children ?? (line ? lines[line].bullet : null)}
    </span>
  );
}

export function Kicker({
  children,
  n,
  line,
}: {
  children: React.ReactNode;
  n?: React.ReactNode;
  line?: LineKey;
}) {
  return (
    <p className="mk-kicker">
      {(n !== undefined || line) && <Bullet line={line}>{n}</Bullet>}
      {children}
    </p>
  );
}

export function Btn({
  href,
  children,
  ghost = false,
  large = false,
}: {
  href: string;
  children: React.ReactNode;
  ghost?: boolean;
  large?: boolean;
}) {
  return (
    <Link className={`mk-btn${ghost ? " ghost" : ""}${large ? " lg" : ""}`} href={href}>
      {children}
      {!ghost && <ArrowRight size={18} weight="bold" />}
    </Link>
  );
}

export function MkLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link className="mk-link" href={href}>
      {children} <ArrowRight size={16} weight="bold" />
    </Link>
  );
}

export function SectionHead({
  kicker,
  n,
  line,
  title,
  lead,
  center = false,
  children,
}: {
  kicker?: string;
  n?: React.ReactNode;
  line?: LineKey;
  title: React.ReactNode;
  lead?: React.ReactNode;
  center?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`mk-head${center ? " center" : ""}`} data-reveal>
      {kicker && (
        <Kicker n={n} line={line}>
          {kicker}
        </Kicker>
      )}
      <h2 className="mk-h2">{title}</h2>
      {lead && <p className="mk-lead">{lead}</p>}
      {children}
    </div>
  );
}

// Photos are pre-optimised WebP files (see docs/BRAND-ASSETS.md); the runtime
// optimiser is bypassed so standalone deployments don't depend on sharp.
export function Photo({
  src,
  alt,
  tags,
  className = "",
  priority = false,
  sizes = "(max-width: 900px) 100vw, 50vw",
}: {
  src: string;
  alt: string;
  tags?: { label: string; line?: LineKey }[];
  className?: string;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <figure className={`mk-photo ${className}`}>
      <Image src={`/images/${src}.webp`} alt={alt} fill sizes={sizes} unoptimized priority={priority} />
      {tags && (
        <figcaption>
          {tags.map((t) => (
            <span key={t.label}>
              {t.line && <Bullet line={t.line} small />}
              {t.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

export function Checks({ items }: { items: [string, string][] }) {
  return (
    <ul className="mk-checks">
      {items.map(([title, copy]) => (
        <li key={title}>
          <CheckCircle size={22} weight="fill" />
          <span>
            <strong>{title}.</strong> {copy}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function LineBadge({ line }: { line: LineKey }) {
  return (
    <span className="mk-line-badge">
      <Bullet line={line} small />
      {lines[line].label}
    </span>
  );
}
