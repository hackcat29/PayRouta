# Tether USDT

> **Implementation status:** Direct `erc20-deposit` observation is implemented for the contracts below. Persistent address provisioning, authentic RPC and account qualification are required; the current production review still gates blockchain scopes. See [current coverage](provider-coverage.md).

**Method ID**: `stablecoin`  
**Integration Mode**: `NATIVE`

## Supported contracts

| Network | CAIP-2 identifier | Contract | Precision | Environment |
| --- | --- | --- | --- | --- |
| Ethereum | `eip155:1` | `0xdac17f958d2ee523a2206206994597c13d831ec7` | 6 | production |

Only these exact network/contract pairs are accepted. Namespaced intent identifiers use `erc20:<contract>`. Wrapped tokens, unlisted networks and fiat conversion are unsupported. No official USDT test contract is configured; no test token is invented.

## Deposit flow

Operators configure one token/network and a pool of merchant-owned receive addresses, using the coverage guide's configuration and migration instructions. PostgreSQL permanently reserves one address for each attempt and retains its original start block across restarts. No dashboard wallet ownership proof, address derivation, custody, signing or sweeping is implemented by this adapter.

Checkout displays the receive address, exact token amount, network and contract. Customer transfers must use that precise asset and chain. Amounts use integer scaling at six decimal places. No automatic token or chain switching occurs.

Payment confirmation requires an authenticated expected-chain RPC response, a single exact ERC-20 `Transfer` log to the reserved address, a successful matching receipt, a canonical block hash and the node's `finalized` block. A mined block alone is insufficient, including on Base. Missing, removed, reorganized or unfinalized receipts stay pending. Wrong amounts, multiple transfers, conflicting evidence and scans beyond 5,000 blocks require inspection. Transfer identity is claimed globally once. No automatic partial-payment aggregation or invented settlement occurs.

Use the current [payment intent API](payment-intents.md) with `methods: ["stablecoin"]`, a blockchain `asset`, precision 6 and same-token settlement asset. Production activation requires an approved blockchain review scope; marketing/reference support does not enable live processing.

See [Tether protocols](https://tether.to/en/supported-protocols/) and [Ethereum JSON-RPC](https://ethereum.org/en/developers/docs/apis/json-rpc/).
