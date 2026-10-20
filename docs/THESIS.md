# PayRouta thesis

**One checkout button that lets any merchant or app take payment with whatever the customer has, including credit.**

Most payment processors promise a long list of payment methods. That solves the ease of paying, but not the bigger problem for most people in the global south: they can't pay for many things in one go, and few have a credit card. PayRouta's distinctive competency is credit at checkout. A customer can pay for, or subscribe to, a product on credit from a licensed lender in their country, while the merchant is paid in full.

## The four pillars

| Pillar | What it means | Where it lives |
| --- | --- | --- |
| **1. One checkout button** | A merchant or app adds one button. The customer pays with any method the merchant accepts where the customer is. | `public/js/v1/payrouta.js`, `sdks/checkout`, `POST /checkouts` (`lib/payments/universal.ts`), checkout bridge `app/checkout/[sessionId]/popup.ts` |
| **2. Credit for the global south** | "Pay with credit" is a method like any other. Licensed lenders (for example a lender such as OPay in Nigeria) price plans per payment; the customer chooses, the lender approves and pays the merchant, and the customer repays the lender. Subscriptions are sold on credit as term plans repaid monthly. | `lib/treasury/credit.ts`, `lib/treasury/credit-checkout.ts`, credit contract in `lib/treasury/platforms/contract.ts`, sandbox lender `sandbox-credit.ts`, plan picker in `fiat-view.tsx` |
| **3. Crypto from any wallet and chain** | The same button takes stablecoins and crypto to the merchant's own wallet, from any wallet; customers holding another token on another chain pay through intents (exact-output swaps) and the merchant still receives exactly what it asked for. | `lib/blockchain` (direct), `lib/intents` (NEAR Intents, a universal liquidity layer for 125+ assets across 36+ chains, via its 1Click API), `cross-chain.tsx` |
| **4. Everywhere merchants sell** | Global merchants, and platforms where they already sell: Shopify, WooCommerce and similar. | `integrations/woocommerce`, `integrations/shopify`, `lib/integrations/shopify.ts`, `app/api/integrations/shopify` |

## Status (20 October 2026)

The public site states these with the labels in `content/claims.ts` (`pillars`, `platforms`). Never present a pillar as live before it is.

| Pillar | Built | Live | Between here and live |
| --- | --- | --- | --- |
| Checkout button | Yes | Yes, for stablecoin and crypto checkouts | Fiat rails open region by region (platform accounts, `docs/AGGREGATOR.md`) |
| Credit | Yes, end to end in sandbox | No | Sign the first licensed lenders and write their modules against their real APIs (do not guess a lender's API); lender merchant-fee terms; consumer-credit disclosure review per country; merchant terms addendum for credit |
| Any wallet, direct | Yes | Yes, 8 networks | — |
| Any chain via intents | Yes, behind `CROSS_CHAIN_PAYMENTS` | No | 1Click partner key (without one, 1Click adds a 1 bp fee); first real mainnet cross-chain payment per destination. A live dry-run quote on 20 Oct 2026 confirmed exact output (`amountOut` = `minAmountOut` = invoice) and a temporary $100 minimum swap; volatile-coin destinations need longer quotes |
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
