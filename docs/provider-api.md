# PayRouta Provider API

The Provider API is how an external payment provider joins the PayRouta network
without a custom code deployment inside PayRouta. It is the **STANDARD**
integration mode. PayRouta runs a single `StandardProviderAdapter` against every
conforming provider.

- OpenAPI: `docs/provider-api.openapi.yaml`
- Adapter: `lib/providers/standard/adapter.ts`
- Wire contract: `lib/providers/standard/contract.ts`

## Integration modes

| Mode | Maintained by | What it means |
| --- | --- | --- |
| `NATIVE` | PayRouta | PayRouta builds and maintains the provider-specific adapter. Uses the same normalized contracts as every other integration. |
| `STANDARD` | Provider | The provider implements this Provider API. No custom deployment. |
| `CONFIGURABLE` | Provider | A provider's existing API is mapped declaratively (base URL, auth, endpoints, status/field mappings). No code execution. |

## Authentication

Providers authenticate with a `Bearer` token (or `X-API-Key`). The secret is
stored in PayRouta's credential system and referenced by the integration
configuration. Secrets are never logged, and never appear in routing or
analytics data.

```
Authorization: Bearer <provider-secret>
```

## Idempotency

Every `POST /payments` carries an `Idempotency-Key` header. The provider MUST
durably deduplicate on it: repeated identical requests return the same
`providerPaymentId`. A reused key with a different payload must return
`409 IDEMPOTENCY_CONFLICT`.

## Status mapping

The provider returns one of six statuses. PayRouta maps them deterministically:

| Provider status | PayRouta normalized state |
| --- | --- |
| `succeeded` | `Confirmed` |
| `failed`, `cancelled` | `Rejected` |
| `action_required` | `Requires action` |
| `pending`, `processing` | `Pending` |

Unknown status strings are rejected — never assumed positive.

## Amounts

All amounts are exact decimal strings (minor units are computed by PayRouta,
never by floating point). Do not round provider money.

## Webhooks

Providers may deliver events by webhook. PayRouta verifies
`HMAC-SHA256(timestamp.eventId.body)` against the provider's signing secret
before applying anything. Duplicate and out-of-order events are ignored.

## Retry and unknown state

A non-2xx response to `POST /payments` is not proof of non-execution. PayRouta
re-queries `GET /payments/{providerPaymentId}` before making any next decision.
A `404` on status lookup is treated as an unknown outcome, never as safe
fallback evidence.

## Error model

Errors use a bounded envelope; raw upstream messages never leave the adapter
boundary.

```json
{
  "error": {
    "code": "AUTHENTICATION_FAILURE",
    "message": "short explanation"
  }
}
```

## Certification

Before any capability becomes production-routable, PayRouta runs a
capability-aware certification suite. A card-only provider is not failed for
lacking stablecoin support. Scenarios include payment creation, status lookup,
idempotency, webhook signature verification, and cancellation (where supported).
See `lib/providers/certification/suite.ts`.
