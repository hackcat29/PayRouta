# Multichain stablecoin checkout

Stablecoins are the only enabled payment category. Customers choose from exact merchant quotes before payment instructions are issued. All eight other categories remain Coming soon in checkout and the merchant dashboard. Implementation is not live qualification: production remains gated by merchant review, country/asset limits, evidence, screening and fee valuation.

## Registered assets

| Network | Production tokens | Test environment | Test tokens |
| --- | --- | --- | --- |
| Ethereum | USDC, USDT, EURC | Sepolia | USDC, EURC |
| Base | USDC, EURC | Base Sepolia | USDC, EURC |
| Arc | USDC, EURC | Arc testnet | USDC, EURC |
| Avalanche | USDC, USDT, EURC | Fuji | USDC, EURC |
| Arbitrum | USDC | Sepolia | USDC |
| Polygon | USDC | Amoy | USDC |
| Solana | USDC, USDT, EURC | Devnet | USDC, EURC |
| Stellar | USDC, EURC | Testnet | USDC, EURC |

There are **17 production and 14 sandbox token/network pairs**, representing three assets: USDC, EURC and USDT. This is not a count of independently qualified providers. No USDT test deployment is registered. No USDT on Base/Arc or substitute bridge token is advertised.

The browser/server share the exact registry in `lib/blockchain/assets.ts`. ERC-20 and Solana SPL amounts have six decimal places; Stellar classic assets have seven. Display removes trailing padding and retains every meaningful fractional digit using string arithmetic. Invoice validation also enforces the protocol integer limit (EVM uint256, Solana uint64, Stellar positive int64). Wallets and evidence checks use the original exact amount; display never rounds the transfer.

Addresses are verified against [Circle USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses), [Circle EURC](https://developers.circle.com/stablecoins/eurc-contract-addresses), [Tether supported protocols](https://tether.to/en/supported-protocols/). Wrapped and bridged deployments are excluded. Stellar accepts the listed classic issuer assets, not an unrelated Soroban token with the same symbol.

## Merchant configuration

Under Payment methods select sandbox/production and the exact token/network. Supply fresh business-controlled receive addresses. PayRouta stores public addresses; production wallet keys remain with the merchant. Each `(network, address)` can be permanently bound once, even across token pools, environments, organisations, expired sessions and rejected attempts. Never recycle addresses. Providing the same address in several token pools does not increase available invoice capacity.

Payment methods now lists all three supported stablecoins and their production networks, including USDT. In sandbox, tokens without a registered issuer test deployment show Mainnet only. Receive pools are consolidated by exact token/network and overlapping addresses are counted once. Exhausted addresses stay consumed.

Owner/Admin users can use **Create stablecoin checkout** on this page. Enter a reference, declared payer country and explicit amount for each eligible token/network; leave unwanted options blank. Recent authenticator verification is required. The form creates a 30-minute checkout, offers Open/Copy link, and retries a lost response with the same intent/session idempotency key. Starting a new checkout creates a separate invoice. Every requested option passes the same production scope, screening, country, asset, fee and risk gates as API-created payments. No production approval is granted by this form.

`GET /api/v1/configuration` includes `stablecoinAssets`: exact network/identifier/symbol/decimals, whether a pool is configured, `executionEnabled` and a redacted reason. Production fee valuations are checked for each individual asset, including additional scope assets; a priced USDC default does not imply USDT or EURC readiness. `liveScope.additionalAssets` is represented in the runtime response contract and OpenAPI. Declared `payerCountry` is available in the Node SDK intent input.

For Solana use an on-curve wallet owner public key. The customer wallet creates the receiver's associated token account idempotently if needed and pays its SOL creation/network fee. A wallet paying manually must transfer the exact registered SPL mint to that owner’s corresponding token account.

For Stellar use a funded classic G-address with an authorized trustline to the exact selected code/issuer, enough reserve and remaining limit. Setup verifies account and trustline ownership/issuer/capacity. The merchant prepares its own production account and trustlines. The local test script funds only its generated testnet account through free Friendbot and creates test USDC/EURC trustlines. Customer sending wallets also need the asset and XLM fees.

EVM gas currencies are ETH, AVAX or POL as appropriate. Arc uses native USDC for gas with 18-decimal native units; the accepted ERC-20 USDC payment token still has six decimals. [Arc connection reference](https://docs.arc.io/arc/references/connect-to-arc).

## Quotes and customer selection

The merchant API accepts a default top-level quote and optional `paymentOptions` (up to 20 additional quotes). Each contains `asset`, `amount`, `precision` and `settlement`. Each option needs its own configured eligible pool, environment and approval. Production also requires declared approved payer countries and evidenced fee valuation for that exact asset.

```json
{
  "reference": "Order 1042",
  "amount": "1.000000",
  "asset": { "kind": "blockchain", "network": "eip155:84532", "identifier": "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" },
  "precision": 6,
  "settlement": { "kind": "blockchain", "network": "eip155:84532", "identifier": "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" },
  "methods": ["stablecoin"],
  "returnUrl": "http://127.0.0.1:3000/merchant",
  "paymentOptions": [{
    "amount": "1.0000000",
    "asset": { "kind": "blockchain", "network": "stellar:testnet", "identifier": "stellar:USDC.GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    "precision": 7,
    "settlement": { "kind": "blockchain", "network": "stellar:testnet", "identifier": "stellar:USDC.GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" }
  }]
}
```

This is an isolated sandbox example. The Node SDK accepts `paymentOptions`; Python passes the same JSON input. Options are exact merchant amounts, not automatic conversion quotes. There is no assumed parity, FX, bridge, sweep or cross-asset settlement. EURC quotes require explicit euro valuation. Selecting an option invalidates the old route and atomically selects the matching trusted context, amount, asset and immutable fee snapshot. Any existing attempt locks chain/token selection. One merchant order can settle only once.

Checkout displays a live expiry countdown. Expired attempts retain Check payment status and a merchant return link to request a new invoice. Old addresses remain reserved; do not pay again until checking any prior submission.

Continue refreshes eligibility immediately before route selection. Native pool evaluations last at most 60 seconds and are independent of unrelated registry-provider observation expiry. Selection, confirmation and dispatch still recheck current eligibility and risk; refreshing does not waive merchant approval or extend invoice expiry.

## Confirmation and settlement

- EVM: exact ERC-20 Transfer log, successful receipt, matching recipient/amount and canonical block at or behind finalized.
- Solana: exact mint/token program, transfer instruction including inner instructions, recipient owner/token account and balance movement; finalized transaction with canonical block membership.
- Stellar: successful classic payment operation and matching operation result; fee-bump envelopes additionally bind the successful inner transaction hash, exact issuer/code/recipient/amount and network-bound transaction hash, then the canonical closed-ledger hash.

A durable network/transaction/operation claim prevents reuse across invoices. Wrong amount/token/network, self-transfers, multiple matching transfers or conflicting evidence require investigation. Provisional detection does not authorize fulfillment, settlement or billing. Fulfill only after an authenticated `payment.confirmed` event or server status confirms the finalized outcome.

Funds transfer directly to the merchant receive wallet. Verified confirmation creates one direct settlement, balanced journal entries, reconciliation and signed merchant events. The provider fee is zero for this direct deposit path; the payer still pays blockchain fees. The platform fee is **0.10%, capped at the approved USD $1 schedule (or explicitly approved other-currency cap), billed separately**. Sandbox fee is zero. Deposits remain whole. See [Platform billing](PLATFORM-BILLING.md) for evidenced valuation, schedule/expiry and invoicing requirements.

Wallet cancellation never marks payment successful. EVM uses the wallet's exact transfer. Solana and Freighter sign the server-prepared transaction; the server verifies payer, network and unchanged message before relay. Signed relay bytes/hash persist durably before submission. An uncertain response prevents another payment; recovery may submit only those identical signed bytes while valid. Once payment instructions expire, stop new transfers but retain observation of an already submitted outcome.

## RPC and observation operations

Fixed reviewed public endpoints are available for all 16 environments. No customer-provided RPC URL is accepted. Alchemy credentials remain encrypted in the vault.

| `PAYMENT_RPC_MODE` | Behaviour |
| --- | --- |
| `auto` (default) | Alchemy when a key is configured; public fallback on eligible availability failures for reads |
| `public` | Public endpoints directly; used by the current local preview |
| `alchemy` | Alchemy required; no public fallback |

Per-integration `publicRpc` can select its fixed public endpoint. Every reader validates chain ID, Solana genesis or Stellar passphrase. Transport is HTTPS, DNS-pinned, bounded and does not follow redirects. Raw secrets are never logged. A failed broadcast does not automatically switch endpoints and send again.

For busy Stellar ledgers, the full ledger metadata may exceed the 1 MiB transport bound. Canonical verification then uses the fixed network-matched Horizon root and compact `/ledgers/{sequence}` hash. Invalid/mismatched evidence never triggers this fallback. Use a monitored RPC/indexing service for production capacity.

Run web and durable worker processes. Address depletion, worker liveness, RPC availability, aged pending transfers, retained-history gaps and reconciliation exceptions require alerts. EVM scanning defaults to bounded 10-block ranges; legacy Base public scanning respects its 500-block endpoint limit. Solana scans at most 20 pages of 100 signatures per poll, with bounded candidates. Stellar scans at most 20 pages of 25 transactions with a persistent opaque cursor; lost retained history requires inspection. These are bounded readers, not unlimited-throughput indexers. Load-test lag/catch-up against actual launch volume, particularly busy Stellar mainnet.

No RPC promise can make Ethereum finality instant. Faster chains can finalize sooner; detection/settlement record latency also depends on worker backlog and RPC capacity. Never replace finalized evidence with a wallet-returned hash to promise instant finality.

## Verification and launch

```sh
npm run test:multichain
npm run multichain:preflight
npm run multichain:testnet
# The customer signs a test-token payment in the generated checkout.
npm run multichain:testnet -- --observe
npm run multichain:testnet -- --verify
# Replace an expired local sandbox fixture, preserving its old evidence:
npm run multichain:testnet -- --new
```

Fixture/recovery files under `.local/portal` are sensitive and excluded from Git. Publish only public evidence. The verifier refuses production, real organisations and external webhook destinations. See [verification report](MULTICHAIN-TEST-REPORT.md) and [launch checklist](LAUNCH-CHECKLIST.md). Read-only network preflight and mocked transaction tests do not replace real payment qualification.
