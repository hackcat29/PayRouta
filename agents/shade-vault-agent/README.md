# PayRouta vault agent (Shade Agent, TEE)

A [NEAR Shade Agent](https://docs.near.org/ai/shade-agents/introduction) that pays PayRouta checkouts from a PayRouta [agent vault](../../docs/agent-vault.md) in TEE mode.

It runs on Phala Cloud inside an Intel TDX enclave. `shade-agent-js` generates its NEAR key in the enclave and registers it with the vault through an attestation. The vault checks the quote, the image's measurements and the hardware's PPID before it accepts the agent. The agent's key never leaves the enclave.

For each payment:

1. The agent asks PayRouta's agent API to pay a checkout, and PayRouta returns a payment order it signed.
2. The agent calls the vault's `pay`. On an EVM chain, NEAR Chain Signatures signs the vault's transfer.
3. The agent broadcasts the signed transaction.

The vault enforces its owner's merchants, per-payment cap and budget whatever the agent is told.

| Endpoint | |
| --- | --- |
| `GET /` | The agent's NEAR account, the vault, whether it is registered, the vault's EVM address |
| `POST /register` | Funds the agent's account from the sponsor and registers it with the vault |
| `POST /pay` | `{ "link": "<payment link slug or URL>" }` or `{ "checkoutUrl": "…" }` |

## Deploy to Phala Cloud

You need:

- Docker, logged in to a public registry (the config uses `ghcr.io/hackcat29/payrouta-vault-agent`, a public GitHub package);
- a [Phala Cloud](https://cloud.phala.network/register) account with credits and an [API key](https://cloud.phala.network/dashboard/tokens) (it starts with `phak_`);
- Node 22.

1. Install the Shade Agent CLI and set up credentials. The master account signs the vault's owner calls, so use the vault's owner (or hand the vault to the CLI's account with `update_owner_id`):

   ```bash
   npm i -g @neardefi/shade-agent-cli
   shade auth set all testnet
   ```

2. Configure:

   ```bash
   cd agents/shade-vault-agent
   npm ci
   cp .env.example .env
   ```

   - In `.env`, set `SPONSOR_ACCOUNT_ID` and `SPONSOR_PRIVATE_KEY` to a funded testnet account that isn't the vault's owner. The sponsor pays the agent account's gas, about 0.5 NEAR.
   - To push elsewhere, change the image in `deployment.yaml` and `docker-compose.yaml`. Phala pulls it without credentials, so it must be public.

3. Deploy:

   ```bash
   shade plan
   shade deploy
   ```

   The CLI then does four things:
   - builds the image and pins its digest in `docker-compose.yaml`;
   - approves the image's measurements and Phala's PPIDs on the vault;
   - deploys to Phala;
   - prints the app's URL.

   On start, the agent funds its account and calls `register_agent` with its attestation.

4. Check it registered:

   ```bash
   curl https://<app-url>/
   ```

   The answer shows `"registered": true`. On-chain, the vault's `get_agents` lists the agent with mode `tee` and its measurements.

5. As the owner, set what the agent may do:

   ```bash
   V=payrouta-tee-vault.testnet; O=<CLI master account>
   near contract call-function as-transaction $V set_order_signer json-args '{"order_signer":"<orderSigner from https://payrouta.com/api/agent/v1/order-key>"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as $O network-config testnet sign-with-keychain send
   near contract call-function as-transaction $V allow_merchant json-args '{"merchant":"<your PayRouta business id>"}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as $O network-config testnet sign-with-keychain send
   ```

6. Fund the vault's EVM address (`evmAddress` from `GET /`) with Base Sepolia ETH and USDC. Then pay a test-mode payment link that takes USDC on Base Sepolia:

   ```bash
   curl -X POST https://<app-url>/pay -H 'content-type: application/json' -d '{"link":"<slug>"}'
   ```

Phala bills while the app runs; delete it from the [dashboard](https://cloud.phala.network/dashboard) when you're done.

## Without a TEE

Outside a TEE, `shade-agent-js` makes a random key and a placeholder attestation, and a TEE-mode vault rejects it. That's checked on NEAR testnet:

```
Smart contract panicked: Attestation rejected: dcap verification failed
```

For development, use a local-mode vault: its owner adds the agent's key with `approve_agent`, and the agent then pays from its own account.
