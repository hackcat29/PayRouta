# Shopify

PayRouta is built as a Shopify **payments app** (offsite payments extension). At Shopify checkout the buyer chooses PayRouta and pays on a PayRouta checkout with every method you accept, including [credit from licensed lenders](credit.md) and, for USD stores, stablecoins and crypto from any wallet. When the payment is confirmed, PayRouta completes the order in Shopify and the buyer lands on Shopify's order page.

> **Status.** Built and tested against Shopify's documented contracts; not yet run against a Shopify development store. Payments apps use restricted scopes, so Shopify must approve PayRouta as a payments partner before any store outside development can install it.

## For merchants

1. In PayRouta, open **Developers → Integrations**, enter your `*.myshopify.com` address and choose **Connect Shopify**. Approve the app in Shopify.
2. Shopify opens its payment settings: activate PayRouta.
3. Test with your store in test mode, which uses your PayRouta sandbox. Shopify test mode and PayRouta sandbox must match; a live store needs a live PayRouta business.

Refunds made in Shopify are sent to PayRouta and refunded on the original rail. Orders paid in crypto are refunded by you from your own wallet; Shopify is told so.

## How it works

| Step | What happens |
| --- | --- |
| Install | OAuth with scopes `write_payment_gateways,write_payment_sessions`, started from your PayRouta dashboard so the store is bound to your business. The access token is stored in PayRouta's encrypted vault. PayRouta then calls `paymentsAppConfigure` to mark the app ready. |
| Payment session | Shopify sends the session (amount, currency, buyer country, cancel URL) to PayRouta. PayRouta creates a [universal checkout](checkout-button.md) and answers with its `redirect_url`. Repeated requests with the same session ID return the same checkout. |
| Confirmation | When any payment in that checkout is confirmed, a job calls `paymentSessionResolve` and stores Shopify's order-page redirect. |
| Buyer returns | To Shopify's order page once resolved; back to the PayRouta checkout while a payment is still confirming; otherwise to Shopify checkout to choose again. Customer cancellations are never sent as rejections. |
| Refund session | Accepted with `201`, then refunded through PayRouta and reported with `refundSessionResolve` or `refundSessionReject`. |

## Operations

- **Mutual TLS.** Shopify calls payment and refund session URLs with a client certificate. Run them on a dedicated host with `ssl_verify_client on` and Shopify's CA (see the "Shopify payments app" block in `deploy/nginx.conf`). nginx forwards the verification result and a proxy secret; PayRouta refuses session requests without both, and the main host returns 404 for those paths.
- **Configuration.** `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET_REF`, `SHOPIFY_API_VERSION` (default `2026-10`) and `SHOPIFY_MTLS_PROXY_SECRET_REF`. App and extension TOML: `integrations/shopify`.
- **Webhooks.** `app/uninstalled` and the mandatory compliance topics go to `/api/integrations/shopify/webhooks`, verified with the app secret.
- **Approval.** Apply in the Shopify Partner Dashboard for the payments-partner programme; the extension's supported countries must match the listing.
