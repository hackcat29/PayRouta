import { CheckoutRouter } from "../[sessionId]/router";

export const metadata = {
  title: "Checkout demo | PayRouta",
  description:
    "PayRouta's checkout on a demo order: pay with any token on any chain through NEAR Intents, or by card, wallet, bank or credit. Nothing is charged.",
};

export default function CheckoutDemoPage() {
  return <CheckoutRouter id="demo" />;
}
