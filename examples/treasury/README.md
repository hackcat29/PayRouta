# Platform sandbox runs

Fictional merchants for `npm run treasury:sandbox -- onboard <provider> <fixture.json>`.
See `scripts/treasury-sandbox.ts` for the environment variables each provider needs.

- `stripe-us-company.json` uses Stripe's documented test values: test routing and account
  numbers, SSN `000000000`, date of birth `1901-01-01` and the address `address_full_match`.
  With these, Stripe's test mode verifies the connected account.
- `ng-company-template.json` is for Paystack and Flutterwave. Before running it, replace
  `payoutAccount.accountNumber` and `routingNumber` (the bank code) with an account that the
  provider's test mode resolves. The name check refuses a payout account that isn't in the
  merchant's name.
- dLocal and Tink need fixtures for their own markets. Tink also needs
  `details.merchantCategoryCode` and a GB sort code or an EU IBAN.
