# Contracts

| Contract | What it is |
| --- | --- |
| `agent-vault` | PayRouta agent vault: an AI agent pays PayRouta checkouts on NEAR and, through Chain Signatures, on EVM chains, within limits the contract enforces ([docs/agent-vault.md](../docs/agent-vault.md)) |
| `test-usd` | pUSD, a NEP-141 test dollar for NEAR testnet (6 decimals, owner mints) |

## Build and test

`agent-vault` verifies TEE attestations with `shade-attestation`, which doesn't build on macOS. Build and test both contracts in the cargo-near image:

```bash
cd contracts/agent-vault
docker run --rm --platform linux/amd64 -u root -v "$PWD":/code -w /code \
  -v payrouta-cargo:/root/.cargo/registry -e CARGO_HOME=/root/.cargo \
  -e RUSTUP_HOME=/home/near/.rustup -e PATH=/home/near/.cargo/bin:/usr/local/bin:/usr/bin:/bin \
  sourcescan/cargo-near:0.19.0-rust-1.86.0 \
  bash -c 'cargo test && cargo near build non-reproducible-wasm --locked --no-abi'
```

The wasm lands in `target/near/`.

## Deploy (testnet)

```bash
near contract deploy <vault>.testnet use-file agent-vault/target/near/payrouta_agent_vault.wasm \
  with-init-call new json-args '{
    "owner_id": "<owner>.testnet",
    "mpc_contract_id": "v1.signer-prod.testnet",
    "near_network": "near:testnet",
    "order_signer": "<GET /api/agent/v1/order-key>",
    "requires_tee": false,
    "attestation_expiration_ms": "604800000",
    "policy": { "per_payment_cents": "2500", "budget_cents": "5000", "period_ms": "86400000",
                "max_evm_fee_wei": "300000000000000", "agent_gas_allowance": "500000000000000000000000" }
  }' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-legacy-keychain send
```

The wasm is about 830 KB, so the account needs about 9 NEAR for storage.

On mainnet, use `v1.signer` and `near:mainnet`.

With `requires_tee: true`, approve the agent image's measurements and the hardware PPIDs (`approve_measurements`, `approve_ppid`), and let the agent call `register_agent` with its attestation.

Then, as the owner:

- `allow_token` the stablecoins (e.g. `near:testnet` / `payrouta-test-usd.testnet` / 6, `eip155:84532` / Base Sepolia USDC / 6);
- `allow_merchant` the PayRouta merchants;
- `approve_agent` the agent's key (local mode).

For real protection, delete the vault account's full-access key once it's set up: the owner manages it through owner methods, not through keys on the vault.
