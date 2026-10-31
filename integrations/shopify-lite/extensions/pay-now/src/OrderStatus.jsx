import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { PayNow } from "./PayNow.jsx";

export default function extension() {
  render(<OrderStatus />, document.body);
}

function OrderStatus() {
  const order = shopify.order.value?.id;
  return <PayNow order={order} />;
}
