import { IntentsDemo } from "./intents-demo";

export const metadata = {
  title: "Live Checkout Demo | PayRouta",
  description:
    "Pay with any token on any chain, from any wallet, through NEAR Intents. Merchants get paid exactly in the stablecoin, token or currency they choose.",
};

export default function CheckoutDemoPage() {
  return <IntentsDemo />;
}
