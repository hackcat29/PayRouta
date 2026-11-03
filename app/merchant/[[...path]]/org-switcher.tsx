"use client";
// The business switcher at the top of the sidebar. The menu opens under the
// current business, inside the sidebar, and closes on Escape, an outside
// click or a choice.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "P";

export function OrgSwitcher({
  orgName,
  orgs,
  orgId,
  providerLink,
}: {
  orgName: string;
  orgs: { id: string; name: string }[];
  orgId: string;
  providerLink: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        root.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const others = orgs.filter((o) => o.id !== orgId);
  return (
    <div className="ms-org" ref={root}>
      <button
        type="button"
        className="ms-org-current"
        aria-expanded={open}
        aria-controls="ms-org-menu"
        onClick={() => setOpen(!open)}
      >
        <span className="ms-org-mark" aria-hidden>
          {initials(orgName)}
        </span>
        <span className="ms-org-name">{orgName}</span>
        <ChevronsUpDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="ms-org-menu" id="ms-org-menu">
          <ul>
            <li>
              <span className="ms-org-item current">
                <span className="ms-org-mark small" aria-hidden>
                  {initials(orgName)}
                </span>
                <span className="ms-org-name">{orgName}</span>
                <Check size={14} aria-label="Current" />
              </span>
            </li>
            {others.map((o) => (
              <li key={o.id}>
                <Link
                  className="ms-org-item"
                  href={`/merchant/overview?${new URLSearchParams({ orgId: o.id })}`}
                  onClick={() => setOpen(false)}
                >
                  <span className="ms-org-mark small" aria-hidden>
                    {initials(o.name)}
                  </span>
                  <span className="ms-org-name">{o.name}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="ms-org-foot">
            <Link className="ms-org-item" href="/merchant/overview?new=1" onClick={() => setOpen(false)}>
              <Plus size={14} aria-hidden /> New business
            </Link>
            {providerLink && (
              <Link className="ms-org-item" href="/provider/overview" onClick={() => setOpen(false)}>
                Provider workspace
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
