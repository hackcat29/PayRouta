import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { PayNow } from "./PayNow.jsx";

export default function extension() {
  render(<ThankYou />, document.body);
}

function ThankYou() {
  const order = shopify.orderConfirmation.value?.order?.id;
  const country = shopify.localization.country.value?.isoCode;
  return <PayNow order={order} country={country} />;
}
