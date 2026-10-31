# PayRouta documentation

> Stablecoins and crypto from any wallet are open to every merchant. Cards, digital wallets, bank transfers and mobile money open once your payments account is activated. Paying from exchange apps is coming. Sandbox stablecoin payments use real testnet tokens. See [Crypto wallet payments](crypto-payments.md).

PayRouta is one checkout button for every way the world pays, including credit. Add it to any site or app (or use the Shopify and WooCommerce integrations), and customers pay by card, digital wallet, bank transfer, mobile money, USSD, [credit from a licensed lender](credit.md), or stablecoins and crypto from [any wallet and chain](cross-chain.md). Start with the [checkout button](checkout-button.md).

Behind the button, merchants apply once to PayRouta, which verifies them and sets up processing with its regulated payment partners behind the scenes. PayRouta then routes each payment to a partner that can take it, keeps a backup for the same method, and reconciles the results in one place.

PayRouta never holds merchant or customer funds in its own bank accounts. Payments are processed by PayRouta's regulated processing partners, which hold each merchant's balance (or pay the merchant's bank directly) until PayRouta pays the merchant out on its schedule. Merchants can also connect payment accounts in their own name, which settle to them directly. Stablecoin payments go straight to the merchant's own wallet.

## How it fits together

```
Merchant ──(one application)──► PayRouta ──► Provider A account  (owned by the merchant)
                                          └─► Provider B account  (owned by the merchant)

Customer ──► PayRouta checkout ──► method the customer chose ──► one of the merchant's providers
                                                               └─► backup provider, same method
Provider ──(settlement to the merchant's own destination)──► Merchant
PayRouta ──(status, reconciliation, signed webhooks)──────────► Merchant
```

1. **Provider accounts.** You save one business profile in the dashboard and choose providers. PayRouta screens your business, then pre-fills each provider's application with only the fields that provider needs. You finish each provider's own onboarding, and the account belongs to you. See [Provider accounts](provider-accounts.md).
2. **Payment intents.** Your server creates an intent: the amount, the asset, which methods you accept, and where to return the customer. See [Payment intents](payment-intents.md).
3. **Checkout.** You create a checkout session and redirect the customer. PayRouta shows only the methods that can complete this payment right now, and the customer chooses one.
4. **Routing.** PayRouta routes to an eligible provider for that method. If that provider rejects the payment before it starts, PayRouta can try another provider for the **same** method. It never switches the customer to a different method.
5. **Status and settlement.** You receive signed webhooks. Confirmation and settlement are tracked as separate facts. See [Settlement](settlement.md).

## What PayRouta does not do

- Hold funds, act as merchant of record, or pay out to you. Your providers do.
- Calculate or remit sales tax or VAT. That stays with you, or with a merchant-of-record provider if you choose one.
- Ask customers for identity documents at checkout. Providers run their own checks.
- Collect your identity-document numbers or bank details. Each provider collects them on its own pages.

## Where to start

- [Checkout button](checkout-button.md): one button, every method.
- [Quickstart](quickstart.md): a sandbox payment in a few steps.
- [Pay with credit](credit.md): instalments from licensed lenders; you are paid in full.
- [API reference](api-reference.md): every endpoint, field and scope.
- [Webhooks](webhooks.md): verifying and processing events.
- [Errors and recovery](errors.md): what each error means and when it is safe to retry.
