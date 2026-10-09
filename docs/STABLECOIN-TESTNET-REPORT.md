# Stablecoin MVP testnet verification

Verified 7 October 2026 in the isolated local fictional merchant environment. This records a real user-signed Base Sepolia transfer, not a simulated provider outcome. No mainnet transaction or production deployment was performed.

## Real transfer

- Network: Base Sepolia, chain ID 84532.
- Asset: Circle test USDC, contract `0x036cbd53842c5426634e7929541ec2318f3dcf7e`.
- Amount: 1.000000 test USDC (1,000,000 token minor units).
- Merchant receive address: `0x4c0bbec33d0cc5c4b393e558f0f70fb2caea2cb3`.
- Transaction: [0xcbc7bc58d569d342a0b761ba0d9f3b614d106a4b2490ab9932804343b39905e1](https://sepolia.basescan.org/tx/0xcbc7bc58d569d342a0b761ba0d9f3b614d106a4b2490ab9932804343b39905e1).

## Observed results

PayRouta remained pending while the transfer was visible on the chain but had not reached the finalized checkpoint. It then independently verified the exact token/recipient/amount, successful receipt and canonical finalized block.

The payment and attempt became **Confirmed**. The direct settlement became **Completed**, with gross/net 1,000,000 minor units and provider fee zero. Reconciliation returned **Exact match**.

Repeated observation, settlement and reconciliation produced one immutable deposit claim and one allocation. All three operational journal entries balanced. The sandbox platform-fee record was zero and nonbillable. Payment-confirmed and settlement-completed events were delivered with valid signatures to the fixed fictional local receiver on `127.0.0.1:55439`; no external merchant destination was used.

## Automated coverage

The updated suite covers server launch gates, public method/configuration contracts, tenant isolation, immutable receive addresses, exhausted pools, rejected forged confirmations/webhooks, exact transfer calldata, chain switching/rechecking, wallet cancellation, uncertain submissions, duplicate-payment prevention, finalized cursor recovery, expired read-only sessions, desktop/mobile checkout, QR rendering, merchant setup, live-scope review, billing and accessibility.

Verification results: 224 unit tests, 37 database regression tests (2 stablecoin, 21 payment, 2 merchant, 12 partner), 10 desktop/mobile checkout cases and 6 merchant browser cases passed. Type checking, lint and the production build passed. The built app was visually checked against the paid checkout: confirmed receipt, completed settlement and eight Coming soon categories.

After the real payment, checkout gained a provisional **Payment detected** stage. Tests verify a canonical exact transfer can be displayed before finality without claiming/settling/billing it, that a disappearing transfer returns to awaiting payment, and that payment controls are hidden while a detected transfer awaits finality. Customer chain selection was subsequently implemented; see the [multichain verification report](MULTICHAIN-TEST-REPORT.md) for the newer coverage and its remaining real-payment checks.

A repeat RPC read exposed an HTTP 413 response for log ranges exceeding the public Base Sepolia endpoint's 500-block limit. The reader and diagnostic now use 500-block ranges. The finalized-payment/settlement/reconciliation/idempotence/signed-loopback verification passed again after that correction. Production still needs provisioned RPC capacity. This test proves the exercised Base Sepolia USDC path. Additional assets/networks, production RPC capacity, operational security/legal readiness and a controlled mainnet pilot still require qualification before live launch. See [Stablecoin MVP](STABLECOIN-MVP.md) and [Launch checklist](LAUNCH-CHECKLIST.md).
