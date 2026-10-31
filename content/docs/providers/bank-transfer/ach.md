# US bank transfers and ACH debit

**Method IDs**: `bank-transfer`, `direct-debit`

For credit transfers, enable Stripe `customer_balance`, select `bank-transfer`, optionally restrict `metadata.payment_rail: "us-bank-transfer"`, and supply `metadata.stripe_customer_id` for an existing customer in the exact merchant or connected account. Stripe's `us_bank_transfer` supports ACH and wire; this integration does not promise an exclusive ACH rail or instant settlement. Stripe hosts bank instructions and reconciles incoming customer cash balance. Confirmation requires authenticated paid status and the exact invoice amount.

For ACH debit, select `direct-debit`, enable `us_bank_account`, and use the hosted authorization/mandate flow. Buyer authorization does not imply settled funds. Direct commercial-bank integration, FedNow/RTP and outbound ACH payouts are outside the implemented scope.

See [Stripe bank transfers](https://docs.stripe.com/payments/bank-transfers).
