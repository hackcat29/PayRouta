# API reference

Base path: `https://<your PayRouta host>/api/v1`. The machine-readable contract is at `GET /api/v1/openapi.json`.

## Authentication

Send both headers on every request:

```
Authorization: Bearer pr_sandbox_…
PayRouta-Environment: sandbox
```

Keys are created in the dashboard under **Developers → API keys**, and each key is bound to one environment. Unknown or revoked keys return `401`. A missing scope, or an environment that doesn't match the key, returns `403`.

| Scope | Allows |
| --- | --- |
| `payments:read` | Read intents, payments, available methods and checkout sessions |
| `payments:write` | Create intents, cancel intents, create checkout sessions |
| `settlements:read` | Read settlements |
| `webhooks:read` | Read the webhook endpoint and deliveries |
| `webhooks:write` | Configure the webhook endpoint and request redelivery |
| `configuration:read` | Read workspace configuration |

## Endpoints

| Method and path | Scope | Description |
| --- | --- | --- |
| `POST /checkouts` | payments:write | One checkout for one order: fiat methods and credit, plus crypto for USD orders. Requires `Idempotency-Key` |
| `POST /payment-intents` | payments:write | Create an intent. Requires `Idempotency-Key` |
| `GET /payment-intents` | payments:read | List intents |
| `GET /payment-intents/{id}` | payments:read | Retrieve an intent |
| `POST /payment-intents/{id}/cancel` | payments:write | Cancel, only before any payment attempt exists |
| `GET /payments`, `GET /payments/{id}` | payments:read | Normalized payment outcomes, including pending ones |
| `GET /available-methods/{intentId}` | payments:read | Methods that can currently complete this intent |
| `POST /checkout-sessions` | payments:write | `{ "intentId": "…" }`. Requires `Idempotency-Key` |
| `GET /checkout-sessions/{id}` | payments:read | Session expiry and revocation |
| `GET /settlements`, `GET /settlements/{id}` | settlements:read | Settlements that include your payments |
| `GET /configuration` | configuration:read | Environment, return origin, application state, limits |
| `GET`, `PUT`, `DELETE /webhook-endpoint` | webhooks:read / webhooks:write | Read, set or rotate, and disable your endpoint |
| `GET /webhook-deliveries`, `GET /webhook-deliveries/{eventId}` | webhooks:read | Delivery status and attempts |
| `POST /webhook-deliveries/{eventId}/redeliver` | webhooks:write | Redeliver the same event |

Creation returns `201`; other successes return `200`. Every response carries an `X-Request-Id` header.

## Create a payment intent

`POST /payment-intents`

```json
{
  "reference": "order_1042",
  "amount": "15000.00",
  "asset": { "kind": "blockchain", "identifier": "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e", "network": "eip155:84532" },
  "precision": 6,
  "methods": ["stablecoin"],
  "settlement": { "kind": "blockchain", "identifier": "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e", "network": "eip155:84532" },
  "returnUrl": "https://shop.example/orders/1042",
  "metadata": { "orderId": "1042" }
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `reference` | string (1–100) | yes | Your own reference |
| `amount` | decimal string | yes | Major units, such as `"15000.00"`. Never a float |
| `asset` | object | yes | `kind` is `fiat` or `blockchain`; `identifier` is a currency code or a namespaced token id; `network` is `""` for fiat |
| `payerCountry` | string | live: yes | Declared two-letter payer country within approved live scope |
| `precision` | integer 0–18 | yes | Decimal places allowed in `amount` |
| `methods` | array | yes | Launch MVP: `["stablecoin"]` only |
| `settlement` | asset object | yes | Currently must equal `asset`. PayRouta does not convert currencies |
| `returnUrl` | URL | yes | Must be on your registered return origin |
| `metadata` | object | no | Up to 20 string pairs (keys up to 40 characters, values up to 200) |
| `scenario` | string | no | Sandbox only; see the [quickstart](quickstart.md) |

Unknown fields are rejected.

Response (`201`):

```json
{
  "id": "cm…",
  "environment": "sandbox",
  "reference": "order_1042",
  "amount": "15000.00",
  "asset": { "kind": "blockchain", "identifier": "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e", "network": "eip155:84532" },
  "precision": 6,
  "state": "Open",
  "selectedMethod": null,
  "createdAt": "2026-09-28T12:00:00.000Z",
  "expiresAt": "2026-09-28T12:30:00.000Z"
}
```

## Create a checkout session

`POST /checkout-sessions` with `{ "intentId": "…" }` returns `{ "id", "intentId", "expiresAt", "checkoutPath" }`. Redirect the customer to `checkoutPath` on your PayRouta host. The session carries a single-use credential; retrying with the same idempotency key while the session is valid returns the same session.

## Available methods

`GET /available-methods/{intentId}` returns an evaluation:

```json
{
  "evaluationId": "…",
  "evaluatedAt": "…",
  "expiresAt": "…",
  "methods": [
    { "method": "card", "label": "Card", "status": "AVAILABLE", "explanation": "…" }
  ]
}
```

`status` is one of `COMING_SOON`, `AVAILABLE`, `ACTION_REQUIRED`, `TEMPORARILY_UNAVAILABLE`, `UNAVAILABLE` or `UNKNOWN`. Hosted checkout evaluates methods again for the customer, so use this endpoint for your own display or diagnostics only.

## Settlements

Amounts are integer strings in **minor units** (`amountUnit: "minor"`). `gross`, `fee` and `net` count only your own allocations, and `reconciliation` reports whether they matched the provider's report.

## Idempotency

`POST /payment-intents` and `POST /checkout-sessions` require an `Idempotency-Key` header of 8–100 letters, digits, underscores or hyphens. Reusing a key with the same body returns the original result; reusing it with a different body returns `409 IDEMPOTENCY_CONFLICT`. After a timeout or a `5xx`, retry with the **same** key.

## Pagination

Lists return `{ "data": [...], "nextCursor": "…" | null }`, newest first. `limit` defaults to 25 (maximum 100). Payment lists also accept `reference`, `state`, `method`, `from` (inclusive) and `to` (exclusive).

## Limits

Request bodies are limited to 32 KiB. Each merchant environment may make 120 authenticated requests per minute; beyond that PayRouta returns `429` with `Retry-After: 60`. Error codes are listed in [Errors and recovery](errors.md).

## Create a checkout (universal)

`POST /checkouts` is the one call behind the [checkout button](checkout-button.md). It takes the order and returns one checkout link where the customer can pay with any fiat method you list (including `bnpl`, [pay with credit](credit.md)) or, for USD orders, switch to stablecoins and crypto.

```json
{
  "reference": "order_2291",
  "payerCountry": "NG",
  "amount": "40.00",
  "currency": "USD",
  "methods": ["card", "bank-transfer", "mobile-money", "bnpl"],
  "crypto": { "options": [{ "network": "eip155:8453", "identifier": "erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" }] },
  "returnUrl": "https://shop.example/orders/2291",
  "metadata": { "cart": "c_88" }
}
```

`amount` is a decimal string with no more places than the currency allows. `methods` may be empty for a crypto-only checkout; `crypto` is accepted only when `currency` is `USD`, because crypto quotes are USD invoices and PayRouta never converts at an estimated rate. The response:

```json
{
  "id": "grp_6f0c…",
  "reference": "order_2291",
  "checkoutPath": "/checkout/…#…",
  "expiresAt": "2026-10-20T12:30:00.000Z",
  "intents": [{ "kind": "fiat", "intentId": "…" }, { "kind": "crypto", "intentId": "…" }]
}
```

Send the customer to your PayRouta origin + `checkoutPath` (or hand it to the checkout button). Each side is an ordinary intent with its own webhooks; both carry your `reference`. Once a payment starts on one side, the other is locked, so at most one is paid. Retrying with the same key and body returns the same checkout.

## Create a quoted crypto checkout

`POST /crypto-checkouts` accepts a USD invoice and 1–20 reviewed coin/network options. The server fixes exact coin amounts and two-minute expiry using CoinGecko. It requires `payments:write`, an environment header and an idempotency key. See [Crypto wallet payments](crypto-payments.md) for request fields, supported deployments, fees and retry rules. Manually priced crypto payment intents without this quote are rejected.
