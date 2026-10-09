"use client";
import { useEffect, useRef, useState } from "react";
export type VenmoAction = {
  kind: "paypal-venmo";
  clientId: string;
  merchantId: string;
  orderId: string;
  environment: "sandbox" | "production";
};
type Buttons = {
  isEligible(): boolean;
  render(element: HTMLElement): Promise<void>;
  close(): Promise<void>;
};
type VenmoSdk = {
  FUNDING: { VENMO: string };
  Buttons(options: {
    fundingSource: string;
    createOrder(): Promise<string>;
    onApprove(data: { orderID: string }): Promise<void>;
    onCancel(): void;
    onError(): void;
  }): Buttons;
};
let sequence = 0;
// Load only PayPal's official SDK, with an isolated namespace and merchant
// account. Buyer approval only requests a server read; it never confirms money.
export function VenmoButton({
  action,
  onApproved,
}: {
  action: VenmoAction;
  onApproved: () => Promise<void>;
}) {
  const element = useRef<HTMLDivElement>(null),
    approved = useRef(onApproved);
  useEffect(() => {
    approved.current = onApproved;
  }, [onApproved]);
  const [message, setMessage] = useState("Loading Venmo…");
  useEffect(() => {
    let canceled = false,
      buttons: Buttons | undefined;
    const namespace = `PayRoutaVenmo${++sequence}`;
    const script = document.createElement("script");
    const query = new URLSearchParams({
      "client-id": action.clientId,
      "merchant-id": action.merchantId,
      currency: "USD",
      intent: "capture",
      components: "buttons",
      "enable-funding": "venmo",
      ...(action.environment === "sandbox" ? { "buyer-country": "US" } : {}),
    });
    script.src = `https://${action.environment === "sandbox" ? "www.sandbox.paypal.com" : "www.paypal.com"}/sdk/js?${query}`;
    script.dataset.namespace = namespace;
    script.async = true;
    script.onload = () => {
      void (async () => {
        if (canceled || !element.current) return;
        const sdk = (window as unknown as Record<string, VenmoSdk>)[namespace];
        if (!sdk?.Buttons) {
          setMessage("Venmo could not load. Refresh to try again.");
          return;
        }
        buttons = sdk.Buttons({
          fundingSource: sdk.FUNDING.VENMO,
          createOrder: async () => action.orderId,
          onApprove: async (data) => {
            if (data.orderID !== action.orderId) {
              setMessage(
                "Payment reference did not match. Refresh the payment status.",
              );
              return;
            }
            setMessage("Checking your Venmo payment…");
            await approved.current();
          },
          onCancel: () =>
            setMessage(
              "Venmo approval canceled. You can try the button again.",
            ),
          onError: () =>
            setMessage(
              "Venmo could not complete approval. Refresh the payment status before trying again.",
            ),
        });
        if (!buttons.isEligible()) {
          setMessage(
            "Venmo is unavailable on this device or for this account. No payment has been confirmed.",
          );
          return;
        }
        await buttons.render(element.current);
        if (!canceled) setMessage("");
      })().catch(() => {
        if (!canceled)
          setMessage("Venmo could not load. Refresh to try again.");
      });
    };
    script.onerror = () => {
      if (!canceled) setMessage("Venmo could not load. Refresh to try again.");
    };
    document.head.appendChild(script);
    return () => {
      canceled = true;
      void buttons?.close().catch(() => {});
      script.remove();
      delete (window as unknown as Record<string, unknown>)[namespace];
    };
  }, [action.clientId, action.merchantId, action.orderId, action.environment]);
  return (
    <div aria-label="Venmo approval">
      <div ref={element} />
      {message && <p role="status">{message}</p>}
    </div>
  );
}
