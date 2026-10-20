# PayRouta for Shopify (payments app)

An offsite payments extension. At Shopify checkout the buyer chooses PayRouta and is sent to a PayRouta universal checkout with every method the merchant accepts, including credit from licensed lenders and, for USD stores, stablecoins and crypto from any wallet and chain.

The app backend lives in this repository (`lib/integrations/shopify.ts`, `app/api/integrations/shopify/*`). This folder only holds the Shopify CLI configuration. Full guide, including the mTLS setup and Shopify's approval process: `docs/shopify.md`.

Status: built and unit-tested against Shopify's documented contracts. It has not run against a Shopify development store yet, and Shopify must approve PayRouta as a payments partner (restricted scopes `write_payment_gateways`, `write_payment_sessions`) before any production store can install it.
