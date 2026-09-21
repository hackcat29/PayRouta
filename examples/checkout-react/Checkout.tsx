"use client";
import { useState } from "react";
// Mount on the merchant origin. /checkout and /payment are MERCHANT backend routes.
export function Checkout() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function start() {
    setBusy(true);
    try {
      const response = await fetch("/checkout", { method: "POST" });
      if (!response.ok)
        throw new Error(
          "Checkout could not be opened. Check your order before trying again.",
        );
      const data = await response.json();
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Checkout unavailable",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const response = await fetch("/payment", { cache: "no-store" });
    if (!response.ok) {
      setMessage("Payment status is unavailable. Try checking again.");
      return;
    }
    const payment = await response.json();
    setMessage(
      payment.state === "Confirmed"
        ? "Payment confirmed"
        : `Payment status: ${payment.state}`,
    );
  }
  return (
    <section>
      <button disabled={busy} onClick={() => void start()}>
        Continue to secure checkout
      </button>
      <button onClick={() => void refresh()}>Check payment status</button>
      <p role="status">{message}</p>
    </section>
  );
}
