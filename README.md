# PayRouta

**A universal checkout widget: any merchant, app, agent or store adds one checkout button, and their customers pay with intents from whatever wallet, blockchain or token they have.**

NEAR Intents does the conversion under the button. The customer pays from what they hold: USDT on Tron, ETH on Arbitrum, SOL, NEAR, or any token by its contract address. The merchant is paid the exact invoice amount in the stablecoin, token or local currency they choose, whatever the customer used. The button goes in anywhere: Shopify and WooCommerce stores, any website or app with one script tag, payment links, the Node and Python SDKs, and, for AI agents, an HTTP API, an MCP server and a CLI.

- Live site: [payrouta.com](https://payrouta.com) · Docs: [docs.payrouta.com](https://docs.payrouta.com) · Checkout demo: [payrouta.com/checkout/demo](https://payrouta.com/checkout/demo)
- **Demo video:** [PayRouta WooCommerce Mainnet Demo](https://youtu.be/esorKpU_jxg) (3 min): a real WooCommerce order paid with ETH on Base, settled in USDC through NEAR Intents. Narration, steps and on-chain proof: [Live demo](#live-demo-a-real-woocommerce-order-paid-with-eth-on-base-mainnet)
- NEAR HACKATHON tracks: **08 Real-World Money** (primary), **07 Agent Economy**, **04 Autonomous Business**

| The customer pays with | The merchant is paid in |
| --- | --- |
| **Any token.** The 200+ NEAR Intents lists on 35+ chains, and **millions more by contract address**: any token with DEX liquidity, on Solana via Jupiter or on EVM chains via LI.FI | USDC or USDT on the chain they choose (Base, Ethereum, Arbitrum, Polygon, Avalanche, Solana, Stellar), in a NEAR Intents account they own |
| A connected wallet on any EVM chain, Solana or NEAR | Any token on any chain, by paying out from that account, gasless |
| Any wallet or exchange, by sending to a one-time deposit address | Local currency in a bank or mobile money account: USD and EUR through Bridge; NGN, GHS, KES, ZAR, UGX, TZS, ZMW and MXN through Yellow Card |

## Sell on Shopify and WooCommerce

Most merchants already have a store, so PayRouta goes inside it. Both integrations are available today.

**WooCommerce.** The PayRouta Checkout plugin adds PayRouta as a payment method in the block and classic checkouts, with High-Performance Order Storage support. The customer pays on PayRouta, and a signed webhook marks the WooCommerce order paid.
- Download: [payrouta.com/downloads/payrouta-checkout.zip](https://payrouta.com/downloads/payrouta-checkout.zip). Setup guide: [docs/woocommerce](https://payrouta.com/docs/woocommerce)
- Code: [`integrations/woocommerce/payrouta-checkout`](integrations/woocommerce/payrouta-checkout): gateway, Blocks support, API client, webhook handler
- Verified end to end on WordPress 7.1.4 with WooCommerce 11.2.1, and with a real mainnet payment: [Live demo](#live-demo-a-real-woocommerce-order-paid-with-eth-on-base-mainnet)

**Shopify.** The buyer chooses PayRouta at checkout and pays from a **Pay** button on the Thank you and order status pages. PayRouta marks the order paid through the Admin API once the payment confirms. Unpaid orders are cancelled and restocked after a deadline the merchant sets.
- Setup guide: [docs/shopify](https://payrouta.com/docs/shopify)
- Code: [`integrations/shopify-lite`](integrations/shopify-lite) (checkout UI extension), [`lib/integrations/shopify-lite.ts`](lib/integrations/shopify-lite.ts)
- A full Shopify payments app is built as well ([`integrations/shopify`](integrations/shopify), [`lib/integrations/shopify.ts`](lib/integrations/shopify.ts)).
- Tests: [`tests/shopify-lite.test.ts`](tests/shopify-lite.test.ts), [`tests/shopify.test.ts`](tests/shopify.test.ts) and, with a database, [`tests/treasury/shopify-lite.test.ts`](tests/treasury/shopify-lite.test.ts), which covers "the buyer pays from the Pay button and the order is marked paid"

Other ways in: a payment link to share on WhatsApp or an invoice, one script tag ([`public/js/v1/payrouta.js`](public/js/v1/payrouta.js), [`sdks/checkout`](sdks/checkout)), Node and Python SDKs ([`sdks/node`](sdks/node), [`sdks/python`](sdks/python)), an MCP server and the `payrouta` CLI.

## Live demo: a real WooCommerce order paid with ETH on Base mainnet

<a href="https://youtu.be/esorKpU_jxg"><img src="docs/demo/00-title.jpg" alt="PayRouta WooCommerce Mainnet Demo, on YouTube" width="720"></a>

**Video: [PayRouta WooCommerce Mainnet Demo](https://youtu.be/esorKpU_jxg)** (3 min 13 s): one continuous recording of a real browser session on payrouta.com, with captions, a live UTC clock and music.

On 12 November 2026 a $2.00 order for a digital guide in a WooCommerce store was paid with **ETH on Base**. NEAR Intents swapped it into USDC and delivered **1.970915 USDC** (the 2.000929 USDC invoice less PayRouta's 1.5% fee) to the merchant's NEAR Intents account. PayRouta confirmed the payment from the chain, and WooCommerce marked the order paid. Real funds on mainnet; the store runs the PayRouta Checkout plugin 0.1.0 on WordPress 7.1.4 and WooCommerce 11.2.1.

### Steps and narration

Each step links to its moment in the video.

#### 1. The store: [0:08](https://youtu.be/esorKpU_jxg?t=8)

> Kiwi Store is an ordinary WooCommerce shop selling a $2 digital city guide. The only addition is the PayRouta Checkout plugin.

<img src="docs/demo/01-store-product.jpg" alt="Kiwi Store product page: Lagos Weekend Field Guide, $2.00" width="720">

#### 2. Checkout with PayRouta: [0:14](https://youtu.be/esorKpU_jxg?t=14)

> The customer adds the guide to the cart and checks out as a guest. PayRouta is a payment option at WooCommerce checkout.

<img src="docs/demo/02-store-checkout.jpg" alt="WooCommerce checkout with Pay with PayRouta selected" width="720">

Placing the order makes the plugin call `POST https://payrouta.com/api/v1/checkouts` with the order total, currency, return URL and a stable idempotency key, then send the buyer to the PayRouta checkout ([`class-wc-gateway-payrouta.php`](integrations/woocommerce/payrouta-checkout/includes/class-wc-gateway-payrouta.php)).

#### 3. Any token on any chain: [0:33](https://youtu.be/esorKpU_jxg?t=33)

> On PayRouta the customer sees every token NEAR Intents supports, 200+ tokens on 35+ chains, priced live. Any other token works too: paste its contract address and pay with it, from millions of tokens. They don't choose a network or bridge anything. They say what they hold.

<img src="docs/demo/03-payrouta-token-picker.jpg" alt="PayRouta token picker listing NEAR Intents tokens across chains" width="720">

#### 4. The NEAR Intents quote: [0:44](https://youtu.be/esorKpU_jxg?t=44) and [1:04](https://youtu.be/esorKpU_jxg?t=64)

> The customer picks ETH on Base, a token the merchant doesn't want, and gives the address a failed swap would be refunded to. PayRouta asks NEAR Intents for an exact-output quote: deliver exactly the invoice amount to the merchant's account. The checkout shows a one-time deposit address and the exact ETH to send: 0.001005322573809397.

<img src="docs/demo/04-near-intents-quote.jpg" alt="PayRouta checkout showing the one-time deposit address, QR code and exact ETH amount" width="720">

The merchant never absorbs swap costs or slippage. The quote is for the merchant's net amount, so they receive the invoice less PayRouta's fee, taken at source ([`lib/intents/checkout.ts`](lib/intents/checkout.ts)).

#### 5. The customer sends ETH from their own wallet: [1:14](https://youtu.be/esorKpU_jxg?t=74)

> The customer sends exactly that amount from their wallet on Base. The wait is sped up 24 times; the clock in the corner is real UTC.

<img src="docs/demo/05-waiting-live-clock.jpg" alt="Checkout waiting for the transfer, with a live UTC clock" width="720">

#### 6. NEAR Intents swaps it: [1:34](https://youtu.be/esorKpU_jxg?t=94)

> NEAR Intents sees the deposit and swaps the ETH into USDC.

<img src="docs/demo/06-transfer-seen.jpg" alt="Checkout showing transfer sent, processing, payment confirmed steps" width="720">

#### 7. PayRouta confirms from the chain: [1:49](https://youtu.be/esorKpU_jxg?t=109)

> PayRouta doesn't take the swap's own status on trust. It reads the swap's transfers back from NEAR and confirms the payment only when the exact amount has landed in the merchant's account, made by this swap's own intents.

<img src="docs/demo/07-payment-received.jpg" alt="PayRouta checkout: Payment received, paid with ETH on Base" width="720">

The confirmation logic is [`near-intents-deposit.ts`](lib/providers/adapters/native/near-intents-deposit.ts), covered by `tests/near-intents.test.ts`.

#### 8. The store marks the order paid: [1:55](https://youtu.be/esorKpU_jxg?t=115) and [2:11](https://youtu.be/esorKpU_jxg?t=131)

> The customer returns to the store. PayRouta signs a webhook to WooCommerce. The plugin verifies the signature, fetches the payment from the PayRouta API to check that it is Confirmed, and only then marks the order paid and unlocks the download.

<img src="docs/demo/08-order-completed.jpg" alt="WooCommerce Order completed page with the download unlocked" width="720">

The webhook handler is [`class-payrouta-webhook.php`](integrations/woocommerce/payrouta-checkout/includes/class-payrouta-webhook.php).

#### 9. The merchant's view: [2:25](https://youtu.be/esorKpU_jxg?t=145)

> In WooCommerce admin, order #16 is Completed, with the note "Paid through PayRouta (stablecoin, 2.000929 on-chain)".

<img src="docs/demo/09-woocommerce-admin-paid.jpg" alt="WooCommerce admin: order #16 paid, with the PayRouta order note" width="720">

#### 10. On-chain proof: [2:37](https://youtu.be/esorKpU_jxg?t=157) and [2:51](https://youtu.be/esorKpU_jxg?t=171)

> Here is the customer's transfer on BaseScan, and the swap on the NEAR Intents explorer: deposit, swap, and 1.970915 USDC delivered to the merchant.

<img src="docs/demo/10-basescan-deposit.jpg" alt="BaseScan: the ETH transfer to the deposit address, status Success" width="720">

<img src="docs/demo/11-near-intents-explorer.jpg" alt="NEAR Intents explorer: Created, Deposit Completed, Processed, Withdrawn" width="720">

<img src="docs/demo/12-near-intents-from-to.jpg" alt="NEAR Intents explorer: from 0.000998763 ETH on Base to 1.970915 USDC, with transaction hashes" width="720">

### On-chain proof

| Evidence | Check it | What it shows |
| --- | --- | --- |
| The customer's ETH transfer | [BaseScan: `0xb183ed3a…e3320`](https://basescan.org/tx/0xb183ed3a979bb4cebdcc51d0a2c8f1bbbfa368427aeee0fb6b8539f5a10e3320) | 0.001005322573809397 ETH from `0x59ee649f1D4437374B42Dbe3897AB894937F2744` to the one-time deposit address `0x041bc4514C6FE3D2Da21F1EC025cf4e764381287`. Base block 56600068, 2026-11-12 19:06:29 UTC, status Success. |
| The swap | [NEAR Intents explorer](https://explorer.near-intents.org/transactions/0x041bc4514C6FE3D2Da21F1EC025cf4e764381287) | Status SUCCESS. 0.000998763960227881 ETH swapped into **1.970915 USDC**, delivered to the merchant's NEAR Intents account (`0x3fa0…a130bc` on the explorer). |
| Delivery on NEAR | [NEAR tx `Ef1FdMpB…vuwpw`](https://nearblocks.io/txns/Ef1FdMpB6Wac1nNCwNbNcLJBWvgrV62pTFFHYsbvuwpw) | The swap's withdrawal into the merchant's account. The other NEAR transactions and the three intent hashes are listed below. |
| Unused slippage headroom returned | [BaseScan: `0xe582071…d25d36`](https://basescan.org/tx/0xe582071049d59783ae1b30ebcbc4f7dae65f2a6f09b7ed4d81a3444e7fd25d36) | 0.000005998614 ETH back to the customer's address, in Base block 56600342. The quote includes headroom for price movement (up to 1%); what the swap doesn't need is refunded. |
| The order in WooCommerce | Order #16, status Completed | Order note "Paid through PayRouta (stablecoin, 2.000929 on-chain)". PayRouta payment ID `cmwdwxkfp00qoejkk0lau01ht`. |

The numbers reconcile: a $2.00 invoice was quoted as 2.000929 USDC, and 2.000929 × 0.985 = 1.970915 USDC, what the merchant received.

<details>
<summary>All NEAR transactions and intent hashes of the swap</summary>

NEAR transactions: `5qvgmCkiNDYoU5aDQaXRrgimPwSjDN9qVFkaFQ2oEB7i`, `A7czay4RtzU97MtWbHCDu1tsnkdggkbAtgeDdHKe3UfQ`, `4YKDhjfUU2p2HGiai4oi5jY8Ut6eRxDBmLMo5otYXkX7`, `Ef1FdMpB6Wac1nNCwNbNcLJBWvgrV62pTFFHYsbvuwpw`, `sQPFs2owDKaJpydWT7c7SMderUMFSKKzTFhftzNvi5k`

Intent hashes: `5ft6xg4o4L1b2TQms75XGsiZ8tPGSAMNuCPKrPrdMgSv`, `HekiymAzexh3UQKHWF9kFJbu9mYbKMgPaqT2ztGcR3Gi`, `Hk7pFQN4oXgoeEcNUip8bjr9fpQCQva8UfTPAjPSVjeT`

</details>

**Verify it yourself**, with no keys:

```sh
# The swap's status, from NEAR Intents' public API
curl -s "https://1click.chaindefuser.com/v0/status?depositAddress=0x041bc4514C6FE3D2Da21F1EC025cf4e764381287"

# The deposit and the refund, from a public Base RPC
for tx in 0xb183ed3a979bb4cebdcc51d0a2c8f1bbbfa368427aeee0fb6b8539f5a10e3320 \
          0xe582071049d59783ae1b30ebcbc4f7dae65f2a6f09b7ed4d81a3444e7fd25d36; do
  curl -s https://mainnet.base.org -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"eth_getTransactionByHash\",\"params\":[\"$tx\"]}"
done
```

### Timeline (UTC, 12 November 2026)

| Time | Event |
| --- | --- |
| 19:00:50 | PayRouta issues the quote and the one-time deposit address |
| 19:06:29 | The ETH transfer is included on Base (block 56600068) |
| 19:07:29 | NEAR Intents reports the swap SUCCESS |
| about 19:07:32 | The PayRouta checkout shows Payment received |

To set up the same flow on your own store, follow the [WooCommerce guide](https://payrouta.com/docs/woocommerce): install the plugin, create an API key with `payments:write` and `payments:read`, and connect the webhook.

## How a payment settles through NEAR Intents

```mermaid
sequenceDiagram
    participant C as Customer wallet (any chain)
    participant P as PayRouta
    participant Q as NEAR Intents 1Click
    participant N as intents.near
    participant M as Merchant
    P->>Q: Exact-output quote: invoice amount into the merchant's account, PayRouta's fee as appFees
    Q-->>P: One-time deposit address
    C->>Q: Sends the token they hold
    Q->>N: Swap delivers the exact amount to the merchant's account
    P->>N: Reads the swap's own transfer back from NEAR
    P-->>M: Payment confirmed: webhook, Shopify or WooCommerce order marked paid
```

1. **The merchant owns the account.** They connect a NEAR Intents account by signing a message in their own wallet: NEP-413 for NEAR accounts, ERC-191 for EVM addresses, raw Ed25519 for Solana. A merchant with no wallet can create one by signing in with Google, Apple, X or email, and owns its key. PayRouta never holds the keys or the funds. ([`lib/intents/signing.ts`](lib/intents/signing.ts), [`lib/intents/account.ts`](lib/intents/account.ts), [`lib/intents/near.ts`](lib/intents/near.ts))
2. **Exact-output quotes.** PayRouta asks 1Click for a quote that delivers exactly the invoice amount, so the merchant never absorbs swap costs or slippage. If the swap fails, NEAR Intents refunds the customer on their own chain. ([`lib/intents/oneclick.ts`](lib/intents/oneclick.ts), [`lib/intents/checkout.ts`](lib/intents/checkout.ts))
3. **Confirmation comes from the chain.** 1Click reporting success is not enough. PayRouta reads the swap's NEAR transactions and confirms only a final `intents.near` transfer of exactly that amount into the merchant's account, made by one of that swap's own intents. Each transfer can confirm one payment only. ([`lib/providers/adapters/native/near-intents-deposit.ts`](lib/providers/adapters/native/near-intents-deposit.ts))
4. **The fee is taken at source.** PayRouta's 1.5% is collected in the same swap through 1Click `appFees`, so there are no invoices to chase. This is the business model, and it works from the first payment.
5. **Payouts and refunds to any chain, gasless.** From the same balance, the merchant pays suppliers or refunds customers in any token on any chain by signing one intent. Before the wallet signs, PayRouta checks that the intent moves exactly the quoted amount to the quote's deposit account and nothing else. ([`lib/intents/payouts.ts`](lib/intents/payouts.ts))
6. **Settle in a bank.** With bank settlement on, each quote delivers USDC on Base straight to the merchant's Bridge liquidation address or to PayRouta's Yellow Card balance. The payment confirms on the finalized Base transfer, then a bank or mobile money payout follows. ([`lib/providers/adapters/native/near-intents-offramp.ts`](lib/providers/adapters/native/near-intents-offramp.ts), [`lib/treasury/offramp`](lib/treasury/offramp))
7. **Millions more tokens, by contract address.** A customer can paste the contract address of any token with DEX liquidity on Solana or the supported EVM chains. The token is swapped into USDC in their own wallet first, and the payment succeeds only if that swap delivers at least the payment amount. ([`lib/intents/dex.ts`](lib/intents/dex.ts))

Full guide: [docs/near-intents](https://payrouta.com/docs/near-intents) and [`content/docs/near-intents.md`](content/docs/near-intents.md).

## Payments by and for AI agents

- **Agents pay over HTTP.** `GET /api/agent/v1/links/{id}` answers `402 Payment Required` with the amount and the ways to pay. An agent pays from its wallet, or signs one transfer from its NEAR Intents balance. ([`app/api/agent/v1`](app/api/agent/v1), [docs/agents](https://payrouta.com/docs/agents))
- **Agent keys with limits.** A business gives an agent a key with a daily, weekly or monthly budget, a per-payment cap and an optional merchant allow-list. PayRouta checks every payment against them before preparing it.
- **MCP server** at `/api/mcp` ([`lib/mcp`](lib/mcp)). Merchant tools: `create_checkout`, `create_payment_link`, `list_payments`, `refund_payment`, `create_plan`, `create_subscription`, `record_usage` and more. Buyer tools for agent keys: `get_payment_terms`, `open_checkout`, `pay_checkout`, `submit_signed_intent`, `get_spending`.
- **`payrouta` CLI** ([`sdks/cli`](sdks/cli)): a zero-dependency client of the MCP server for terminals, scripts and CI.
- **Subscriptions.** Plans and usage meters. Each invoice can be paid from any wallet, including by an agent over MCP.

## Check it yourself

Node 24. These need no database and no API keys:

```sh
npm ci                      # also generates the Prisma client
npm test                    # 759 unit tests: NEAR Intents, 1Click, signatures, Shopify, agents, MCP, CLI, fees
npm run typecheck
npm run lint
npm run test:sdk-python
npm run build --prefix sdks/cli
```

With a local PostgreSQL 17 (`npm run portal:db` uses Homebrew's `postgresql@17`), the end-to-end suites run against a simulated 1Click API and sandbox providers:

```sh
npm run portal:env && npm run portal:db && npm run db:migrate
npm run test:intents        # cross-chain checkouts, NEAR Intents settlement, DEX tokens, agent payments from an intents balance
npm run test:agents         # 402 terms, agent keys and budgets, MCP for merchants and buyers
npm run test:treasury       # Shopify, payment links, subscriptions, bank cash-out
npm run test:payments && npm run test:merchant && npm run test:partners && npm run test:email
```

### Where each claim is tested

| Claim | Code | Test |
| --- | --- | --- |
| A Base USDC invoice is paid with Tron USDT and the merchant receives the exact amount | `lib/intents/checkout.ts` | `tests/intents/database.test.ts`: "cross-chain: a customer pays a Base USDC invoice with Tron USDT…" |
| Quotes are exact-output and refund on the customer's chain | `lib/intents/oneclick.ts` | `tests/intents.test.ts`: "quotes ask for an exact-output swap…" |
| Confirmation only after the swap's own delivery is final on NEAR, claimed once | `near-intents-deposit.ts` | `tests/near-intents.test.ts`: "the adapter confirms only after the swap's delivery is final on NEAR, and claims it once" |
| Batched settlements count only this swap's transfers | `near-intents-deposit.ts` | `tests/near-intents.test.ts`: "deliveries count only the swap's own transfers…" |
| The fee is withheld at source and the payment still confirms in full | `lib/intents/oneclick.ts` | `tests/near-intents.test.ts`: "with PayRouta's fee withheld at source…" |
| NEAR, EVM and Solana wallets own the account | `lib/intents/signing.ts` | `tests/near-intents.test.ts`: NEP-413, ERC-191 and Solana tests |
| A payout signs exactly the quoted transfer and nothing else | `lib/intents/payouts.ts` | `tests/near-intents.test.ts`: "a payout's funding intent must be exactly the quoted transfer…" |
| Settled to a bank only on the swap's finalized USDC transfer | `near-intents-offramp.ts` | `tests/near-intents.test.ts`: "settled straight to the bank…" |
| Any token by contract address, with the swap before the payment | `lib/intents/dex.ts` | `tests/intents/database.test.ts`: "dex: …" (3 tests) |
| Shopify order marked paid after the Pay button; unpaid orders cancelled | `lib/integrations/shopify-lite.ts` | `tests/treasury/shopify-lite.test.ts` |
| Agents get 402 terms and are held to their key's budget | `app/api/agent/v1`, `lib/agents` | `tests/agents/database.test.ts`, `tests/agents.test.ts` |
| An agent pays from its NEAR Intents balance by signing one transfer | `lib/intents` | `tests/intents/database.test.ts`: "near intents: an agent pays from its intents balance…" |
| MCP tools and CLI | `lib/mcp`, `sdks/cli` | `tests/agents/database.test.ts`, `tests/cli.test.ts` |
| A real WooCommerce order paid with ETH on Base on mainnet, settled in USDC | `integrations/woocommerce/payrouta-checkout`, `lib/intents` | [Live demo](#live-demo-a-real-woocommerce-order-paid-with-eth-on-base-mainnet): Base tx `0xb183ed3a…e3320`, NEAR Intents deposit `0x041bc451…381287`, WooCommerce order #16 |

NEAR Intents settlement runs on mainnet (1Click has no testnet). The suites use 1Click and NEAR RPC responses in the shapes the real APIs return, and a real mainnet payment, with every transaction ID, is documented in the [Live demo](#live-demo-a-real-woocommerce-order-paid-with-eth-on-base-mainnet).

## Run the app locally

```sh
npm ci
npm run portal:env        # writes .env for local mode and a vault key outside the repo
npm run portal:db         # starts PostgreSQL on 127.0.0.1:55432
npm run db:migrate
npm run db:seed           # sample users (owner@harbor.example / PayRouta-Local-2026!)
npm run payments:seed     # sample merchant and sandbox providers
npm run portal:worker     # terminal 2
npm run dev               # http://127.0.0.1:3000
```

Local mode is for development: mail is captured to `.local/portal/mail` (viewer at `/provider/dev-mail`) and the demo authenticator code `123456` works. Don't run it on a public host.

## Repository map

| Area | Path |
| --- | --- |
| NEAR Intents: quotes, checkout, settlement, payouts, DEX tokens, coverage | `lib/intents`, `lib/providers/adapters/native/near-intents-*.ts` |
| Shopify and WooCommerce | `integrations/`, `lib/integrations`, `app/api/integrations/shopify` |
| Agent API, MCP server, CLI | `app/api/agent/v1`, `lib/mcp`, `app/api/mcp`, `sdks/cli` |
| Checkout pages, button and universal checkout | `app/checkout`, `public/js/v1/payrouta.js`, `sdks/checkout`, `lib/payments/universal.ts` |
| Payments: intents, routing, execution, reconciliation, merchant API | `lib/payments`, `app/api/v1` |
| Bank and mobile money cash-out (Bridge, Yellow Card) | `lib/treasury/offramp` |
| Merchant dashboard | `app/merchant`, `lib/merchant` |
| Credit at checkout | `lib/treasury/credit.ts`, `lib/treasury/credit-checkout.ts` |
| Provider portal and operations console | `app/provider`, `lib/portal`, `lib/providers`, `app/ops` |
| Background worker | `scripts/worker.ts`, `lib/portal/worker.ts` |
| SDKs | `sdks/node`, `sdks/python`, `sdks/checkout` |
| Marketing site and public docs | `app/page.tsx`, `app/[...path]`, `components/marketing`, `content/`, `mintlify/` |

## Documentation

- Developer docs: [docs.payrouta.com](https://docs.payrouta.com), from [`mintlify/`](mintlify) and [`content/docs`](content/docs)
- NEAR Intents: [`content/docs/near-intents.md`](content/docs/near-intents.md), [`content/docs/cross-chain.md`](content/docs/cross-chain.md)
- Shopify and WooCommerce: [`content/docs/shopify.md`](content/docs/shopify.md), [`content/docs/woocommerce.md`](content/docs/woocommerce.md)
- Agents, MCP, CLI: [`content/docs/agents.md`](content/docs/agents.md), [`content/docs/mcp.md`](content/docs/mcp.md), [`content/docs/cli.md`](content/docs/cli.md)
- Production runbook: [`docs/PRODUCTION.md`](docs/PRODUCTION.md); payments internals: [`docs/PAYMENTS.md`](docs/PAYMENTS.md); fees: [`docs/PLATFORM-BILLING.md`](docs/PLATFORM-BILLING.md)
