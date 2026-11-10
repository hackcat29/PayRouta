"use client";
// The dashboards' dark mode switch. The choice is kept in this browser and
// applied before paint by theme-script.ts.
import { useSyncExternalStore } from "react";

const subscribe = (change: () => void) => {
  const observer = new MutationObserver(change);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
};
const isDark = () => document.documentElement.dataset.theme === "dark";

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      className="ms-switch ms-theme"
      onClick={() => {
        const next = !dark;
        if (next) document.documentElement.dataset.theme = "dark";
        else delete document.documentElement.dataset.theme;
        try {
          localStorage.setItem("payrouta-theme", next ? "dark" : "light");
        } catch {
          /* Private mode: the switch still works for this page. */
        }
      }}
    >
      <span className="ms-switch-track" aria-hidden>
        <span />
      </span>
      Dark mode
    </button>
  );
}
