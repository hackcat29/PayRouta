// The PayRouta checkout button for React and the browser (private 0.1.0).
// It loads PayRouta's checkout script from your PayRouta origin and opens
// checkout in a secure PayRouta window; payment details never touch your
// page. Your server creates the checkout session with its secret key.
//
//   <PayRoutaButton origin="https://pay.example" session="/create-checkout"
//     onEvent={(name, detail) => name === "confirmed" && refreshOrder()}>
//     Checkout
//   </PayRoutaButton>
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export type CheckoutEventName = "open" | "pending" | "confirmed" | "closed" | "error";
export type CheckoutDetail = { reference?: string; returnUrl?: string; method?: string; message?: string };
export type SessionSource =
  // Your endpoint (POST, same origin) answering { checkoutUrl }.
  | string
  // Or a function returning a checkout URL or { checkoutUrl }.
  | (() => Promise<string | { checkoutUrl: string }> | string | { checkoutUrl: string });

export interface CheckoutOptions {
  session: SessionSource;
  mode?: "popup" | "redirect";
  element?: Element | null;
  onEvent?: (name: CheckoutEventName, detail: CheckoutDetail, event: CustomEvent) => void;
}

interface PayRoutaGlobal {
  version: string;
  origin: string;
  checkout(options: CheckoutOptions): Promise<{ event: CheckoutEventName; detail: CheckoutDetail }>;
  bind(root?: ParentNode): void;
}

declare global {
  interface Window {
    PayRouta?: PayRoutaGlobal;
  }
}

const loading = new Map<string, Promise<PayRoutaGlobal>>();

// Loads /js/v1/payrouta.js from your PayRouta origin once per page.
export function loadPayRouta(origin: string): Promise<PayRoutaGlobal> {
  const base = new URL(origin).origin;
  if (window.PayRouta?.origin === base) return Promise.resolve(window.PayRouta);
  const existing = loading.get(base);
  if (existing) return existing;
  const promise = new Promise<PayRoutaGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${base}/js/v1/payrouta.js`;
    script.async = true;
    script.onload = () => (window.PayRouta ? resolve(window.PayRouta) : reject(new Error("PAYROUTA_SCRIPT_INVALID")));
    script.onerror = () => {
      loading.delete(base);
      reject(new Error("PAYROUTA_SCRIPT_UNAVAILABLE"));
    };
    document.head.appendChild(script);
  });
  loading.set(base, promise);
  return promise;
}

// Opens checkout without a component. Call it from a click handler: the
// secure window must open inside the customer's click.
export async function openCheckout(origin: string, options: CheckoutOptions) {
  const payrouta = window.PayRouta?.origin === new URL(origin).origin ? window.PayRouta : await loadPayRouta(origin);
  return payrouta.checkout(options);
}

export interface PayRoutaButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "onError"> {
  // Your PayRouta origin, e.g. https://pay.example.
  origin: string;
  session: SessionSource;
  mode?: "popup" | "redirect";
  onEvent?: CheckoutOptions["onEvent"];
  children?: ReactNode;
}

export function PayRoutaButton({ origin, session, mode, onEvent, children = "Checkout", disabled, ...rest }: PayRoutaButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    // Preload so the click opens the window synchronously.
    loadPayRouta(origin).then(
      () => alive && setReady(true),
      () => alive && setReady(false),
    );
    return () => {
      alive = false;
    };
  }, [origin]);
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      aria-busy={busy || undefined}
      disabled={disabled || !ready || busy}
      onClick={() => {
        const payrouta = window.PayRouta;
        if (!payrouta) return;
        setBusy(true);
        payrouta.checkout({ session, mode, element: ref.current, onEvent }).finally(() => setBusy(false));
      }}
    >
      {children}
    </button>
  );
}
