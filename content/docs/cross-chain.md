# Pay from any chain

All crypto and stablecoin payments in PayRouta are powered by [NEAR Intents](https://docs.near-intents.org), a universal liquidity layer that supports over 125 assets across 36+ blockchain networks, including Bitcoin, Ethereum, Solana, Tron, BNB Chain, TON, Base, Arbitrum, Polygon, Avalanche and Stellar. Customers pay with whatever token and chain they hold, and you receive the exact coin, network and amount you configured in your own wallet.

When you want to off-ramp crypto into a local bank account, on-ramp fiat collections (`USD`, `EUR`, `NGN`, `KES`, `GHS`, `ZAR`) into `USDC` or `USDT`, or route payouts to regional banks, those settlement and liquidity operations are handled by PayRouta's licensed settlement partners. See [Settlement](settlement.md).

> NEAR Intents runs on mainnet, so sandbox checkouts use direct testnet transfers.

## How it works

1. Your checkout asks for, say, 40.00 USDC on Base, to one of your receive addresses.
2. Checkout asks one question: **What do you want to pay with?** The customer picks the network and token they hold. A token you receive directly is sent straight to your address; anything else, for example USDT on Tron, is a swap, so they also give their own address on that chain for refunds. They never choose between your receive addresses or accounts; that's routing.
3. PayRouta asks NEAR Intents (through its 1Click API) for an **exact-output** quote: deliver exactly 40.00 USDC on Base to your receive address for this payment. The customer sees the quote, for example "send 40.18 USDT on Tron", and a one-time deposit address.
4. The customer sends it from any wallet or exchange. Solvers swap and deliver; the customer pays the swap cost, which is in the quoted amount.
5. PayRouta confirms the payment exactly as for a direct transfer: when the delivered transfer of the exact amount reaches your receive address before the quote deadline and is final on-chain.

If the swap can't complete, the intents network refunds the customer on their own chain. Neither PayRouta nor the intents network holds the funds along the way.

## What you receive

| Your checkout asks for | Payable from any of NEAR Intents' 125+ assets |
| --- | --- |
| USDC on Base, Ethereum, Arbitrum, Polygon, Avalanche, Solana or Stellar | Yes |
| USDT on Ethereum, Avalanche or Solana | Yes |
| EURC, or volatile coins (ETH, SOL and others) | No: volatile-coin quotes last two minutes, too short for a cross-chain swap |

PayRouta only accepts a quote whose output equals your invoice amount exactly; anything else is refused rather than shown. Quotes need at least five minutes left on the checkout.

**Minimums and fees.** NEAR Intents has no single minimum: each asset, pair and network has its own, usually a USD floor set by its solvers, and it changes over time. Below it, checkout tells the customer to try another token or chain, or pay directly. NEAR Intents' protocol fee starts at 1 basis point (0.01%) for stablecoin and matching multichain pairs; partner API tiers can set a minimum fee on other pairs. Swap costs are inside the amount the customer is quoted, so you still receive the full invoice.

## Configuration & routing

Cross-chain intent execution is active by default across all supported networks. Destination token contracts and decimals are pinned and checked against NEAR Intents' live token list before every quote. Quotes and swap status are recorded against your payment intent, ensuring auditable, transparent verification.

## Settle into your own NEAR Intents account

Instead of receive addresses, you can connect a NEAR Intents account you own. Checkouts then settle into that one account from any token, including the invoice token itself, and you pay out and refund from it on any chain. See [Your NEAR Intents Account](near-intents.md).
