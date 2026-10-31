# Venmo

**Method ID**: `digital-wallet`  
**Integration Mode**: `NATIVE`

Configure merchant-owned PayPal client/secret references, merchant ID, `merchantCountry: "US"` and `venmoApproved: true`. Select `digital-wallet` with optional `metadata.preferred_wallet: "venmo"`. The ordinary PayPal partner redirect cannot process this hint.

The server creates one order with exact USD amount, merchant payee and stable reference. Checkout loads PayPal's official Venmo button SDK for app switching or desktop QR. PayPal decides eligibility. Approval queues a backend refresh; the browser cannot confirm payment or capture funds.

Authenticated order reads must show Venmo funding. Before idempotent server capture, the order must match the immutable invoice amount and merchant identity. Confirmation requires a final completed capture for the full amount. Missing order IDs, conflicting receipts and capture mismatches require inspection. Settlement remains separate from payment confirmation.

See [Venmo integration](https://developer.paypal.com/v5/venmo/integrate) and [PayPal SDK reference](https://developer.paypal.com/sdk/js/v1/reference).
