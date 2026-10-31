# Checkout button

One button on any website or app. The customer pays in a secure PayRouta window with any method you accept: card, digital wallet, bank transfer, mobile money, USSD, [credit from a licensed lender](credit.md), or stablecoins and crypto from [any wallet and chain](cross-chain.md). You never handle card details, credit applications or wallet signatures.

> Stablecoin and crypto checkout work for every account. Cards, digital wallets, bank transfers and mobile money appear as they open for your account and region; credit appears where a lender is available.

## 1. Create checkouts on your server

Your server creates the checkout with your secret key, using [`POST /checkouts`](api-reference.md#create-a-checkout-universal), and returns its link:

```ts
import { PayRouta } from "@payrouta/server";

const payrouta = new PayRouta({ baseUrl: process.env.PAYROUTA_API_URL!, secretKey: process.env.PAYROUTA_SECRET_KEY!, environment: "sandbox" });

// POST /create-checkout on your own site
export async function createCheckout(order: { id: string; total: string; country: string }) {
  const checkout = await payrouta.createCheckout(
    {
      reference: order.id,
      payerCountry: order.country,
      amount: order.total,
      currency: "USD",
      methods: ["card", "bank-transfer", "mobile-money", "bnpl"],
      crypto: { options: [{ network: "eip155:8453", identifier: "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }] },
      returnUrl: `https://shop.example/orders/${order.id}`,
    },
    `order-${order.id}`, // idempotency key: one per order
  );
  return { checkoutUrl: new URL(checkout.checkoutPath, process.env.PAYROUTA_ORIGIN).href };
}
```

The return URL must be on the return origin registered for your business.

## 2. Add the button

```html
<script src="https://YOUR-PAYROUTA-URL/js/v1/payrouta.js" async></script>
<button data-payrouta-checkout="/create-checkout">Checkout</button>
```

Clicking the button POSTs to your endpoint (same origin, with cookies), opens checkout in a PayRouta window and dims your page until the customer finishes. If the browser blocks the window, or with `data-payrouta-mode="redirect"`, checkout takes over the tab and comes back to your return URL.

In React, use `@payrouta/checkout`:

```tsx
import { PayRoutaButton } from "@payrouta/checkout";

<PayRoutaButton origin="https://YOUR-PAYROUTA-URL" session="/create-checkout" onEvent={(name) => name === "confirmed" && refreshOrder()}>
  Checkout
</PayRoutaButton>;
```

From your own code, inside a click handler: `PayRouta.checkout({ session: "/create-checkout", onEvent })`. `session` can also be a function that returns the checkout URL.

## 3. Handle the outcome

| Event | When |
| --- | --- |
| `payrouta:open` | The secure window opened |
| `payrouta:pending` | The provider is still confirming (for example a bank transfer) |
| `payrouta:confirmed` | Payment confirmed; `detail.returnUrl` and `detail.reference` |
| `payrouta:closed` | The customer closed the window or returned without paying |
| `payrouta:error` | Your endpoint failed or returned an invalid link |

Events are dispatched on the button and bubble. By default `confirmed` sends the page to the return URL; call `event.preventDefault()` to stay on the page.

**Browser events are not proof of payment.** Fulfil an order only when your server receives the signed `payment.confirmed` [webhook](webhooks.md) or reads the payment with `GET /payments/{id}`.

## Security notes

- The script only opens PayRouta's own `/checkout/` pages on the origin it was loaded from (or the one named with `data-payrouta-origin`).
- Checkout runs in a top-level PayRouta window, never an iframe on your page, so wallets, 3-D Secure and lender approval pages work and PayRouta's cookies stay first-party.
- Checkout tells your page what happened with `postMessage`, sent only to your return URL's origin. Messages carry no secrets.
