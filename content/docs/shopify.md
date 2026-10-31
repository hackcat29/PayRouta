# Shopify

PayRouta works with Shopify in two ways:

- **Pay now** (manual payment method). The buyer chooses PayRouta at Shopify checkout, places the order, and pays from a **Pay** button on the Thank you and order status pages. PayRouta marks the order paid once the payment is confirmed, and cancels orders left unpaid past your deadline.
- **Payments app** (offsite payments extension). The buyer is sent to PayRouta from Shopify checkout before the order is placed.

Both open a PayRouta checkout with every method you accept, including [credit from licensed lenders](credit.md) and, for USD stores, stablecoins and crypto from any wallet.

## Pay now

### Set up

1. In PayRouta, open **Developers → Integrations**. Enter your `*.myshopify.com` address, the name your payment method will have in Shopify, and how long unpaid orders stay open. Choose **Connect Shopify** and approve the app in Shopify.
2. In Shopify, open **Settings → Payments → Manual payment methods** and create a custom payment method with exactly that name, for example `PayRouta`.
3. Open **Settings → Checkout → Customize** and add the **PayRouta Pay now** block to the Thank you page and the order status page.
4. Place a test order. A store in test mode, or a development store, uses your PayRouta sandbox; a live store needs a live PayRouta business.

### How orders are paid

| Step | What happens |
| --- | --- |
| Order placed | Shopify sends `orders/create`. If the order used your PayRouta payment method, PayRouta records it and schedules its cancellation. |
| Pay button | The block sends the order ID and Shopify's session token to PayRouta. PayRouta checks the token, reads the order from the Admin API, and opens a [universal checkout](checkout-button.md) for the amount outstanding. The button shows only for unpaid orders placed with your PayRouta payment method; a signed-in customer only sees it on their own orders. |
| Payment confirmed | PayRouta calls `orderMarkAsPaid`. The buyer returns to the order status page. |
| Deadline | PayRouta calls `orderCancel` (restock, notify the customer) for an order still unpaid. An order with a checkout that can still be paid, or a payment still confirming, is cancelled only after it ends. Orders paid another way are left alone. |

An order whose total changes after its checkout opens is left for you to settle; PayRouta doesn't mark it paid.

### Refunds

Refund from the PayRouta dashboard, then record the refund in Shopify. Crypto payments are refunded from your own wallet.

## Payments app

1. In PayRouta, open **Developers → Integrations** and connect your store; approve the app in Shopify.
2. Shopify opens its payment settings: activate PayRouta.
3. Shopify test mode uses your PayRouta sandbox.

| Step | What happens |
| --- | --- |
| Install | OAuth with scopes `write_payment_gateways,write_payment_sessions`. PayRouta calls `paymentsAppConfigure` to mark the app ready. |
| Payment session | Shopify sends the session to PayRouta, which answers with a universal checkout's `redirect_url`. Repeated requests with the same session ID return the same checkout. |
| Confirmation | PayRouta calls `paymentSessionResolve`; the buyer returns to Shopify's order page. |
| Refund session | Refunded through PayRouta and reported with `refundSessionResolve` or `refundSessionReject`. Crypto orders are refunded from your own wallet; Shopify is told so. |
