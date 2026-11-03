# Agentic payments

AI agents pay PayRouta payment links and checkouts over HTTP, with no browser. An agent pays like any customer: it sends the exact transfer from its wallet, or signs one transfer from its NEAR Intents balance. Your confirmation, settlement and webhooks are the same as for any other payment.

A business that gives an agent money to spend issues it an **agent key** with limits: a budget per day, week or month, a most-per-payment, and optionally the merchants it may pay and the NEAR Intents account it pays from. PayRouta checks every payment against them before preparing it.

To run your own payments from an AI assistant, see [MCP server](mcp.md).

> Agents pay in crypto: payment links in USD with stablecoins on, and crypto checkouts. Paying from a NEAR Intents balance runs on mainnet only.

## How an agent pays

All paths are under `/api/agent/v1`. A checkout is authorized by its token in the `PayRouta-Checkout-Token` header. An agent key, if the agent has one, goes in `Authorization: Bearer pra_…`.

### 1. Read the link's terms

```http
GET /api/agent/v1/links/k3Fd92xQ
```

The answer is `402 Payment Required`:

```json
{
  "error": "Payment required",
  "merchant": "Synth Labs",
  "title": "API credits",
  "amount": "25.00",
  "currency": "USD",
  "testMode": false,
  "accepts": [
    { "method": "wallet", "description": "Send a token on-chain to the address checkout gives you" },
    { "method": "intents", "network": "near:mainnet", "description": "Sign one transfer intent from a NEAR Intents balance; no gas" }
  ],
  "checkout": { "method": "POST", "url": "https://payrouta.com/api/agent/v1/checkouts", "body": { "link": "k3Fd92xQ" } }
}
```

The payment link page also points to this URL with `<link rel="alternate" type="application/json">`.

### 2. Open a checkout

```http
POST /api/agent/v1/checkouts
{ "link": "k3Fd92xQ" }
```

You can also pass `{ "checkoutUrl": "https://payrouta.com/checkout/…#…" }` for a checkout a merchant created for the agent, or `{ "invoice": "<slug or invoice URL>" }` to pay a [subscription](subscriptions.md) invoice. An invoice's terms are at `GET /api/agent/v1/invoices/{slug}`, in the same shape as a link's. The answer (`201`) carries `checkout` and `token`, the amount, and `payWith`: each network with the tokens the agent can pay with. A token's `route` is `direct` (sent to the merchant's address as is) or `swap` (swapped by NEAR Intents into the merchant's stablecoin).

### 3. Pay

From a wallet:

```http
POST /api/agent/v1/checkouts/{checkout}/pay
PayRouta-Checkout-Token: …
{ "token": "direct:…", "from": "wallet" }
```

The answer is the transfer to make: `network`, `token`, `amount`, `address` and `deadline`. For a `swap` token, also send `refundTo`, the agent's own address on the network it pays from; the answer then includes a one-time deposit address, and any `memo` it needs.

From a NEAR Intents balance (mainnet):

```http
POST /api/agent/v1/checkouts/{checkout}/pay
PayRouta-Checkout-Token: …
{ "token": "swap:nep141:…", "from": "intents", "payer": "agent.near" }
```

The answer is `kind: "sign"`, with the intent to sign: an ERC-191 message for an EVM address, or a NEP-413 payload (`message`, `nonce`, `recipient`) for a NEAR account. PayRouta checks that it moves exactly the quoted tokens from the payer to the quote's deposit account before returning it. Sign it with the account's key and submit:

```http
POST /api/agent/v1/checkouts/{checkout}/submit
PayRouta-Checkout-Token: …
{ "payment": "…", "signature": "0x… or base64", "publicKey": "ed25519:… (NEAR accounts)" }
```

NEAR Intents executes it; the agent pays no gas. A named NEAR account must have registered its key with NEAR Intents once.

### 4. Check the payment

```http
GET /api/agent/v1/checkouts/{checkout}
PayRouta-Checkout-Token: …
```

`paid` is `true` once the payment is confirmed on-chain. For a swap, `swap.status` follows it: `PENDING_DEPOSIT`, `PROCESSING`, `SUCCESS`, or `REFUNDED` to the agent.

## Agent keys

Create keys in the dashboard under **Developers → Agent keys**:

- **Budget** in US dollars, per day, week (from Monday) or month, in UTC.
- **Most per payment.**
- **Merchants** (optional): payment link URLs or merchant IDs. Empty allows any PayRouta merchant.
- **NEAR Intents account** (optional): the only account the agent may pay from.

A payment is reserved against the budget when the agent asks to pay, counted once it is confirmed, and released if the checkout ends unpaid or its swap is refunded. Retrying the same checkout reserves nothing new. Revoking the key stops further payments at once.

The limits bound what PayRouta prepares and submits for the key. The agent's wallet and NEAR Intents account stay its owner's; PayRouta never holds their funds or keys.

## What a key has spent

**Developers → Agent keys** shows each key's spending this period against its budget. Open a key to see every payment it started: the merchant, what it was for, the amount and whether it was paid.

The agent can check the same with `GET /api/agent/v1/spending` (its key as the bearer token) or the `get_spending` MCP tool.

## Paying over MCP

Agents that speak the Model Context Protocol can pay without calling the HTTP API: connect to `https://payrouta.com/api/mcp` with the agent key as the bearer token. See [MCP server](mcp.md#for-a-buyers-agent).


## Errors

| Code | Meaning |
| --- | --- |
| `AGENT_MERCHANT_NOT_ALLOWED` | The key can't pay this merchant |
| `AGENT_PAYMENT_OVER_LIMIT` | Over the key's most per payment |
| `AGENT_BUDGET_EXCEEDED` | Over the key's budget for the period |
| `AGENT_PAYER_NOT_ALLOWED` | The key can only pay from its own NEAR Intents account |
| `AGENT_PAYMENT_NOT_OFFERED` | The link doesn't take crypto |
| `CROSS_CHAIN_LIVE_ONLY` | NEAR Intents payments need a live (mainnet) checkout |
| `INTENTS_SIGNATURE_INVALID` | The signature isn't the payer's, over the intent PayRouta returned |
| `INTENTS_QUOTE_EXPIRED` | The intent was already submitted, or its quote expired |
