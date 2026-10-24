# Platform sandbox runs

Fictional merchants for `npm run treasury:sandbox -- onboard <provider> <fixture.json>` and `npm run treasury:sandbox -- qualify <provider> <fixture.json>`.
See `scripts/treasury-sandbox.ts` for the environment variables each provider needs.

- `stripe-us-company.json` uses Stripe's documented test values: test routing and account
  numbers, SSN `000000000`, date of birth `1901-01-01` and the address `address_full_match`.
  With these, Stripe's test mode verifies the connected account. Also works for `bridge-split`.
- `ng-company-template.json` uses the Access Bank (`044`) test account `0690000032` that
  Paystack and Monnify sandboxes resolve via NIBSS name enquiry (`SHERIFAT BOLANLE IYANDA`).
- `flutterwave-ng-company.json` uses Flutterwave's documented Access Bank (`044`) test
  account `0690000032` (`Pastor Bright`) for `flutterwave-split` and `yellowcard-split`.
- dLocal and Tink need fixtures for their own markets. Tink also needs
  `details.merchantCategoryCode` and a GB sort code or an EU IBAN.
