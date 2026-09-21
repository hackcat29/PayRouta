# Merchant API 0.1.0 (private development)

Base path: `/api/v1` on your configured local/private origin. No public API deployment or SDK publication is claimed. OpenAPI: `GET /api/v1/openapi.json`, generated from `lib/merchant/contracts.ts`; creation request schemas reuse the payment domain's Zod contract.

## Access and environment

Use `Authorization: Bearer <server secret>` and `PayRouta-Environment: sandbox` (or `production`). Missing/invalid credentials return 401; missing scopes or environment mismatch return 403. The current merchant configuration supports one environment per organization. Switching the dashboard to an unconfigured environment shows an access/readiness state, never the other environment's totals. Production execution is deliberately unavailable.

Organization membership is reused. `Membership.merchantRole` is separate from the provider `role`; merchant roles are Owner, Admin, Developer, Finance, Analyst. Owners/admins administer keys, webhooks, onboarding, and team; Developers have integration access; Finance/Analyst have read access. Privileged UI changes require the existing MFA step-up. Invitations reuse the existing expiring hashed-token workflow and verified email matching. Accepting an invitation does not downgrade an existing role.

Create keys at `/merchant/developers/api-keys`. Secrets are shown once; only a SHA-256 verifier and safe prefix are stored. Scope, expiry, last use, and revocation are persisted. Rotate by creating a replacement, updating your server, then revoking the old key. Keys cannot change their own scopes or merchant identity. When removing a team member, independently rotate/revoke shared integration keys they knew.

Permissions: `payments:read`, `payments:write`, `settlements:read`, `webhooks:read`, `webhooks:write`, `configuration:read`. UI-issued write keys cover payment creation; webhook-write keys can be issued through the authenticated `/api/merchant` issue-key action with owner/admin step-up. Do not put API keys in React, URLs, logs, metadata, or telemetry.

## Resources

| Operation | Permission | Behavior |
|---|---|---|
| POST `/payment-intents` | payments:write | Existing createIntent service; exact amounts and fingerprinted idempotency |
| GET `/payment-intents`, `/payment-intents/{id}` | payments:read | Merchant/environment scoped public projection |
| POST `/payment-intents/{id}/cancel` | payments:write | Idempotent local cancellation only before any attempt exists; revokes sessions |
| GET `/payments`, `/payments/{id}` | payments:read | Normalized intent outcome; includes pending states, not only paid records |
| GET `/available-methods/{intentId}` | payments:read | Existing contextual availability service; no provider inventory |
| POST `/checkout-sessions` | payments:write | `{ "intentId": "..." }`; limited hosted checkout URL |
| GET `/checkout-sessions/{id}` | payments:read | ID, intent ID, expiry/revocation only; no credential recovery |
| GET `/settlements`, `/settlements/{id}` | settlements:read | Only the merchant's allocations and corresponding totals |
| GET `/configuration` | configuration:read | Environment, country, return origin, application state, method restrictions, exact limits and redacted live-scope review |
| GET/PUT/DELETE `/webhook-endpoint` | webhooks:read/write | One existing configured endpoint; update/rotate/disable |
| GET `/webhook-deliveries`, `/webhook-deliveries/{eventId}` | webhooks:read | Delivery status and attempt count; no internal diagnostics |
| POST `/webhook-deliveries/{eventId}/redeliver` | webhooks:write | Same event ID; queue through existing worker |

POST creation returns 201; other successful operations return 200. PUT webhook body: `url` (public HTTPS), `secret` (32–200 characters), `keyId` (1–40 letters/digits/underscore/hyphen). Outbound delivery uses existing DNS-pinned HTTPS protection, revalidated each send, with redirects disabled. The fixed local simulator receiver cannot be configured as an arbitrary public URL through this API.

## Requests, errors, and pagination

Bodies are limited to 32 KiB. Creation schemas reject unknown fields. `X-Request-Id` is server-generated. Errors have `{ "error": { "code": "IDEMPOTENCY_CONFLICT", "requestId": "..." } }`. Validation is 400; scope/policy access is 403; missing resources are 404; expired state, cancellation restrictions, and idempotency conflicts are 409; request timeout is 408; rate limit is 429 with `Retry-After: 60`; infrastructure failure is 503. Domain-specific codes distinguish unavailable adapters, expired contexts, and invalid amounts.

API rate limit: 120 authenticated requests per merchant/environment per UTC minute, shared across keys. Dashboard CSV exports are limited to five per user per minute. API request history stores operation name, status, duration, environment, and request ID, never request/response bodies or secrets. Authentication failures before a merchant is established are not included in merchant request history.

Lists use descending `(createdAt, id)` ordering. `limit` defaults to 25, maximum 100; `cursor` is opaque. Response: `{ "data": [...], "nextCursor": "..." | null }`. Payment lists support exact `reference`, `state`, selected `method`, and `from` inclusive / `to` exclusive creation dates (UTC ISO date or timestamp). Empty filter fields are ignored. Cursors retain tenant/environment predicates. Changing filters starts a new pagination sequence; concurrent changes may affect later pages. Settlement and delivery listing currently accept common paging parameters but do not apply payment-only reference/state filters.

## Money and asynchronous state

Intent amounts are decimal strings in major units with explicit precision and asset `{kind,identifier,network}`. Do not use floating-point arithmetic. Settlement `gross`, `fee`, `net`, allocation `amount` and allocation `fee` are integer strings in **minor units**; `amountUnit` is `minor`. Gross/fees/net are calculated only from this merchant's allocations, not the entire provider batch. Timestamps are UTC ISO 8601.

Intent state is Open, Processing, Confirmed, or Cancelled. The detailed execution state can be Pending, Requires action, Unknown, or Rejected. Provider acceptance is not confirmation. A Confirmed intent is not evidence of completed settlement or reconciliation. Cancellation cannot retract issued instructions or an existing attempt. Browser return URLs are navigation hints only.

Intent creation requires `reference`, `amount`, `asset`, `precision`, `methods`, `settlement`, `returnUrl`; optional bounded metadata and simulator scenario are in OpenAPI. Methods are customer-selected. Return origin must match MerchantConfig. Sandbox execution currently requires explicit local mode and same-asset settlement.

Both creation endpoints require `Idempotency-Key` (8–100 word/hyphen characters). Intent keys are scoped to merchant/environment and canonical request fingerprint. Session keys are scoped to merchant/environment/resource and bound to the intent; reusing a key for another intent conflicts. Session retries recover the same limited credential from the existing encrypted secret manager while it remains valid. A timeout or 5xx can be uncertain: inspect/retry with the **same** key, never a newly generated key. SDKs automatically retry only reads, at most twice, with timeout and bounded Retry-After handling.

## Webhooks

Signature headers: `payrouta-event-id`, `payrouta-timestamp` (Unix seconds), `payrouta-key-id`, `payrouta-signature` (hex HMAC-SHA256). Signed bytes are `timestamp + "." + eventId + "." + rawBody`. Pass untouched body bytes to either SDK; default timestamp tolerance is 300 seconds. Resolve the signing secret by key ID; retain previous receiver keys during rotation.

Persist event ID with your consumer's business effects transactionally. Delivery is at least once and may be out of order. Use the existing payload `objectVersion`; old events must not regress state. Successful redelivery acknowledgment does not create another payment. Disabling an endpoint leaves events retryable; it does not stop confirmation, journal posting, or settlement processing.

## SDKs and examples

Node: `npm run sdk:build`, then install `sdks/node` from its absolute local path. Python: install `sdks/python`, or set `PYTHONPATH=sdks/python`. Both are private version 0.1.0, unpublished. See `examples/README.md` for the Node/Python merchant servers and React component. Generic request and cursor iteration cover every implemented API resource. TypeScript has structured payment/session types; Python returns dictionaries and structured exception objects. These are not fully generated SDK model sets.

CSV export uses existing session auth at `/api/merchant/export`, with `orgId`, `environment`, and UTC `from`/`to`. Maximum window 31 days and 1,000 rows; larger exports fail with a request to narrow the range. Downloads are direct authorized no-store responses, not public files. Spreadsheet formula prefixes are neutralized; secrets/customer details are excluded.

Configuration contains no provider account references, document IDs, review reasons or internal screening rules. `liveExecutionEnabled` remains false. Permitted methods describe merchant policy; call contextual available-methods before selection. Scope approval and an unexpired review are separate from provider availability and execution qualification.
