"use client";
// The checkout side of the checkout button (public/js/v1/payrouta.js). When
// the button opens checkout in its own window (?mode=popup), checkout tells
// the merchant's page what happened. Messages go only to the origin of the
// payment's return URL, which the merchant set on its server, and carry no
// secrets: the merchant still confirms the payment server-side.
import { useEffect, useRef } from "react";

const key = (id: string) => `payrouta:popup:${id}`;

// Remembers popup mode for this session in this tab, so it survives the
// trip to a provider's secure page and back.
export function rememberPopup(id: string) {
  try {
    if (new URLSearchParams(location.search).get("mode") === "popup") sessionStorage.setItem(key(id), "1");
  } catch {
    /* Storage blocked: the checkout simply behaves as a normal page. */
  }
}

function opener(id: string): Window | null {
  try {
    return sessionStorage.getItem(key(id)) === "1" && window.opener && !window.opener.closed ? window.opener : null;
  } catch {
    return null;
  }
}

export function inPopup(id: string) {
  return typeof window !== "undefined" && !!opener(id);
}

type Event = "pending" | "confirmed" | "return";

export function notifyMerchant(id: string, event: Event, detail: { returnUrl: string; reference: string; method?: string | null }) {
  const target = opener(id);
  if (!target) return false;
  let origin: string;
  try {
    origin = new URL(detail.returnUrl).origin;
  } catch {
    return false;
  }
  target.postMessage(
    { type: "payrouta:checkout", event, reference: detail.reference, returnUrl: detail.returnUrl, method: detail.method ?? undefined },
    origin,
  );
  return true;
}

// Sends "pending" and "confirmed" once each as the payment progresses.
export function usePopupBridge(
  id: string,
  state: { confirmed: boolean; pending: boolean; returnUrl?: string; reference?: string; method?: string | null },
) {
  const sent = useRef(new Set<Event>());
  useEffect(() => {
    if (!state.returnUrl || !state.reference) return;
    const event: Event | null = state.confirmed ? "confirmed" : state.pending ? "pending" : null;
    if (!event || sent.current.has(event)) return;
    if (notifyMerchant(id, event, { returnUrl: state.returnUrl, reference: state.reference, method: state.method })) sent.current.add(event);
  }, [id, state.confirmed, state.pending, state.returnUrl, state.reference, state.method]);
}

// Universal checkout: open the order's other checkout (fiat or crypto) in
// this window, keeping popup mode.
export async function switchCheckout(id: string, to: "fiat" | "crypto") {
  const r = await fetch(`/api/checkout/${id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "switch", to }),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error === "PAYMENT_ALREADY_IN_PROGRESS" ? "A payment has already started for this order." : "That option isn't available any more.");
  const url = new URL(b.checkoutPath, location.origin);
  if (inPopup(id)) url.searchParams.set("mode", "popup");
  location.assign(url.href);
}

// "Return to merchant" inside the popup: hand back to the merchant's page
// (which is still open behind it) instead of loading the merchant site in
// the small window.
export function returnHandler(id: string, detail: { returnUrl: string; reference: string }) {
  return (e: { preventDefault(): void }) => {
    if (!notifyMerchant(id, "return", detail)) return;
    e.preventDefault();
    window.close();
  };
}
