# Pay from any chain

All crypto and stablecoin payments in PayRouta are powered by [NEAR Intents](https://docs.near-intents.org), a universal liquidity layer that supports over 200 assets across more than 35 blockchain networks, including Bitcoin, Ethereum, Solana, Tron, BNB Chain, TON, Base, Arbitrum, Polygon, Avalanche and Stellar. Customers pay with whatever token and chain they hold, and you receive the exact coin, network and amount you configured in your own wallet.

When you want to off-ramp crypto into a local bank account, on-ramp fiat collections (`USD`, `EUR`, `NGN`, `KES`, `GHS`, `ZAR`) into `USDC` or `USDT`, or route payouts to regional banks, those settlement and liquidity operations are handled by PayRouta's licensed settlement partners. See [Settlement](settlement.md).

> **Status.** Live on production checkouts. NEAR Intents operates on mainnet networks, so sandbox checkouts test direct testnet transfers.

## How it works

1. Your checkout asks for, say, 40.00 USDC on Base, to one of your receive addresses.
2. Checkout asks one question: **What do you want to pay with?** The customer picks the token they hold from one searchable list of every network, and sees what they'll pay before going on: the exact amount for a token you receive directly, today's price for anything else, for example USDT on Tron, which is a swap. They never choose between your receive addresses or accounts; that's routing.
3. PayRouta asks NEAR Intents (through its 1Click API) for an **exact-output** quote: deliver exactly 40.00 USDC on Base to your receive address for this payment, for example "send 40.18 USDT on Tron" to a one-time deposit address.
4. The customer pays it one of two ways:
   - **From a connected wallet** on EVM networks, Solana or NEAR: the wallet sends the quoted amount, and refunds go back to it.
   - **From any other wallet or exchange**: they give their own address on that chain for refunds, then send to the deposit address or scan its QR code.

   Solvers swap and deliver; the customer pays the swap cost, which is in the quoted amount. Checkout shows the swap's progress and, once confirmed, a receipt that returns the customer to your site.
5. PayRouta confirms the payment exactly as for a direct transfer: when the delivered transfer of the exact amount reaches your receive address before the quote deadline and is final on-chain.

If the swap can't complete, the intents network refunds the customer on their own chain. Neither PayRouta nor the intents network holds the funds along the way.

## What you receive

| Your checkout asks for | Payable from any of NEAR Intents' 200+ assets |
| --- | --- |
| USDC on Base, Ethereum, Arbitrum, Polygon, Avalanche, Solana or Stellar | Yes |
| USDT on Ethereum, Avalanche or Solana | Yes |
| EURC, or volatile coins (ETH, SOL and others) | Not yet: volatile-coin quotes last two minutes, too short for a cross-chain swap |

PayRouta only accepts a quote whose output equals your invoice amount exactly; anything else is refused rather than shown. Quotes need at least five minutes left on the checkout.

**Minimums and fees.** NEAR Intents has no single minimum: each asset, pair and network has its own, usually a USD floor set by its solvers, and it changes over time. Below it, checkout tells the customer to try another token or chain, or pay directly. NEAR Intents' protocol fee starts at 1 basis point (0.01%) for stablecoin and matching multichain pairs; partner API tiers can set a minimum fee on other pairs. Swap costs are inside the amount the customer is quoted, so you still receive the full invoice.

## Any token by its contract address

Customers can pay with a token that isn't listed, for example a coin launched on Pump.fun, by pasting its contract address into the token search. Checkout loads it with its price, on Solana or on Ethereum, Base, Arbitrum, Optimism, Polygon, Avalanche and BNB Chain, wherever there's USDC this checkout can take.

The customer's wallet swaps the token into USDC, through Jupiter on Solana and LI.FI on EVM networks, and then pays exactly the checkout's USDC:

- **Solana:** one transaction swaps the token into the customer's own USDC and then transfers exactly the payment. If the swap returns less than the payment, the whole transaction fails and nothing is paid.
- **EVM networks:** the wallet swaps first, and sends the exact USDC payment only after the swap has succeeded and the USDC is in the wallet.

Either way, you receive USDC exactly as for any USDC payment, and you never hold the customer's token. Any USDC above the payment stays in the customer's wallet. Checkout refuses a token without enough liquidity for the payment, or whose swap would cost more than 15% of its value. Coins still on a launchpad's bonding curve can't be swapped until they move to a DEX.

## Choose what you receive

Under **Balances → Crypto**, choose where crypto checkouts land: **Your PayRouta wallet** (your own NEAR Intents account, in the stablecoins you pick) or **Bank or mobile money** to be paid in your bank's currency. From the NEAR Intents account you can pay out in any token, on any chain (see [Your NEAR Intents Account](near-intents.md)).

## Configuration & routing

Cross-chain intent execution is active by default across all supported networks. Destination token contracts and decimals are pinned and checked against NEAR Intents' live token list before every quote. Quotes and swap status are recorded against your payment intent, ensuring auditable, transparent verification.

## Token and chain logos (operators)

The checkout's token picker shows each token's logo with a badge for its chain, served from PayRouta at `/api/logos/coin/<coingecko id>` and `/api/logos/chain/<1Click chain code>` (`lib/intents/token-logos.ts`, table `TokenLogo`). Customers' browsers never load a third-party image.

- The worker fetches logos from CoinGecko about two a minute until every token and chain in 1Click's list has one, then checks for new ones daily. `npm run logos:warm` does it now.
- Requests are never made while a customer waits, so logo fetches can't use up the CoinGecko allowance that checkout prices need. Without `COINGECKO_API_KEY_REF` the keyless API is used; a free demo key makes the first fill faster.
- Only PNG, JPEG and WebP from CoinGecko's own image hosts are stored, up to 256 KB. A token or chain CoinGecko has no image for (Robinhood Chain, Miden, PRL, QTC today) shows the generated mark, and is retried weekly.
- The marketing site's token and chain counts are read from the same list (`lib/intents/coverage.ts`) when its pages re-render, every six hours.
