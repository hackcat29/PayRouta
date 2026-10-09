# Monnify

> **Implementation status:** NGN hosted card and account-transfer checkout plus authenticated transaction queries are implemented. Merchant contract and sandbox qualification remain required. See [current coverage](provider-coverage.md).

**Method IDs**: `bank-transfer`, `card`  
**Integration Mode**: `NATIVE` (`monnify`)

Configure `apiKeyRef`, `secretKeyRef`, `contractCode`, `returnUrl` and the matching sandbox/production environment. API origins are pinned to `sandbox.monnify.com` / `api.monnify.com`. Merchant metadata must include real `payer_name` and `payer_email`; no fabricated customer details or account instructions are sent.

Monnify initializes a hosted checkout restricted to `CARD` or `ACCOUNT_TRANSFER`, validates the exact invoice/reference/currency, and returns the official checkout URL. OAuth login authenticates status queries by the original payment reference. A `PAID` receipt must supply its genuine `amountPaid`; it is then matched against the invoice by the payment engine.

This adapter does not implement reserved account provisioning, identity verification, token caching, payouts or settlement imports. The retained legacy transaction-hash verifier does not directly confirm money; authenticated query receipts are required.

See [Monnify checkout API](https://monnify-docs.playground.monnify.com/docs/collections/one-time-payments/checkout-api).
