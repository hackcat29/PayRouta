"use client";
import {
  useState,
  useId,
  Children,
  isValidElement,
  cloneElement,
  ReactElement,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, ArrowUpRight, FileCheck2 } from "lucide-react";
export function Badge({ children }: { children: React.ReactNode }) {
  const value = String(children);
  return (
    <span
      className={`p-badge ${/Passed|Approved|Accepted|Active|Completed|Confirmed|Available|Succeeded|Clean/.test(value) ? "good" : /Failed|Rejected|Suspended|Unavailable/.test(value) ? "bad" : ""}`}
    >
      {children}
    </span>
  );
}
export function Panel({
  title,
  children,
  action,
}: {
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="p-panel">
      {title && (
        <div className="p-panel-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="p-empty">
      <FileCheck2 size={28} />
      <h3>{title}</h3>
      <p>{children || "Records will appear here when they are available."}</p>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="p-field">
      <label htmlFor={id}>{label}</label>
      {Children.map(children, (child, index) =>
        index === 0 && isValidElement(child)
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              id,
              "aria-describedby": hint ? `${id}-hint` : undefined,
            })
          : child,
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Table({
  headings,
  children,
}: {
  headings: string[];
  children: React.ReactNode;
}) {
  return (
    <div
      className="p-table-wrap"
      tabIndex={0}
      role="region"
      aria-label={`${headings[0]} table`}
    >
      <table>
        <thead>
          <tr>
            {headings.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function JsonView({
  value,
  label = "Generated manifest",
}: {
  value: unknown;
  label?: string;
}) {
  return (
    <details className="p-json">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
export function Modal({
  label,
  title,
  children,
}: {
  label: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger className="p-button secondary">{label}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="p-overlay" />
        <Dialog.Content className="p-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>
            Changes apply only to the selected organization and environment.
          </Dialog.Description>
          <Dialog.Close className="p-close" aria-label="Close">
            <X />
          </Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function DateText({
  value,
}: {
  value: Date | string | null | undefined;
}) {
  return (
    <>
      {value
        ? new Date(value).toISOString().replace("T", " ").slice(0, 16) + " UTC"
        : "—"}
    </>
  );
}
export function Action({
  label,
  run,
  danger = false,
  disabled = false,
}: {
  label: string;
  run: () => Promise<unknown>;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`p-button ${danger ? "danger" : "secondary"}`}
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          await run();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Working…" : label}
    </button>
  );
}
export function ExternalMark() {
  return <ArrowUpRight size={15} />;
}
