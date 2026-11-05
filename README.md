# PayRouta

**A universal checkout button powered by NEAR Intents.** Any merchant or app adds one button. The customer pays with any token, on any chain, from any wallet, even a token PayRouta has never listed, found by pasting its contract address. The merchant is paid in the asset or currency it chose, whatever the customer paid with.

```html
<script src="https://payrouta.com/js/v1/payrouta.js" async></script>
<button data-payrouta-checkout="/create-checkout">Checkout</button>
```

## How it works

**The customer pays with whatever they hold.**

- **Any token on any chain.** NEAR Intents (through its 1Click API) gives access to 125+ assets on 36+ chains, including Bitcoin, Ethereum, Solana, NEAR, Tron, TON, BNB Chain, Base, Arbitrum, Polygon, Avalanche and Stellar.
- **Any token by contract address.** A customer holding an unlisted token, such as a coin launched on Pump.fun, pastes its contract address. The wallet swaps it into USDC on the same chain (Jupiter on Solana, LI.FI on EVM chains), and NEAR Intents takes it from there (`lib/intents/dex.ts`).
- **Any wallet.** The checkout connects EVM wallets (EIP-6963), Solana wallets and NEAR wallets (NEAR Connect). Customers with any other wallet or an exchange account send to a one-time deposit address, with a refund address in case the swap can't complete.
- **No crypto at all.** The same button also takes cards, digital wallets, bank transfers, mobile money, USSD and credit from licensed lenders.

**The merchant is paid in its choice of asset or currency, whatever the customer paid with.**

- **An exact amount, never an estimate.** Each payment is an exact-output intent: solvers compete to deliver the invoice amount in the merchant's settlement stablecoin (USDC or USDT on Base, Ethereum, Arbitrum, Polygon, Avalanche, Solana or Stellar). If they can't deliver it before the deadline, the customer is refunded and the order isn't marked paid.
- **Into an account the merchant owns.** Payments settle into the merchant's own NEAR Intents account: a NEAR account or an EVM address, proved with a signed challenge (NEP-413 or ERC-191). PayRouta never holds the keys or the funds. Settlement is confirmed from the swap's `intents.near` events (`lib/intents/near.ts`).
- **Then into any token or fiat.** From that balance, the merchant converts to any token on any chain that NEAR Intents supports, pays suppliers and staff, and refunds customers to the chain they paid from. Each transfer is one signature with no gas (`lib/intents/payouts.ts`). They can also cash out to a bank or mobile money in US dollars, euros, naira, cedi, Kenyan, Ugandan and Tanzanian shillings, rand, kwacha or Mexican pesos, through Bridge and Yellow Card (`docs/cash-out.md`).

So one button works for every customer, and the merchant never has to hold the token or chain the customer paid with.

## Also in the box

- **Credit at checkout.** Customers in the global south can pay or subscribe with credit from a licensed lender in their country. The merchant is paid in full and the lender carries the risk.
- **Fiat through regulated partners.** PayRouta is an aggregator (see [docs/AGGREGATOR.md](docs/AGGREGATOR.md)). It verifies merchants once, opens their sub-accounts with regulated processing partners, routes each payment with a backup, and holds each merchant's ledger. Merchant balances sit with the regulated partners, never in PayRouta's bank accounts, and PayRouta is not the merchant of record.
- **Everywhere merchants sell.** The button, payment links, invoices, a Shopify payments app and a WooCommerce plugin.

The thesis and its status pillar by pillar: [docs/THESIS.md](docs/THESIS.md). Cross-chain details: [docs/cross-chain.md](docs/cross-chain.md).

## What is in this repository

| Area | Path |
| --- | --- |
| Marketing site and public docs | `app/page.tsx`, `app/[...path]`, `components/marketing`, `content/`, `docs/*.md` (served at `/docs`) |
| Merchant workspace | `app/merchant`, `lib/merchant` |
| Partner onboarding (merchant-owned accounts) | `lib/partners`, `app/api/partners`, `app/merchant/[[...path]]/providers.tsx` |
| Payments: intents, checkout, routing, execution, reconciliation | `lib/payments`, `app/checkout`, `app/api/v1` (merchant API) |
| Universal checkout button | `public/js/v1/payrouta.js`, `sdks/checkout`, `lib/payments/universal.ts`, `lib/payments/checkout-group.ts` |
| Credit at checkout (lenders as platform modules) | `lib/treasury/credit.ts`, `lib/treasury/credit-checkout.ts`, `lib/treasury/platforms/sandbox-credit.ts` |
| NEAR Intents: cross-chain checkout, merchant intents account, payouts and refunds, contract-address tokens | `lib/intents`, `app/checkout/[sessionId]/cross-chain.tsx`, `pay-picker.tsx`, `swap-wallet.ts`, `app/merchant/[[...path]]/intents.tsx` |
| Shopify payments app, WooCommerce plugin | `lib/integrations/shopify.ts`, `app/api/integrations/shopify`, `integrations/` |
| Provider portal (Provider API, certification, registry) | `app/provider`, `lib/portal`, `lib/providers` |
| Operations console | `app/ops` |
| Background worker | `scripts/worker.ts`, `lib/portal/worker.ts` |
| SDKs (private 0.1.0) | `sdks/node`, `sdks/python` |

## Run locally

Node 24 and a local PostgreSQL 17 (`npm run portal:db` uses Homebrew's `postgresql@17`).

```sh
npm ci
npm run portal:env        # writes .env for local mode and a vault key outside the repo
npm run portal:db         # starts PostgreSQL on 127.0.0.1:55432
npm run db:migrate
npm run db:seed           # fictional users (owner@harbor.example / PayRouta-Local-2026!)
npm run payments:seed     # fictional merchant and simulated providers
npm run portal:worker     # terminal 2
npm run dev               # http://127.0.0.1:3000
```

Local mode uses fictional data only: mail is captured to `.local/portal/mail` (viewer at `/provider/dev-mail`), and the demo authenticator code `123456` works. Never run local mode on a public host.

## Tests

```sh
npm run typecheck && npm run lint
npm test                   # unit tests, including partner module conformance
npm run test:partners      # database: onboarding, screening, consent, partner payments, secret store
npm run test:payments      # database: intents, checkout, attempts, settlement, journal
npm run test:merchant      # database: merchant API
npm run test:treasury      # database: aggregator, credit, universal checkout, Shopify
npm run test:intents       # database: cross-chain payments with a fake 1Click
npm run test:merchant-browser   # needs the app running on :3000
npm run test:e2e           # marketing site journeys
```

## Documentation

- Thesis and pillar status: [`docs/THESIS.md`](docs/THESIS.md)
- Public developer docs: `docs/overview.md` onwards (served at `/docs`), including the checkout button, credit, cross-chain, WooCommerce and Shopify guides
- Production runbook: [`docs/PRODUCTION.md`](docs/PRODUCTION.md)
- Partner programme and trust controls, and adding a provider: [`docs/PARTNER-PROGRAM.md`](docs/PARTNER-PROGRAM.md)
- Aggregator model (platform accounts, underwriting, merchant-funds ledger): [`docs/AGGREGATOR.md`](docs/AGGREGATOR.md)
- Merchant API internals: [`docs/MERCHANT-API.md`](docs/MERCHANT-API.md); payments internals: [`docs/PAYMENTS.md`](docs/PAYMENTS.md)
- Provider portal: [`docs/PROVIDER-PORTAL.md`](docs/PROVIDER-PORTAL.md)

## Status

Early access. NEAR Intents payments are on for production checkouts. 1Click runs on mainnet only, so sandbox checkouts test direct testnet transfers instead. The sandbox works end to end for everything else. Live payments open partner by partner, once each partner module has passed qualification in that provider's own sandbox and the partner connection is enabled. See `docs/PRODUCTION.md` for the launch sequence and the items that code cannot supply.

## Pricing and launch readiness

- [Platform fees and monthly statements](docs/PLATFORM-BILLING.md)
- [Global launch checklist](docs/LAUNCH-CHECKLIST.md)
