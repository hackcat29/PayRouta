# PayRouta Node server SDK (private 0.1.0)

Build from the repository root with `npm run sdk:build`, then install locally with `npm install /absolute/path/to/PayRouta/sdks/node`. Node 20+ is required. No package has been published.

```ts
import { PayRouta, PayRoutaError, verifyWebhook } from '@payrouta/server';
const client = new PayRouta({
  baseUrl: 'http://127.0.0.1:3000/api/v1/',
  secretKey: process.env.PAYROUTA_SECRET_KEY!,
  environment: 'sandbox',
  timeoutMs: 10000,
});
for await (const payment of client.paginate('payments', {limit: '25'})) {
  // Persist/use the merchant-scoped result; amounts remain strings.
}
```

Use `createIntent(input, stableOrderKey)`, `createCheckoutSession(intentId, stableSessionKey)`, and `getPayment(id)`. Other resources use `request(method, relativePath, body?, idempotencyKey?)`. See [API contract](../../docs/MERCHANT-API.md) and [working local servers](../../examples/README.md).

Only GET responses 429/502/503/504 retry, at most twice; Retry-After above 60 seconds returns RETRY_LATER. Writes never automatically retry. PayRoutaError carries code, status, requestId and uncertain. For uncertain writes retain the original key and retrieve state; never start another order to resolve uncertainty. Inject `transport` and `sleep` for deterministic testing.

Verify untouched request bytes with `verifyWebhook(rawBytes, lowerCaseHeaders, {keyId: secret})` before parsing JSON. Keep current and previous signing keys during rotation, enforce the default five-minute timestamp tolerance, and deduplicate by event ID in persistent storage. Browser navigation cannot confirm payment.

Release checklist: update both SDK versions and API documentation, run root unit/contract tests, build, inspect `npm pack --dry-run`, and obtain publication authorization. The package is deliberately private.
