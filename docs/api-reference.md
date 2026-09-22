# API Reference

The PayRouta REST API allows merchants to programmatically generate payment intents, query real-time method availability, select an eligible provider, and track decoupled settlements.

> [!NOTE]
> All requests must be made over **HTTPS**. Responses are returned in **JSON** format with standard HTTP status codes.

---

## Standard headers

* `Authorization: Bearer <key>` — Secret key authentication (`Bearer sec_live_...`).
* `Idempotency-Key: <uuid>` — Unique UUID v4 preventing duplicate operations during network retries.
* `PayRouta-Version: 2026-09-14` — API version identifier.
* `Content-Type: application/json` — Standard payload format.

---

## Core endpoints summary

* `POST /v1/payment_intents` — Create a new payment intent.
* `GET /v1/payment_intents/:id` — Retrieve intent details and execution status.
* `GET /v1/payment_intents/:id/available_methods` — Evaluate viable payment rails and direct institutions.
* `POST /v1/payment_intents/:id/select_method` — Submit the customer's chosen method and institution.
* `POST /v1/payment_intents/:id/confirm` — Execute routing and initiate provider authorization.
* `GET /v1/settlements/:id` — Retrieve merchant settlement status and payout proof.

---

## 1. Create a Payment Intent

`POST /v1/payment_intents`

Creates a new payment intent expressing the merchant's commercial constraints.

### Request payload

```json
{
  "amount": "250.00",
  "currency": "EUR",
  "accepted_methods": [
    "instant_bank",
    "digital_wallet",
    "card",
    "stablecoins",
    "crypto_app",
    "rwa"
  ],
  "settlement": {
    "currency": "EUR",
    "target_instrument": "local_bank"
  },
  "payer_context": {
    "country": "DE",
    "ip_address": "185.220.101.5"
  },
  "merchant_reference": "inv_eu_88192"
}
```

### Response `201 Created`

```json
{
  "id": "pi_01j8k9m2x",
  "status": "requires_method_selection",
  "amount": "250.00",
  "currency": "EUR",
  "settlement": {
    "currency": "EUR",
    "target_instrument": "local_bank"
  },
  "created_at": "2026-09-14T01:30:00Z",
  "expires_at": "2026-09-14T02:00:00Z"
}
```

---

## 2. Query available methods

`GET /v1/payment_intents/:id/available_methods`

Evaluates real-time availability across corridors, provider health, liquidity, and limits.

### Response `200 OK`

```json
{
  "intent_id": "pi_01j8k9m2x",
  "methods": [
    {
      "id": "sepa_instant",
      "category": "instant_bank",
      "label": "SEPA Instant",
      "status": "available",
      "channels": ["web", "mobile_app", "qr"],
      "direct_institutions": [
        "Deutsche Bank",
        "BNP Paribas",
        "ING Bank",
        "Santander"
      ]
    },
    {
      "id": "card",
      "category": "card",
      "label": "Cards & Schemes",
      "status": "available",
      "channels": ["e_commerce", "pos_terminal", "softpos"],
      "direct_institutions": [
        "Girocard",
        "Carte Bancaire",
        "Visa",
        "Mastercard"
      ]
    },
    {
      "id": "stablecoins",
      "category": "stablecoins",
      "label": "Circle USDC & EURC",
      "status": "available",
      "channels": ["circle_mint", "direct_transfer"],
      "networks": ["Avalanche C-Chain", "Base", "Solana", "Ethereum"]
    }
  ]
}
```

---

## 3. Select method & execute

`POST /v1/payment_intents/:id/select_method`

Submits the customer's explicit choice and initiates optimal route execution.

### Request payload

```json
{
  "selected_method": "sepa_instant",
  "direct_institution": "Deutsche Bank",
  "initiation_channel": "web"
}
```

### Response `200 OK`

```json
{
  "intent_id": "pi_01j8k9m2x",
  "status": "processing",
  "selected_method": "sepa_instant",
  "selected_institution": "Deutsche Bank",
  "route": {
    "provider_id": "de_direct_banking_core",
    "execution_type": "instant_push",
    "qr_payload": "https://pay.payrouta.com/qr/01j8k9m2x",
    "deep_link": "bankapp://pay/01j8k9m2x"
  }
}
```

---

## 4. Query settlement status

`GET /v1/settlements/:id`

Retrieves the merchant settlement lifecycle and payout confirmation.

### Response `200 OK`

```json
{
  "settlement_id": "set_8892102",
  "intent_id": "pi_01j8k9m2x",
  "status": "completed",
  "disbursed_amount": "250.00",
  "currency": "EUR",
  "payout_destination": "DE89370400440532013000",
  "cleared_at": "2026-09-14T01:32:15Z",
  "payout_reference": "NIP/PR/9920102"
}
```

---

## HTTP status codes

* `200 OK` — Request completed successfully.
* `201 Created` — Resource created (e.g., payment intent).
* `400 Bad Request` — Malformed JSON or invalid parameter syntax.
* `401 Unauthorized` — Missing or invalid API key.
* `404 Not Found` — Requested resource ID does not exist.
* `409 Conflict` — Idempotency collision or invalid state transition.
* `422 Unprocessable` — Request valid but violates business logic or transaction limits.
* `502 Bad Gateway` — Upstream clearing network timeout or connectivity error.

---

## Next steps

* Review data models in [Payment Intents](payment-intents.md).
* Handle webhooks with [Webhooks & Events](webhooks.md).
* Review error formats in [Errors & Recovery](errors.md).

## Implemented provider control-plane availability

The local Node application implements protected availability through the existing `POST /api/portal/command` namespace. `evaluate-availability` accepts `orgId` and `contextId`, checks membership, and evaluates a persisted trusted context. It does not accept caller-defined merchant permissions or verification claims. `availability-explanation` returns only the checkout-safe view. Internal context authoring, observations, registry inspection and reconciliation require Operations admin and fresh MFA.

See [Provider integration concepts](/docs/provider-integration) for the public integration workflow. The backend control-plane details in this repository are internal implementation notes, not a published production route.
