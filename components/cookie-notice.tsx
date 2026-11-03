"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

const key = "payrouta-cookie-notice";
const listeners = new Set<() => void>();
// Remembered for this visit when the browser won't store it.
let accepted = false;

function read() {
  if (accepted) return true;
  try {
    return localStorage.getItem(key) === "accepted";
  } catch {
    return false;
  }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
function accept() {
  accepted = true;
  try {
    localStorage.setItem(key, "accepted");
  } catch {}
  listeners.forEach((listener) => listener());
}

// Where a person's choice is kept, for anything that later sets a cookie
// beyond the ones the site needs.
export const cookiesAccepted = read;

export function CookieNotice() {
  const pathname = usePathname();
  // The server renders it as already accepted, so it appears after hydration.
  const done = useSyncExternalStore(subscribe, read, () => true);
  // A customer paying a business doesn't see PayRouta's site notice, and the
  // signed-in workspaces (reached through the public pages that show it)
  // keep their forms clear.
  if (
    done ||
    pathname === "/checkout" ||
    ["/checkout/", "/pay/", "/merchant", "/ops", "/provider"].some((p) => pathname.startsWith(p))
  )
    return null;
  return (
    <div className="cookie-notice" role="region" aria-label="Cookies">
      <p>
        We use only essential cookies, to keep you signed in and protect our
        forms from bots. <Link href="/privacy#cookies">Privacy</Link>
      </p>
      <button type="button" className="mk-btn primary" onClick={accept}>
        Accept
      </button>
    </div>
  );
}
