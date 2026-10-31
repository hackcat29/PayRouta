# WooCommerce

The **PayRouta Checkout** plugin adds PayRouta as a payment method in WooCommerce. At checkout the customer is sent to PayRouta, where they pay by card, digital wallet, bank transfer, mobile money, USSD, [credit from a licensed lender](credit.md) or, for USD stores, stablecoins and crypto from any wallet. The order is marked paid once PayRouta confirms the payment.

[Download the plugin](https://payrouta.com/downloads/payrouta-checkout.zip)

## Requirements

- WordPress 6.4 or later, WooCommerce 8.2 or later, PHP 7.4 or later
- Your store served over HTTPS
- Works with the block-based and classic checkout, and with High-Performance Order Storage

## Set up

1. **Install the plugin.** In WordPress, open **Plugins → Add New → Upload Plugin**, choose the zip, then **Install Now** and **Activate**. See WordPress's guide to [managing plugins](https://wordpress.org/documentation/article/manage-plugins/).
2. **Check your checkout return website.** In PayRouta, open **Settings → Business**. **Checkout return website** must be your store's address, for example `https://shop.example`; customers return there after paying. To change it, contact PayRouta.
3. **Create an API key.** In PayRouta, open **Developers → API keys** and create a key with **payments:write** and **payments:read**. Copy the secret; it starts with `pr_sandbox_` in test mode and `pr_production_` live.
4. **Configure the plugin.** In WordPress, open **WooCommerce → Settings → Payments → PayRouta** and enter:
   - **PayRouta API URL**: `https://payrouta.com/api/v1/`
   - **Environment**: Sandbox to test, Production to go live. It must match your key.
   - **Secret API key**: the key from step 3.
   - **Methods to offer**: include **Pay with credit** to offer instalments where a lender is available.
   - **Crypto (USD stores)**: optional. One `network|identifier` per line, for example `eip155:8453|erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` for USDC on Base. Add receive addresses for them in PayRouta under **Payment methods**.
5. **Connect the webhook.** In PayRouta, open **Developers → Webhooks** and set the endpoint to `https://YOUR-STORE/wp-json/payrouta/v1/webhook` with a key ID and a secret. Enter the same key ID and secret in the plugin and save.
6. **Enable PayRouta** in the plugin settings and save.

## Testing your setup

1. Use a sandbox key and set **Environment** to Sandbox.
2. Add a product to the cart, check out and choose PayRouta.
3. Complete the test payment on the PayRouta checkout. No real money moves.
4. Back in WordPress, the order moves to **Processing** with the note "Paid through PayRouta". The payment also appears in PayRouta under **Transactions**.

To go live, create a production key, set **Environment** to Production, and connect the webhook in live mode.

## How orders are paid

- Placing the order opens one PayRouta checkout for the order total, currency and billing country. Retries never open a second checkout for the same order.
- The order is marked paid only after PayRouta's signed `payment.confirmed` [webhook](webhooks.md) arrives and the plugin checks the payment's amount and currency against the order. A confirmed payment that doesn't match puts the order **On hold** for you to review.
- A customer returning from checkout doesn't mark the order paid by itself.

## Refunds

Refund from the PayRouta dashboard under **Transactions**, then mark the order refunded in WooCommerce. Refunds made in WooCommerce aren't sent to PayRouta.

## Troubleshooting

| What you see | What to check |
| --- | --- |
| PayRouta doesn't appear at checkout | The plugin is enabled; the API URL starts with `https://`; the secret key matches the environment (`pr_sandbox_` for Sandbox, `pr_production_` for Production). |
| "We couldn't start the secure checkout" | The key has **payments:write**; your checkout return website in PayRouta is your store's address. Details are in **WooCommerce → Status → Logs** under `payrouta`. |
| The order stays **Pending payment** after paying | Check the delivery in PayRouta under **Developers → Webhooks**. The endpoint, key ID and secret must match the plugin. If your permalinks are set to **Plain**, use `https://YOUR-STORE/?rest_route=/payrouta/v1/webhook`. |
| The order is **On hold** | The confirmed payment didn't match the order total or currency, for example after the order was edited. Compare them in PayRouta and settle with the customer. |

## Resources

- [Webhooks](webhooks.md): signatures, retries and redelivery
- [Checkout button](checkout-button.md): the PayRouta checkout your customers see
- [Pay with credit](credit.md) and [Crypto payments](crypto-payments.md)
- WooCommerce: [payment settings](https://woocommerce.com/document/payments/), [managing orders](https://woocommerce.com/document/managing-orders/), [cart and checkout pages](https://woocommerce.com/document/customizing-cart-and-checkout/)
- WordPress: [managing plugins](https://wordpress.org/documentation/article/manage-plugins/), [permalink settings](https://wordpress.org/documentation/article/settings-permalinks-screen/)
