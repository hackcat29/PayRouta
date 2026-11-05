# PayRouta thesis

**A universal checkout button powered by NEAR Intents: any merchant or app takes payment with whatever the customer has.**

The customer pays with any token on any chain, from any wallet, even an unlisted token found by its contract address. The merchant is paid in the stablecoin it chose, exactly the invoice amount, into a NEAR Intents account it owns. From there it converts to any token on any chain, or cashes out to fiat. How the customer paid never decides what the merchant receives.

The same button reaches customers who hold no crypto: card, wallets, bank, mobile money and USSD, and credit. Credit at checkout is PayRouta's answer to the global south's other problem: many people can't pay for things in one go, and few have a credit card. A licensed lender in the customer's country pays the merchant in full and carries the risk.

## The pillars

| Pillar | What it means | Where it lives |
| --- | --- | --- |
| **1. One checkout button** | A merchant or app adds one button. The customer pays with any method the merchant accepts where the customer is. | `public/js/v1/payrouta.js`, `sdks/checkout`, `POST /checkouts` (`lib/payments/universal.ts`), checkout bridge `app/checkout/[sessionId]/popup.ts` |
| **2. Any token, any chain, any wallet (NEAR Intents)** | The customer pays with any of 125+ assets on 36+ chains through 1Click, or with any token that has DEX liquidity by pasting its contract address (swapped in the wallet to USDC, then through intents). EVM, Solana and NEAR wallets connect, and any other wallet or exchange pays a one-time deposit address. Each payment is an exact-output intent, so the merchant receives exactly the invoice amount in its settlement stablecoin, into its own NEAR Intents account. From that account the merchant converts to any token on any chain, pays out and refunds gas-free, or cashes out to fiat (Bridge, Yellow Card). | `lib/intents` (`checkout.ts`, `oneclick.ts`, `dex.ts`, `account.ts`, `near.ts`, `payouts.ts`), `lib/blockchain` (direct), `app/checkout/[sessionId]/cross-chain.tsx`, `pay-picker.tsx`, `lib/treasury/offramp` |
| **3. Credit for the global south** | "Pay with credit" is a method like any other. Licensed lenders (for example a lender such as OPay in Nigeria) price plans per payment; the customer chooses, the lender approves and pays the merchant, and the customer repays the lender. Subscriptions are sold on credit as term plans repaid monthly. | `lib/treasury/credit.ts`, `lib/treasury/credit-checkout.ts`, credit contract in `lib/treasury/platforms/contract.ts`, sandbox lender `sandbox-credit.ts`, plan picker in `fiat-view.tsx` |
| **4. Everywhere merchants sell** | Global merchants, and platforms where they already sell: Shopify, WooCommerce and similar. | `integrations/woocommerce`, `integrations/shopify`, `lib/integrations/shopify.ts`, `app/api/integrations/shopify` |

## Status (20 October 2026)

The public site states these with the labels in `content/claims.ts` (`pillars`, `platforms`). Never present a pillar as live before it is.

| Pillar | Built | Live | Between here and live |
| --- | --- | --- | --- |
| Checkout button | Yes | Yes, for stablecoin and crypto checkouts | Fiat rails open region by region (platform accounts, `docs/AGGREGATOR.md`) |
| Credit | Yes, end to end in sandbox | No | Sign the first licensed lenders and write their modules against their real APIs (do not guess a lender's API); lender merchant-fee terms; consumer-credit disclosure review per country; merchant terms addendum for credit |
| Any wallet, direct | Yes | Yes, 8 networks | — |
| Any chain via intents | Yes | Yes, production checkouts (on 20 Oct 2026; `CROSS_CHAIN_PAYMENTS=off` turns it off) | 1Click partner key (without one, 1Click adds a 1 bp fee); first real mainnet cross-chain payment per destination. A live dry-run quote on 20 Oct 2026 confirmed exact output (`amountOut` = `minAmountOut` = invoice) and a minimum for that pair (minimums vary by asset, pair and network); volatile-coin destinations need longer quotes |
| WooCommerce | Yes (plugin 0.1.0) | No | Lint-clean on PHP 8.5, and its webhook signature check verified against Node-generated signatures; still to run on a real WordPress/WooCommerce install, package and distribute, then list on WordPress.org |
| Shopify | Yes (payments app) | No | Shopify payments-partner approval (restricted scopes); run against a development store; mTLS host deployed with Shopify's CA; listing |

## Product rules that follow from the thesis

- **Credit is shown as credit.** The customer sees the lender's name, every payment, the total and the cost of credit before agreeing. Lenders carry credit risk; merchants and PayRouta never do. PayRouta does not lend.
- **One button, one order.** A universal checkout may hold a fiat intent and a crypto intent, but only one can be paid (`lib/payments/checkout-group.ts`).
- **Crypto is never converted at an estimate.** Crypto is offered on universal checkouts only for USD orders until a reviewed FX source exists for other currencies.
- **Webhooks prompt; the API decides.** Every integration (WooCommerce, Shopify, merchants' own servers) treats a browser event or webhook as a prompt and confirms by reading PayRouta's API or its own verified state.

## Where things live

- Code: private `hackcat29/PayRouta` (the UncleTom29 account is suspended).
- Public docs: the Mintlify site in `mintlify/`, deployed by Mintlify's GitHub app (monorepo path `mintlify`). The in-app `/docs` pages are generated from `docs/*.md` and stay until the Mintlify site is live.

## Next, in order

1. First lender partnerships (Nigeria, then Kenya, matching the regional entities in `docs/AGGREGATOR.md`), each as a platform module with the credit contract.
2. Shopify payments-partner application and a development-store run.
3. WooCommerce plugin on a real store; package it.
4. Live qualification of cross-chain payments.
5. Recurring billing (card and mobile-money subscriptions) so subscriptions work without credit too; today subscriptions are sold on credit as term plans.
6. More platforms: Wix, BigCommerce, Squarespace, and app frameworks (React Native, Flutter) for the button.
