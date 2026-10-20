// Display primitives for the provider workspace, drawn with the same classes
// as the merchant dashboard (cards, pills, empty states). Form controls and
// dialogs still come from ./ui.
import type { ReactNode } from "react";

export function Panel({
  title,
  description,
  action,
  flush = false,
  children,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  flush?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={flush ? "ms-flush" : undefined}>
      {(title || action) && (
        <div className="ms-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "good" | "bad" | "warn" | "info" | "neutral";
export function toneOf(value: string): Tone {
  if (/Passed|Approved|Accepted|Active|Completed|Confirmed|Available|Succeeded|Clean|Configured|Ready/.test(value))
    return "good";
  if (/Failed|Rejected|Suspended|Unavailable|Revoked|Infected|Not ready/.test(value)) return "bad";
  if (/Changes requested|Degraded|Maintenance|Pending|Queued|Scanning|Under review|Submitted|Resubmitted|Running/.test(value))
    return "warn";
  if (/Processing|Draft/.test(value)) return "info";
  return "neutral";
}
export function Badge({ children, tone }: { children: ReactNode; tone?: Tone }) {
  return <span className={`ms-pill ${tone ?? toneOf(String(children))}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="ms-empty">
      <strong>{title}</strong>
      <p>{children || "Records will appear here when they're available."}</p>
    </div>
  );
}

export function Kpi({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <div className="ms-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}
