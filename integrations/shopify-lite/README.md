# PayRouta for Shopify (manual payment method)

The buyer chooses the PayRouta manual payment method at Shopify checkout, then pays from a **Pay** button on the Thank you and order status pages. PayRouta marks the order paid once the payment is confirmed and cancels orders left unpaid past the shop's deadline. No Payments Partner approval is needed.

The backend lives in this repository (`lib/integrations/shopify-lite.ts`, `app/api/integrations/shopify-lite/*`). This folder holds the Shopify CLI configuration and the Pay button extension. Setup: `docs/shopify.md`.

Status: built and tested against a fake Shopify Admin API. It has not run against a Shopify development store yet.
