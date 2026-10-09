# Stablecoin MVP

Launch scope: stablecoin pay-ins only. Card, bank transfer, mobile money, digital wallet, USSD, direct debit, BNPL and crypto-app payments are displayed as **Coming soon** in checkout and the merchant dashboard. New non-stablecoin intents, selections and dispatches are blocked by the server. Existing financial outcomes remain observable. Simulator adapters are retained for isolated regression tests; customers cannot select them in the MVP.

## Supported assets

See [the multichain guide](MULTICHAIN.md) for the full matrix: eight production networks, their eight test environments, and 31 exact token/network pairs. USDC is registered on all eight networks; EURC on six; USDT on Ethereum, Avalanche and Solana.  Mainnet use remains subject to merchant review.

ERC-20 and SPL assets use six decimal places; classic Stellar assets use seven. The exact contract, mint or issuer in `lib/blockchain/assets.ts` identifies the asset. No testnet USDT, unsupported bridge token or native gas currency is accepted as an invoice token.

## Merchant setup

Create a merchant workspace, enable authenticator verification, and open **Payment methods**. Add fresh receive addresses controlled by the business for the chosen token/network. Each address is permanently assigned to one checkout and is never recycled after failure or expiry. Add more addresses before the pool runs out. PayRouta does not collect merchant signing keys or generate production receive wallets.

Alchemy credentials are stored in the encrypted secret manager. Fixed public RPCs are supported for every registered chain. `PAYMENT_RPC_MODE=auto` tries Alchemy then public RPC for eligible read failures; `public` uses public RPC directly; `alchemy` disables public fallback. The local preview currently uses public mode. The reader verifies EVM chain identity, Solana genesis or Stellar network passphrase. Stellar ledger-hash verification can use the fixed Horizon index when busy ledger metadata exceeds the bounded RPC response.

Public endpoints require no credential but have limits. Measure capacity and alert on throttling before launch. Broadcast failures never trigger an automatic alternate-endpoint submission; native wallet recovery retries only the same signed transaction while valid. See [RPC and observation operations](MULTICHAIN.md#rpc-and-observation-operations).

Save the business profile under **Payment providers** for screening. Live execution also requires real accepted business evidence, permission/address-ownership evidence, the exact settlement destination and a merchant refund responsibility record. Operations approves an explicit token/network, merchant country, payer countries, transaction/daily limits and review date under **Merchant readiness and review**. Production intents require a declared `payerCountry` within that scope; it is a merchant-supplied declaration, not proof of the payer's identity. Current screening and scope/evidence are rechecked before dispatch. Responsibility for payer checks and wallet/source-of-funds requirements must be agreed before launch.

Configure an evidenced, expiring fee valuation for each exact token/network asset. Stablecoin fees are 10 basis points, capped under the approved billing schedule, billed separately. No fee is deducted from the deposit. Sandbox fees are zero. The payer pays the blockchain gas fee. There is no stablecoin-peg assumption or automatic FX feed. See [Platform billing](PLATFORM-BILLING.md).

## Checkout and evidence

The wallet button requests an exact ERC-20 transfer, Solana SPL transfer or Stellar classic payment, checks the selected network and never infers payment success from a returned hash. Native wallet transactions are bound to the prepared amount, asset, destination and payer before relay. QR instructions use the protocol appropriate to the selected network. Wallet rejection stays unpaid; uncertain submissions require checking wallet activity before another transfer. Successful/uncertain submissions disable repeat wallet payments and persist that warning in the browser.

The backend accepts only an exact transfer of the registered asset to the bound receive address with successful finalized evidence. EVM verifies Transfer logs and canonical finalized blocks; Solana verifies the mint, instruction, balance movement and finalized block membership; Stellar verifies the classic issuer, payment operation, successful transaction and closed ledger. A global transaction/operation claim prevents reuse across invoices. Multiple transfers, wrong amounts, conflicting evidence and canonical mismatch are not treated as successful payment. Wrong-token/network transfers require merchant investigation and are never matched to this invoice.

A verified deposit creates confirmation, one zero-provider-fee direct settlement, balanced operational journal entries, an independent platform fee record, reconciliation and signed merchant events. Settlement evidence contains the actual chain transaction/log/block identity. Merchant transaction details link to the explorer. Missed settlement jobs are recovered by reconciliation.

Payment instructions expire after 30 minutes. New payment actions stop at expiry, but authenticated read-only status and refresh remain available for 24 hours after that boundary. Transfers confirmed after expiry create a late-payment exception for review. Addresses remain reserved forever. Do not issue another payable attempt after an unknown outcome.

## Worker and incident operations

Deploy the durable worker alongside the web process. Browser closure does not stop observation. Only empty finalized ranges advance the durable scan cursor; unfinalized ranges are never skipped. Poll work is bounded. A long gap with unresolved transfer evidence can produce `DEPOSIT_SCAN_REQUIRES_INSPECTION`; operations must inspect and restore scanning with an appropriately provisioned RPC before resolving it. Do not manually mark a browser-submitted hash as paid.

Alert on worker heartbeat/job failures, aged pending outcomes, empty address pools, RPC rate limits, mismatched amounts, duplicate transfers and reconciliation exceptions. The automatic observation window is 24 hours; older unresolved outcomes require manual investigation and deliberate recovery. Pausing new execution must retain status reads, settlement records and webhook delivery. Review/refunds are merchant-operated wallet actions; this MVP does not sign refunds or sweep funds.

## Local verification

Use the isolated fictional database. Apply migrations, generate the Prisma client, seed local fixtures and start the web/worker/receiver processes using the documented local workflow. Then:

```sh
npm test
npm run test:stablecoins
npm run test:payments
npm run test:merchant
npm run test:partners
npm run test:checkout
npm run test:merchant-browser
npm run typecheck
npm run lint
npm run build
npm run stablecoins:testnet
npm run stablecoins:testnet -- --observe
npm run stablecoins:inspect
npm run test:multichain
npm run multichain:preflight
npm run multichain:testnet
npm run multichain:testnet -- --observe
npm run multichain:testnet -- --verify
```

The testnet fixture creates one 1-test-USDC Base Sepolia checkout. Its test-only receive-wallet recovery material is stored exclusively in the encrypted local vault. The local fixture file contains the checkout capability and recovery reference: do not commit or publish it. Only the public transaction evidence belongs in a test report. The user's sending wallet signs its own transaction.

Passing local tests and one real testnet transfer demonstrates this tested path; it does not certify production RPC capacity, mainnet operation or global legal/commercial readiness. Finish [the launch checklist](LAUNCH-CHECKLIST.md) before accepting live value.

## Payment speed and chain choice

Checkout now distinguishes a canonical matching transfer (**Payment detected**) from finalized confirmation. Detection does not create a claim, settle funds, charge a fee, or authorize fulfillment. A disappearing or reorganized receipt returns to awaiting a transfer. Only finalized exact transfers confirm. Browser refresh observation is queued every ten seconds; running workers and RPC capacity affect detection latency. Direct transfers already reach the receive wallet before PayRouta's finalized settlement record.

Customers can now select among the merchant's explicitly quoted token/network options before requesting payment instructions. The server locks the choice as soon as any attempt exists, preserves one merchant order, and binds its exact amount, settlement asset and fee snapshot. Each option settles in that same asset; there is no conversion, bridging or assumed USDC/USDT/EURC parity. The merchant must quote each amount and configure each offered receive pool. See [Multichain checkout](MULTICHAIN.md).
