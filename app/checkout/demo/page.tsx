import { Checkout } from "../[sessionId]/view";

export const metadata = {
  title: "Live Checkout Demo | PayRouta",
  description:
    "Test PayRouta's unified checkout experience with automatic provider routing and instant confirmation.",
};

export default function CheckoutDemoPage() {
  return <Checkout id="demo" />;
}
