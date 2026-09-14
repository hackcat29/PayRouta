# Quickstart

This walkthrough uses a local payment intent object to illustrate the end-to-end integration sequence for accepting multi-rail global payments and configuring decoupled merchant settlement with PayRouta.

> [!NOTE]
> This guide demonstrates proposed API objects and interfaces. Early access and implementation details must be confirmed before production deployment.

---

## 1. Describe the payment intent

The merchant specifies invoice amount, currency, accepted payment rails, payer context, and preferred settlement destination. Accepted methods constrain the choices that may be offered; availability is evaluated dynamically:

```json
{
  "amount": "25000.00",
  "currency": "NGN",
  "payer_context": { "country": "NG" },
  "settlement": { "currency": "NGN", "target_instrument": "local_bank" },
  "accepted_methods": [
    "bank_transfer",
    "digital_wallet",
    "mobile_money",
    "stablecoins",
    "crypto_app",
    "cash_voucher"
  ],
  "merchant_reference": "order_ng_2026_0914_01"
}
```

---

## 2. Evaluate availability

Use the full transaction context to determine viable methods:
* Country, currency, ticket-size limits, and provider capabilities determine rail viability.
* Regulatory status, compliance requirements, and current operating liquidity are evaluated in real time.
* Never hard-code static country-to-method lookup tables on the frontend.

---

## 3. Collect the customer’s choice

Present available payment methods with clear labels and direct institutions (e.g., specific banks, mobile money operators, or digital wallets):
* The customer's explicit choice must be respected.
* If a customer's preferred method becomes temporarily unavailable, do not silently switch rails. Explain the state and request a new customer selection.

---

## 4. Route within that method

Compare only eligible providers capable of executing the chosen method:
* A bank transfer choice compares direct banking providers (e.g., GTBank, Zenith, Access Bank via direct API or NIP).
* Relative cost, settlement estimates, and latency are evaluated strictly within the selected rail.
* Pre-execution failover shifts to alternative direct routes within that same method if the primary route is degraded.

---

## 5. Reconcile updates and settlement

Persist your unique business reference (`merchant_reference`) and associate it with asynchronous updates:
* Payment confirmation (`payment.confirmed`) and merchant settlement (`settlement.completed`) operate on decoupled timelines.
* Fulfill customer orders immediately upon payment confirmation without waiting for multi-day bank settlement clearing.
* Idempotently process incoming webhooks using verified signatures to prevent duplicate order fulfillment.

---

## Next steps

* Learn how to specify accepted methods in [Payment Intents](payment-intents.md).
* Explore supported rails and channels in [Payment Methods & Channels](payment-methods.md).
* Review signature verification in [Webhooks & Events](webhooks.md).
* See error recovery in [Errors & Recovery](errors.md).
