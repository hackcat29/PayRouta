import { useEffect, useState } from "preact/hooks";
import { checkout } from "./pay.js";

// Nothing renders for orders paid another way, or already paid.
export function PayNow({ order, country }) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    if (!order) return;
    checkout(order, country).then(
      (result) => setState(result),
      () => setState({ failed: true }),
    );
  }, [order, country]);
  if (state.failed) return <s-banner tone="critical">{shopify.i18n.translate("failed")}</s-banner>;
  if (!state.pay) return null;
  const amount = shopify.i18n.formatCurrency(Number(state.amount), { currency: state.currency });
  return (
    <s-button variant="primary" href={state.url}>
      {shopify.i18n.translate("pay", { amount })}
    </s-button>
  );
}
