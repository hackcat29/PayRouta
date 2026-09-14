"use client";
import Link from "next/link";
import { useState } from "react";
export function DocsNavigation({
  items,
  current,
}: {
  items: { slug: string; title: string; href: string; content: string }[];
  current: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const results = items.filter((d) =>
    (d.title + " " + d.content).toLowerCase().includes(q.toLowerCase().trim()),
  );
  return (
    <aside className="docs-nav">
      <button
        className="docs-mobile"
        aria-expanded={open}
        aria-controls="docs-menu"
        onClick={() => setOpen(!open)}
      >
        Documentation navigation {open ? "−" : "+"}
      </button>
      <div id="docs-menu" className={`docs-menu ${open ? "open" : ""}`}>
        <label htmlFor="docs-search" className="sr-only">
          Search documentation
        </label>
        <input
          id="docs-search"
          className="docs-search"
          placeholder="Search documentation…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
        />
        <h2>{q ? "Search results" : "Documentation"}</h2>
        <nav aria-label="Documentation">
          {results.map((d) => (
            <Link
              aria-current={current === d.slug ? "page" : undefined}
              key={d.slug}
              href={d.href}
            >
              {d.title}
            </Link>
          ))}
        </nav>
        <p className={q ? "note" : "sr-only"} role="status">
          {q
            ? results.length
              ? `${results.length} matching pages`
              : "No results. Try “settlement” or “availability”."
            : ""}
        </p>
      </div>
    </aside>
  );
}
