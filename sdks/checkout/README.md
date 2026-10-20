# PayRouta checkout button (private 0.1.0)

One button that lets your customer pay with whatever they have: card, digital wallet, bank transfer, mobile money, credit from a licensed lender, stablecoins, or crypto from any wallet and chain. Checkout opens in a secure PayRouta window, so card details, credit applications and wallet signatures never touch your page.

## Plain HTML

```html
<script src="https://YOUR-PAYROUTA-ORIGIN/js/v1/payrouta.js" async></script>
<button data-payrouta-checkout="/create-checkout">Checkout</button>
```

`/create-checkout` is an endpoint on **your** server. It creates a payment intent and a checkout session with your secret key (see `@payrouta/server`) and answers `{ "checkoutUrl": "<PayRouta origin><checkoutPath>" }`.

## React

```tsx
import { PayRoutaButton } from "@payrouta/checkout";

<PayRoutaButton
  origin="https://YOUR-PAYROUTA-ORIGIN"
  session="/create-checkout"
  onEvent={(name) => name === "confirmed" && refreshOrder()}
>
  Checkout
</PayRoutaButton>;
```

Without a component: `openCheckout(origin, { session })`, called inside a click handler.

## Events

`open`, `pending`, `confirmed` (with `returnUrl`), `closed`, `error`. They are dispatched on the button as `payrouta:<name>` DOM events and passed to `onEvent`. By default `confirmed` sends the page to the payment's return URL; call `event.preventDefault()` to stay on the page.

Browser events can be faked. Fulfil orders only after your server sees the signed `payment.confirmed` webhook or reads the payment with `GET /payments/{id}`.

If the browser blocks the window, or with `mode="redirect"`, checkout takes over the tab and comes back to your return URL.

Build with `npm run build --prefix sdks/checkout`. The package is deliberately private. Full guide: `content/docs/checkout-button.md`.
