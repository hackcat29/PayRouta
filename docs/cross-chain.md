# Pay from any chain

With the checkout button, customers can pay crypto checkouts from any wallet. They can also pay with a different token, on a different chain, from the one you asked for. You still receive exactly the coin, network and amount you set, in your own wallet.

This runs on [NEAR Intents](https://docs.near-intents.org), a universal liquidity layer that supports over 125 assets across 36+ blockchain networks, including Bitcoin, Ethereum, Solana, Tron, BNB Chain, TON, Base, Arbitrum, Polygon, Avalanche and Stellar.

> **Status.** Live on production checkouts. NEAR Intents has no testnet, so sandbox checkouts don't show it.

## How it works

1. Your checkout asks for, say, 40.00 USDC on Base, to one of your receive addresses.
2. The customer opens **Pay from another chain or token**, picks what they hold (for example USDT on Tron) and gives their own address on that chain for refunds.
3. PayRouta asks NEAR Intents (through its 1Click API) for an **exact-output** quote: deliver exactly 40.00 USDC on Base to your receive address for this payment. The customer sees the quote, for example "send 40.18 USDT on Tron", and a one-time deposit address.
4. The customer sends it from any wallet or exchange. Solvers swap and deliver; the customer pays the swap cost, which is in the quoted amount.
5. PayRouta confirms the payment exactly as for a direct transfer: when the delivered transfer of the exact amount reaches your receive address before the quote deadline and is final on-chain.

If the swap can't complete, the intents network refunds the customer on their own chain. Neither PayRouta nor the intents network holds the funds along the way.

## What you receive

| Your checkout asks for | Payable from any of NEAR Intents' 125+ assets |
| --- | --- |
| USDC on Base, Ethereum, Arbitrum, Polygon, Avalanche, Solana or Stellar | Yes |
| USDT on Ethereum, Avalanche or Solana | Yes |
| EURC, or volatile coins (ETH, SOL and others) | Not yet: volatile-coin quotes last two minutes, too short for a cross-chain swap |

PayRouta only accepts a quote whose output equals your invoice amount exactly; anything else is refused rather than shown. Quotes need at least five minutes left on the checkout.

**Minimums and fees.** NEAR Intents has no single minimum: each asset, pair and network has its own, usually a USD floor set by its solvers, and it changes over time. Below it, checkout tells the customer to try another token or chain, or pay directly. NEAR Intents' protocol fee starts at 1 basis point (0.01%) for stablecoin and matching multichain pairs; partner API tiers can set a minimum fee on other pairs. Swap costs are inside the amount the customer is quoted, so you still receive the full invoice.

## Operations

It is on by default; set `CROSS_CHAIN_PAYMENTS=off` to turn it off. Store a 1Click partner API key in the vault with its reference in `ONECLICK_API_KEY_REF`. Destination token IDs are pinned in `lib/intents/oneclick.ts` and re-checked against 1Click's live token list (symbol, decimals, contract) before every quote. Quotes and swap status are recorded in `CrossChainPayment`.
