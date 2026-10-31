# WooCommerce

The **PayRouta Checkout** plugin adds one payment option to WooCommerce. At checkout the customer is sent to PayRouta, where they pay by card, digital wallet, bank transfer, mobile money, USSD, [credit from a licensed lender](credit.md), or (USD stores) stablecoins and crypto from any wallet.

> **Status.** 0.1.0, run end to end in sandbox on WordPress 7.1 and WooCommerce 11.2: block checkout, card payment on PayRouta, signed webhook, order marked paid. [Download the plugin](https://payrouta.com/downloads/payrouta-checkout.zip). Source: `integrations/woocommerce/payrouta-checkout`.

## Requirements

WordPress 6.4+, WooCommerce 8.2+, PHP 7.4+. Works with High-Performance Order Storage and the block-based checkout.

## Set up

1. [Download the plugin](https://payrouta.com/downloads/payrouta-checkout.zip), then upload and activate it under **Plugins → Add New**.
2. In PayRouta, set your **return origin** to the store's address (for example `https://shop.example`) and create an API key with `payments:write` and `payments:read`.
3. In **WooCommerce → Settings → Payments → PayRouta**, enter the API URL (for example `https://YOUR-PAYROUTA-URL/api/v1/`), the environment and the secret key. Choose the methods to offer; include **Pay with credit** to offer instalments where a lender is live.
4. For crypto (USD stores only), list the coins and networks to accept, one `network|identifier` per line, and add receive addresses for them in PayRouta.
5. In PayRouta **Developers → Webhooks**, set the endpoint to `https://YOUR-STORE/wp-json/payrouta/v1/webhook` with a key ID and secret, and enter the same key ID and secret in the plugin.
6. Place a test order in sandbox.

## How orders are paid

- Placing the order creates one PayRouta checkout (`POST /checkouts`) with the order total, currency and billing country, keyed to the order so retries never create a second checkout.
- The order is marked paid **only** after a signed `payment.confirmed` webhook arrives **and** the plugin reads the payment back from `GET /payments/{id}` and checks that the amount and currency match the order. A confirmed payment that doesn't match puts the order on hold for review.
- Returning from checkout alone never marks an order paid.

## Refunds

Refund from the PayRouta dashboard. Refunding from WooCommerce isn't supported in 0.1.0.
