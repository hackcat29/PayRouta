# SEPA credit transfers and direct debit

> **Implementation status:** Stripe hosted EUR credit transfers and Stripe/Adyen SEPA direct debit are implemented. Instant SEPA is not guaranteed. See [current coverage](provider-coverage.md).

**Method IDs**: `bank-transfer`, `direct-debit`

For credit transfers, enable Stripe `customer_balance`, select `bank-transfer`, optionally restrict `metadata.payment_rail: "sepa-credit"`, and provide `metadata.stripe_customer_id` for a customer in the exact merchant or connected account. EUR uses `eu_bank_transfer`; configure IBAN country DE, FR, IE or NL. Stripe supplies genuine bank instructions and reconciles the customer cash balance. Hosted checkout completion is not proof of received funds; authenticated paid status and full receipt amount are required.

SEPA debit is separate: select `direct-debit`, enable Stripe `sepa_debit` or Adyen `sepadirectdebit`, and complete the provider's mandate flow. PayRouta does not implement direct bank APIs, guaranteed instant execution, arbitrary corporate IBAN provisioning or payouts.

See [Stripe bank transfers](https://docs.stripe.com/payments/bank-transfers).
