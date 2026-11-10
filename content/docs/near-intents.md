# Your NEAR Intents account

Connect a [NEAR Intents](https://docs.near-intents.org) account you own, and every crypto checkout and USD payment link can be paid from any of 125+ tokens on 36+ chains. You receive the exact invoice amount, in the stablecoin you choose, in that one account. From the same balance you pay suppliers or staff and refund customers on any chain, by signing in your own wallet.

PayRouta never holds the funds or the account's keys. NEAR Intents holds balances in the `intents.near` contract on behalf of the account that owns them.

> NEAR Intents runs on mainnet, so it works on live checkouts only, once you've gone live with crypto.

## Connect an account

In the dashboard, open **Balances → Crypto**.

1. Under **Settle in**, choose **Stablecoins**, then the ones checkouts settle in: USDC on Base, Ethereum, Arbitrum, Polygon, Avalanche, Solana or Stellar, or USDT on Ethereum, Avalanche or Solana. To be paid in your bank's currency instead, see [Settle in your bank](#settle-in-your-bank).
2. Choose the wallet that owns the account:
   - **Create a wallet**: sign in with Google, Apple, X or email, and a new wallet is created for you. You own its key and can export it.
   - **Connect a wallet**: any wallet you already have on an EVM chain (MetaMask, Rabby, Coinbase Wallet and others) or on Solana (Phantom, Solflare, Backpack and others).
   - **NEAR wallet** (HOT, Meteor, Intear, MyNearWallet and others) for a NEAR account such as `shop.near`.

   An EVM address is its own NEAR Intents account; a Solana address owns the account named by its key in hex.
3. Sign the message the wallet shows. It proves you control the account and does not move funds. PayRouta checks the signature and, for a named NEAR account, that the signing key has full access to it.

Connecting needs recent authenticator verification. Live checkouts settle into it once you've gone live with crypto under [Activate payments](activation.md): a name, a country, the merchant terms and an automatic sanctions check, with no review. Connecting another account replaces the first; disconnecting stops new checkouts settling there and leaves the funds where they are.

A named NEAR account must tell NEAR Intents once which key signs its intents. **Balances → Crypto** shows a **Register wallet key** button until it has; it sends one transaction from your wallet with a small NEAR network fee. EVM addresses need no registration.

## How a payment settles

1. The checkout asks for, say, 40.00 USDC. The customer picks what they hold, for example USDT on Tron, and gives their own address on that chain for refunds.
2. PayRouta asks NEAR Intents' 1Click API for an **exact-output** quote that delivers exactly 40.00 USDC, less PayRouta's 1.5% fee, into your account; NEAR Intents sends the fee to PayRouta in the same swap ([Fees and billing](billing.md)). The customer sends the quoted amount to a one-time deposit address. Paying in the invoice token itself works the same way.
3. When 1Click reports the swap complete, PayRouta reads the swap's NEAR transactions back from the chain. The payment is confirmed only by a final `intents.near` transfer of exactly that amount into your account, made by one of that swap's own intents. Each transfer can confirm one payment only.
4. Settlement is recorded as for any other crypto payment, with the NEAR transaction as evidence.

If the swap can't complete, NEAR Intents refunds the customer on their own chain, and they can pay another way on the same checkout.

## Settle in your bank

Under **Settle in**, choose **Your bank**, and crypto checkouts are paid out in your bank's currency with nothing to sign per payment:

1. Set up where you're paid, as for [cashing out](cash-out.md): Bridge for US dollars or euros, or Yellow Card for naira, cedi, shillings, rand, kwacha and pesos to a bank or mobile money.
2. Choose **Settle crypto checkouts here** on that account.

Each checkout's quote then delivers USDC on Base, less PayRouta's fee, straight to the partner: your Bridge liquidation address, or PayRouta's Yellow Card balance. PayRouta confirms the payment only when that swap's own transfer of exactly that amount is final on Base, then follows the partner until your bank or mobile money is paid. You see each one under **Cash outs**. **Stop** goes back to settling in crypto.

Customers pay exactly as before: any token, any chain.

## Pay out and refund

**Pay out.** Choose the balance to pay from, the amount, the network and token they receive, and their address. PayRouta gets an exact-input quote funded from your account and the transfer intent that funds it. Before you sign, PayRouta checks that the intent moves exactly that amount from your account to the quote's deposit account and nothing else. Your wallet signs; NEAR Intents executes it and you pay no gas.

**Refund.** **Payments settled here** lists recent payments with what's left to refund. **Refund** fills in the customer's refund address and the token and network they paid with; you choose the amount, up to what the payment delivered less earlier refunds.

Payouts and refunds appear under **Payouts and refunds** with their status and, once sent, a link to the destination chain's explorer. A quote must be signed within 20 minutes; unsigned quotes expire and nothing moves.

## Fees

Swap costs are inside the amounts quoted to the customer and to you; you always receive the full invoice amount. NEAR Intents' protocol fee starts at 1 basis point. PayRouta's own fee for crypto payments is unchanged; see [Fees & Billing](billing.md).

## For developers

- Settlement is the `near-intents-deposit` adapter. It is a deposit integration, so routing, confirmation, settlement and reconciliation work as for receive-address pools.
- A checkout settling into an intents account returns an attempt action of kind `intents` with the account as `address`; [Pay from Any Chain](cross-chain.md) covers the quote calls.
- NEAR reads use `NEAR_RPC_URL` (default `https://rpc.mainnet.near.org`) and `NEAR_ARCHIVAL_RPC_URL` for older transactions. `CROSS_CHAIN_PAYMENTS=off` stops new quotes.
