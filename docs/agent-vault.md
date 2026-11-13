# Agent vault

An agent key's limits (`lib/agents/keys.ts`) bound what PayRouta prepares. The agent vault puts the limits where the money is: a NEAR contract (`contracts/agent-vault`) that an AI agent pays from and that enforces its owner's policy itself.

## What the agent holds

The agent holds **a function-call access key on the vault account**. It is restricted to the vault as receiver and to the `pay` method, with a NEAR allowance for gas. NEAR itself refuses anything else, for example:

- calling the token contract directly (`ReceiverMismatch`);
- calling any other vault method (`MethodNameMismatch`);
- attaching a deposit (`DepositWithFunctionCall`).

The key is added in one of two ways:

- **TEE mode** (`requires_tee: true`). The agent runs inside a TEE (Intel TDX via dstack, e.g. a Shade Agent on Phala Cloud). It submits `register_agent(attestation, public_key)`, and the contract verifies the quote with `shade-attestation` 0.2.0:
  - the report data must be the key (32 bytes, then zeros);
  - the measurements and PPID must be approved by the owner;
  - the TCB must be up to date.

  Only a key generated inside an approved image gets added. Registration expires after `attestation_expiration_ms`, and the agent must re-attest.
- **Local mode.** The owner calls `approve_agent(public_key)`. The approval lasts until `remove_agent`.

The vault works with NEAR's Shade Agent tooling as it is:

- `shade-agent-js` `ShadeClient.register()` calls `register_agent({attestation})` from the agent's implicit account, and the key is that account's;
- `get_agent({account_id})` answers its registration check;
- a registered agent then pays by calling `pay` from that account;
- the Shade Agent CLI approves an image's measurements and Phala's PPIDs with `approve_measurements` and `approve_ppids`;
- `update_owner_id` hands the vault to the CLI's account.

The agent app is [`agents/shade-vault-agent`](../agents/shade-vault-agent), with Phala deployment steps.

## What `pay` checks

`pay(order, signature, evm?)` accepts only a **payment order PayRouta signed** for one checkout. The order carries the payment id, merchant id and name, network, token, `pay_to`, amount in base units, and expiry. It is signed with ed25519 over `"PayRouta agent order v1\n" + order JSON` (`lib/agents/vault.ts`; `PAYROUTA_AGENT_ORDER_KEY_REF`). A prompt-injected agent therefore can't change who is paid or how much.

The contract checks, in order:

1. The caller is the vault account, through an agent key.
2. The agent is registered, its attestation hasn't expired, and its measurements and PPID are still approved.
3. The order is signed by the owner-set `order_signer`, and hasn't expired.
4. The order hasn't been paid before. Each order pays once.
5. The merchant is on the owner's allow-list.
6. The token is an allowed one-dollar stablecoin on that network. The amount is converted to cents, rounded up.
7. The payment is within the per-payment cap and the budget for the period.

Then it pays:

- **On NEAR** (`near:mainnet` / `near:testnet`, as deployed): `storage_deposit` and `ft_transfer` from the vault. On failure, the budget and the order are released.
- **On EVM chains** (`eip155:*`):
  1. The contract builds the EIP-1559 ERC-20 `transfer` itself, with a gas limit of at most 150k and gas × max fee within `max_evm_fee_wei`.
  2. It asks `v1.signer` (`v1.signer-prod.testnet` on testnet) to sign its keccak hash with path `payrouta-agent-vault-evm-1`.
  3. It returns the signed raw transaction for anyone to broadcast.

  The vault's EVM address is the MPC key derived for (vault account, path), from `derived_public_key` (`vaultEvmAddress`). The MPC network signs only what the contract built, so the address only ever sends transfers the policy allowed.

  The budget counts at signing, whether or not the transaction is broadcast.

Owner methods:

- `set_policy`, `reset_spending`;
- `allow_merchant` / `remove_merchant`, `allow_token` / `remove_token`;
- `set_order_signer`;
- `approve_measurements` / `remove_measurements`, `approve_ppid` / `remove_ppid`;
- `approve_agent` (local mode), `remove_agent`.

Views: `get_config`, `get_policy`, `get_spending`, `get_agents`, `get_merchants`, `get_tokens`, `is_paid`.

## PayRouta's side

- `POST /api/agent/v1/checkouts/{id}/pay` returns `vault: { order, signature, signer }` next to the transfer when order signing is configured and the token is one a vault pays with:
  - a stablecoin deposit on an EVM chain, including Base Sepolia USDC in test mode;
  - a NEAR Intents deposit address for a swap from USDC on NEAR or from a stablecoin on an EVM chain.
- `GET /api/agent/v1/order-key` returns `order_signer` for the vault's owner.

## Deployed and verified (NEAR testnet, 13 November 2026)

| | |
| --- | --- |
| Vault | `payrouta-vault.testnet`: local mode, owner `payrouta-buyer.testnet`, $25 a payment, $50 a day |
| Vault EVM address | `0x26d39117e3B1fFB6ce6F973d94C90D604Ce1063B` (Chain Signatures, path `payrouta-agent-vault-evm-1`) |
| Test token | `payrouta-test-usd.testnet` (pUSD, NEP-141, 6 decimals, `contracts/test-usd`) |

`npm run demo:agent-vault` results:

- **Allowed:**
  - A real PayRouta sandbox checkout's order, paid in USDC on Base Sepolia. The MPC signature came back, and viem's `recoverTransactionAddress` on the signed transaction gives the vault's derived address. Broadcast, it succeeded: Base Sepolia tx `0x68e7f9a8c0dfa1d73030a745628bf75a9d2f5279502af201c56513a8f2d44fda` (NEAR request `5VfedPG5daC5Bm6JiLS8rq1p7DKWLnPkdFur76zquqbS`).
  - 20 pUSD paid on NEAR testnet.
- **Refused on-chain** (each with a tx link):
  - a merchant not on the allow-list;
  - over the per-payment cap;
  - an order rewritten by the agent;
  - an order sent twice;
  - over the daily budget.
- **Refused by NEAR** (access key):
  - the agent's key calling the token;
  - the agent's key calling an owner method.

TEE mode, on testnet:

- `payrouta-tee-vault.testnet` is deployed with `requires_tee: true`, owned by `payrouta-buyer.testnet`.
- The Shade vault agent, run outside a TEE, sent its placeholder attestation through `ShadeClient.register()`. The vault refused it on-chain: `Attestation rejected: dcap verification failed`.
- A registration from a real TDX quote needs the agent deployed on Phala Cloud (`agents/shade-vault-agent/README.md`).

The contract uses `shade-attestation`, which doesn't build on macOS. It builds and tests in `sourcescan/cargo-near:0.19.0-rust-1.86.0` (see `contracts/README.md`): 28 unit tests.
