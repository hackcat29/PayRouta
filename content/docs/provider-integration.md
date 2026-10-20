# Provider integration

For payment providers: how your service becomes available to merchants on PayRouta.

## Getting access

The provider workspace is by invitation. [Request provider access](/partners#request) with your company, licensing country, the methods you process and where you can process them. Our partnerships team reviews each request. If it's approved, we create your provider workspace and email you an invitation to set up your login. Everything below happens inside that workspace.

## How PayRouta works with providers

PayRouta is a payment aggregator. Merchants sign up with PayRouta once. PayRouta verifies each business, its representatives and its owners, screens them against sanctions lists, and then processes their payments through providers it has a platform relationship with.

Merchants only ever deal with PayRouta. They don't fill in your forms, log in to your dashboard or see your name in theirs. Your service does the processing behind PayRouta, under the contract between your company and PayRouta.

## Ways to connect

Every connection declares where merchant funds sit. PayRouta prefers models where funds stay with you, as the licensed party, rather than in PayRouta's own bank accounts.

| Model | Where merchant funds sit | What your platform needs to offer |
| --- | --- | --- |
| **Platform accounts** | In a balance for each merchant inside your platform, under PayRouta's platform account | An API to create and verify sub-merchant accounts without hosted pages, a balance per merchant, payouts when PayRouta instructs them, and a way to deduct PayRouta's fee from each payment |
| **Split settlement** | Paid by you straight to the merchant's bank, with PayRouta's fee split off each payment | A subaccount API, a split on every transaction, and settlement reports |
| **PayRouta-held** | In PayRouta's master account with you | Only in countries where PayRouta is licensed to hold funds |
| **Merchant-owned** | In an account the merchant opens in their own name | A referral or hosted-onboarding API that PayRouta can pre-fill. The merchant contracts with you and you run your own KYC/KYB |

With split settlement, PayRouta can't hold a rolling reserve or schedule payouts, so these connections are offered only to lower-risk merchants.

## Merchant data you receive

On platform and split-settlement connections, PayRouta is the onboarding party. It collects from the merchant:

- business details, registered address and website
- each representative and each owner of 25% or more, with date of birth, home address and ID number where your country rules require them
- the payout bank account
- acceptance of PayRouta's merchant terms, which incorporate any terms your programme requires merchants to accept

PayRouta stores sensitive details encrypted and sends each programme only the fields its onboarding API needs, for the merchants being onboarded to it. Tell us during review which fields and documents your programme requires.

On merchant-owned connections, you receive only the fields listed for your programme, with the merchant's explicit consent. Your own onboarding collects identity documents and bank details.

## Connecting technically

- **Payments.** Implement the PayRouta Provider API (`docs/provider-api.md`, with OpenAPI in `docs/provider-api.openapi.yaml`), or map your existing API in the workspace. Then declare your capabilities: method, country, currency, operation and limits.
- **Sub-merchant onboarding.** For platform and split-settlement connections, PayRouta builds a platform module for your sub-merchant API. It covers account creation, status checks, translating outstanding requirements into requests in the merchant's PayRouta dashboard, payouts and webhooks.
- **Merchant-owned accounts.** PayRouta builds a partner module for your referral or hosted-onboarding API. It covers the application, status mapping and verified account webhooks.

## Fees

Who pays your processing fees depends on the connection model. It is set out in your commercial terms with PayRouta, either charged to PayRouta's platform account or to each merchant's subaccount. PayRouta's own fee is withheld from each payment or split off it, never converted between currencies.

## Certification

Certification exercises only what you declare:

- payment creation
- idempotent retry
- status lookup
- webhooks
- cancellation, refunds and settlement reporting, where declared
- sub-merchant onboarding, payouts and reconciliation, for platform and split-settlement connections

A capability becomes routable only after certification, review and publication. A production connection is enabled only after its sandbox twin has qualified.

## Staying live

Your compliance documents and credentials must stay current, and your health checks must pass. PayRouta monitors health and availability continuously. An unhealthy capability stops receiving traffic and payments go to another processor until it recovers.

## Native payment integration coverage

See [the complete implementation inventory](provider-coverage.md) for all 41 directory entries, current adapter configuration, evidence handling and explicit remaining scope. New adapter code is not live qualification.
