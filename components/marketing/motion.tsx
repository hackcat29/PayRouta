// Server-rendered pieces of the motion system (components/motion/motion-root).
import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { waysToPay as Ways } from "@/content/claims";

// A headline whose words rise into place one after another on load. Pure
// CSS, so it runs before hydration; screen readers get the plain sentence.
export function RiseWords({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`rise ${className ?? ""}`}>
      <span className="mk-sr">{text}</span>
      <span aria-hidden="true">
        {text.split(" ").map((w, i) => (
          <Fragment key={i}>
            <span className="rise-w">
              <span style={{ "--i": i } as CSSProperties}>{w}</span>
            </span>{" "}
          </Fragment>
        ))}
      </span>
    </span>
  );
}

// Two rows of names drifting in opposite directions. Each row is printed
// twice so the loop is seamless; the copy is hidden from assistive tech.
export function Marquee({ items, label }: { items: typeof Ways; label: string }) {
  const half = Math.ceil(items.length / 2);
  const rows = [items.slice(0, half), items.slice(half)];
  return (
    <div className="mq" role="list" aria-label={label}>
      {rows.map((row, r) => (
        <div className={`mq-row ${r ? "mq-rev" : ""}`} key={r}>
          {[0, 1].map((copy) => (
            <div className="mq-track" key={copy} aria-hidden={copy === 1 || undefined}>
              {row.map((w) => (
                <span className={`mq-item mq-${w.family}`} role={copy ? undefined : "listitem"} key={w.name}>
                  <i aria-hidden="true" />
                  {w.name}
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Figure({ value, prefix = "", suffix = "", label }: { value: string; prefix?: string; suffix?: string; label: ReactNode }) {
  return (
    <div className="fig">
      <b data-count={value}>
        {prefix}
        {value}
        {suffix}
      </b>
      <span>{label}</span>
    </div>
  );
}
