"use client";
// Exchanges the checkout link's access token once, then shows the right
// checkout: card / bank / mobile money for fiat payments, or the stablecoin
// and crypto wallet checkout for on-chain payments.
import { useEffect, useState } from "react";
import { Checkout } from "./view";
import { FiatCheckout } from "./fiat-view";
import { rememberPopup } from "./popup";

type Initial = Parameters<typeof FiatCheckout>[0]["initial"];

export function CheckoutRouter({ id }: { id: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "fiat"; data: Initial } | { kind: "chain" }>(() =>
    id === "demo" ? { kind: "chain" } : { kind: "loading" },
  );
  useEffect(() => {
    if (id === "demo") return;
    rememberPopup(id);
    let alive = true;
    (async () => {
      try {
        const token = location.hash.slice(1);
        if (token) {
          const r = await fetch(`/api/checkout/${id}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "exchange", token }),
          });
          if (r.ok) history.replaceState(null, "", location.pathname + location.search);
        }
        const r = await fetch(`/api/checkout/${id}`, { cache: "no-store" });
        const b = await r.json();
        if (!alive) return;
        setState(r.ok && b.asset?.kind === "fiat" ? { kind: "fiat", data: b } : { kind: "chain" });
      } catch {
        // The stablecoin checkout shows its own loading and error states.
        if (alive) setState({ kind: "chain" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);
  if (state.kind === "loading")
    return (
      <div className="fiat-checkout">
        <div className="fc-layout">
          <aside className="fc-summary">
            <div className="fc-skeleton" style={{ height: 120 }} />
          </aside>
          <section className="fc-pane" aria-label="Payment">
            <div className="fc-skeleton" style={{ height: 240 }} aria-label="Loading checkout" />
          </section>
        </div>
      </div>
    );
  if (state.kind === "fiat") return <FiatCheckout id={id} initial={state.data} />;
  return <Checkout id={id} />;
}
