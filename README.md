# PayRouta

**One checkout button that lets any merchant or app take payment with whatever the customer has, including credit.** Customers pay by card, digital wallet, bank transfer, mobile money or USSD; with credit from licensed lenders in their country (PayRouta's differentiator: the merchant is paid in full, the lender carries the risk); or with stablecoins and crypto from any wallet and chain. Merchants add it with one button on any site or app, or through Shopify and WooCommerce. The thesis and its status pillar by pillar: [docs/THESIS.md](docs/THESIS.md).

Under the button, PayRouta is an aggregator (see [docs/AGGREGATOR.md](docs/AGGREGATOR.md)). Merchants apply once to PayRouta, which verifies them and opens their sub-accounts with its regulated processing partners and lenders by API. It routes each payment to a partner that can take it, keeps a backup for the same method, holds each merchant's ledger, pays merchants out on their schedule and reconciles everything in one place. Merchant balances sit with the regulated partners, never in PayRouta's own bank accounts, and PayRouta is not the merchant of record. Merchant-owned provider accounts and stablecoin deposits to the merchant's own wallet remain supported.

## What is in this repository

| Area | Path |
| --- | --- |
| Marketing site and public docs | `app/page.tsx`, `app/[...path]`, `components/marketing`, `content/`, `docs/*.md` (served at `/docs`) |
| Merchant workspace | `app/merchant`, `lib/merchant` |
| Partner onboarding (merchant-owned accounts) | `lib/partners`, `app/api/partners`, `app/merchant/[[...path]]/providers.tsx` |
| Payments: intents, checkout, routing, execution, reconciliation | `lib/payments`, `app/checkout`, `app/api/v1` (merchant API) |
| Checkout button and universal checkout | `public/js/v1/payrouta.js`, `sdks/checkout`, `lib/payments/universal.ts`, `lib/payments/checkout-group.ts` |
| Credit at checkout (lenders as platform modules) | `lib/treasury/credit.ts`, `lib/treasury/credit-checkout.ts`, `lib/treasury/platforms/sandbox-credit.ts` |
| Cross-chain crypto (NEAR Intents) | `lib/intents` |
| Shopify payments app, WooCommerce plugin | `lib/integrations/shopify.ts`, `app/api/integrations/shopify`, `integrations/` |
| Provider portal (Provider API, certification, registry) | `app/provider`, `lib/portal`, `lib/providers` |
| Operations console | `app/ops` |
| Background worker | `scripts/worker.ts`, `lib/portal/worker.ts` |
| SDKs (private 0.1.0) | `sdks/node`, `sdks/python` |
| MCP server (merchant tools, agent buyer tools) | `lib/mcp`, `app/api/mcp` |
| Command line (`payrouta`, a client of the MCP server) | `sdks/cli`; build with `npm run build --prefix sdks/cli` |
| 3D and motion (WebGPU globe, Loop mark, TypeGPU token flow) | `components/gpu`, `components/motion` |

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

Early access. The sandbox works end to end. Live payments open partner by partner, once each partner module has passed qualification in that provider's own sandbox and the partner connection is enabled. See `docs/PRODUCTION.md` for the launch sequence and the items that code cannot supply.

## Pricing and launch readiness

- [Platform fees and monthly statements](docs/PLATFORM-BILLING.md)
- [Global launch checklist](docs/LAUNCH-CHECKLIST.md)
