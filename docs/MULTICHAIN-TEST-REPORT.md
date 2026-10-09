# Multichain verification report

7 October 2026. Local fictional merchant database only. No mainnet payment, production deployment or production merchant approval was performed.

## Verified implementation

Eight production networks and their eight test environments are registered. The exact registry contains 31 token/network pairs: 17 production and 14 sandbox. Payment options, native wallet signing/relay, EVM/SPL/classic-Stellar readers, canonical finalized evidence, durable claims, merchant setup, chain locking and fixed public RPC fallback are implemented. Wrapped and bridged tokens are excluded.

The historical public RPC preflight, before the original-deployment filter was narrowed, passed **all 16 environments and 34 asset pairs**. The current supported registry contains 31 original stablecoin pairs. It checked EVM chain identity, finalized checkpoints and contract decimals; Solana genesis and initialized exact token mints/program/decimals; Stellar passphrase, healthy closed ledger, canonical ledger hash and official issuer accounts. This is read-only asset/connectivity evidence, not a transfer/settlement test. The local preview uses public RPC mode because the supplied Alchemy key previously returned quota/permission errors; the key remains encrypted.

The generated Stellar test receiver was funded using free testnet Friendbot and received authorized USDC/EURC trustlines. Public setup transaction: `553bf9e7b2e863b21a123665833ef4821f795786799b50630ee1f7fc207ad06b`. This setup transaction does not prove a customer stablecoin payment.

## Automated verification

Before the final checkout-expiration/decimal correction: **258 unit tests**, **39 multichain tests** (34 unit plus 5 database), **14 desktop/mobile checkout cases**, **6 merchant browser cases**, SDK build/Python checks, types, lint and production build passed. These counts overlap; do not add the unit and multichain counts.

Coverage includes wrong network/asset/precision, exact token amounts and mint/issuer, self-transfer, failed transaction, nonfinalized evidence, canonical mismatch, ambiguous/duplicate transfers, claim durability, immutable address bindings, stale scan cursors, quote changes and atomic route invalidation/locking, wallet refusal, message tampering, changed payer/network, uncertainty, reload, public fallback network checks and bounded Stellar ledger proof fallback.

A user test exposed `EVALUATION_EXPIRED_OR_MISMATCHED` after leaving the checkout open. The correction refreshes methods on Continue and isolates direct stablecoin pool eligibility from unrelated short-lived registry observations. Added regression verifies expiry remains enforced and a fresh quote resumes the same unpaid invoice. Decimal display now shows `1.00` rather than token padding, preserves meaningful six/seven-decimal fractions and large integer amounts, and sends/copies the original exact transfer amount. Final validation passed: **261 unit tests**, **41 multichain tests** (35 unit plus 6 database), **16 desktop/mobile checkout cases**, the 2 dedicated stablecoin database tests, 21 payment database regressions, type checking, lint and the production build. These suites overlap. The real open checkout was reloaded and retried successfully on the customer-selected Solana Devnet network: it shows Pay 1.00 USDC and exact receive/mint instructions without the expired-evaluation error.

## USDT / EURC integration completion

The merchant Payment methods page now displays all three stablecoins, exact supported networks and environment readiness. Owner/Admin users can create a checkout with explicit per-token/network amounts, declared payer country, recent MFA, tenant/CSRF checks and rate limiting. Lost-response retry recovers the same intent and checkout credential; the browser regression verified one intent/session. Pool reporting consolidates overlapping integrations without double-counting receive addresses. The configuration response/OpenAPI now includes additional approved scope assets and per-asset readiness; fee valuation is checked independently for every live token. The Node SDK exposes `payerCountry` for live requests.

Final validation after this completion: **333 unit tests**, **70 multichain checks** (48 unit plus 22 database), **21 payment database regressions**, **7 merchant browser cases** and **16 desktop/mobile checkout cases** passed. Type checking, lint, the Node SDK build and the local production build passed. Suites overlap and counts must not be added.

All 31 registry pairs have exact merchant quote/amount/fee coverage. All 22 EVM pairs exercise direct transfer calldata (no approval or Boolean return dependency), pending-to-finalized receipt verification and durable claiming. All five Solana pairs verify mint, received balance, payer signature and unchanged transfer message. All four Stellar pairs verify code/issuer, hash/network, recipient and exact seven-decimal amount; USDC/EURC fee-bump fixtures verify the inner hash, successful operation result and exact operation count. All 14 sandbox pairs exercise immutable claim gating, replay, full-amount settlement, zero/nonbillable platform fee and three balanced journal entries using explicitly fictional transport evidence. Oversized uint256/uint64/positive-int64 values are rejected before checkout instructions are offered.

The real public RPC run passed 15/16 network environments initially; Polygon's public endpoint returned a transient transport failure. The isolated Polygon retry passed chain identity, finalized checkpoint and both deployed assets. Those historical checks covered all 16 environments and 34 deployments before the registry was narrowed to 31 original stablecoin pairs. No customer RPC URL or alternate ambiguous broadcast was introduced. The real user-paid Solana Devnet receipt/settlement/reconciliation/signed-loopback check passed again with the completed code.

These are implementation and testnet evidence, **not real mainnet USDT transfers or production approval**. Sandbox offers only registered issuer test USDC/EURC; USDT shows Mainnet only. A real EURC customer payment has not yet been performed. Each unexercised launch pair still needs its payment qualification and all live gates.

## Actual customer payment evidence

The earlier user-signed **1 test USDC Base Sepolia** payment was confirmed, settled, reconciled, replayed idempotently and delivered to the signed local receiver. Its canonical receipt, single claim/allocation, balanced journals, zero sandbox fee and signed loopback deliveries passed verification again after the final changes. Historical EVM verification now reads the immutable claim’s exact receipt and canonical finalized block directly, avoiding an ever-growing address history scan. The known local historical-scan false positive was reviewed against that public proof with an audit timeline; no financial amount, claim or allocation changed. See [the Base test report](STABLECOIN-TESTNET-REPORT.md).

The customer-signed **1.000000 test USDC Solana Devnet** checkout is now verified end to end:

- Transaction: [3KYbdfZcyYPAuaKX3Fdqu33vw8cP7NkAzfQHiric26ZQeKcxoREtyCo2TK41QTkTSa5CUj2Qkm4KNAmZhxtFWhf](https://explorer.solana.com/tx/3KYbdfZcyYPAuaKX3Fdqu33vw8cP7NkAzfQHiric26ZQeKcxoREtyCo2TK41QTkTSa5CUj2Qkm4KNAmZhxtFWhf?cluster=devnet).
- Exact SPL mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`; merchant owner receiver: `wtFj9d8D86wmvbzYKKoTxNvDBQPNTgspE2xbMU2hmTL`.
- Finalized slot: `508470670`; canonical block hash: `7E5D7qCVy2bHUfYZFM3LoKPz99YnMbAxaEXKECWcnUmC`; transfer instruction: `ix:3`.
- Chain timestamp: `2026-10-07T13:32:04.000Z`; immutable claim recorded: `2026-10-07T13:32:15.623Z` (UTC evidence timestamps).
- Payment/attempt: **Confirmed**; settlement: **Completed**, gross/net 1,000,000 token minor units, provider fee zero; reconciliation: **Exact match**.
- Repeated receipt, settlement and reconciliation checks retained exactly one claim and one allocation. All three operational journal entries balanced. Sandbox platform fee was zero/nonbillable. Both payment-confirmed and settlement-completed events were delivered with valid signatures to the fixed fictional loopback receiver.
- No unresolved payment exception was found. The customer's sending wallet signed the transfer; no customer signing key was supplied to PayRouta.

This proves the exercised native Solana USDC payment path through public RPCs. Stellar and Arc customer payments have not yet been verified. All additional launch combinations still require real test checkout qualification; USDT, which have no registered test deployments, require a consented mainnet pilot with an explicit amount/gas budget before live approval.

## Remaining launch evidence

Complete [the launch checklist](LAUNCH-CHECKLIST.md): merchant-owned pools and recovery, wallet-family payment tests, production capacity/load/recovery, exact live scopes/countries, screening/legal/security sign-off, fee valuation and finance operations, deployment/monitoring/backups and a controlled mainnet pilot. Current dependency audit: no critical, eight high and four moderate findings requiring review/remediation before release. Next was upgraded to 16.4.0; the newly introduced SPL native bigint dependency was removed. No broad forced dependency downgrade was performed.

The expired checkout now retains a read-only Check payment status action and a merchant return link for a replacement invoice. Active checkout shows a live mm:ss countdown; expired payment instructions cannot be reused. A fresh sandbox fixture preserves the old invoice/recovery material and uses a new Solana receive address. Browser verification covers both expired recovery and countdown visibility.

## Mixed stablecoin and crypto checkout correction

Wallet quotes can offer registered USDC, USDT and EURC alongside original crypto assets. The page keeps both categories visible and switches immutable quoted options before instructions exist. Removed wrapped deployments are rejected by exact asset lookup, setup and launch validation; historical payment records remain intact. The actual Base Sepolia ETH transfer also passed finalized settlement, exact reconciliation and signed loopback verification.

Validation for the mixed-checkout correction: **668 unit checks**, **32 serial local database payment checks** and **32 desktop/mobile checkout browser checks** passed. The production build and lint passed. The fresh USDC/EURC/ETH Base Sepolia checkout was inspected in the browser with live CoinGecko rates; switching stablecoin → crypto → stablecoin preserved the quoted options. This UI check did not initiate another customer payment.
