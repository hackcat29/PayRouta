// Server-rendered pieces of the motion system (components/motion/motion-root).
import { Fragment, type CSSProperties, type ReactNode } from "react";

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

export function Figure({ value, prefix = "", suffix = "", label }: { value: string; prefix?: string; suffix?: string; label: ReactNode }) {
  return (
    <div className="fig">
      <b data-count={/^\d/.test(value) ? value : undefined}>
        {prefix}
        {value}
        {suffix}
      </b>
      <span>{label}</span>
    </div>
  );
}
