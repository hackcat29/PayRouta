# Provider integration coverage

## Inventory checked against the directory

**41 guides / 8 directory categories / 40 payment-related guides / 1 excluded RWA reference.** The merchant contract accepts **9 normalized categories**. The tenth taxonomy entry, cash/voucher, has no implemented merchant request flow.

| Directory category | Guides |
| --- | ---: |
| Stablecoins | 3 |
| Cards | 3 |
| Bank transfer | 6 |
| Digital wallets | 21 |
| Mobile money | 3 |
| Crypto apps | 2 |
| BNPL | 2 |
| Real-world assets (excluded) | 1 |

The rows below describe code coverage, including partial/legacy paths. **They do not certify live processing.** There are thirteen registered native modules plus the three original Monnify, Paystack and Flutterwave implementations. Merchant-owned partner integrations remain distinct. Of the 40 payment-related guides, 38 now map to at least one execution path; PalmPay and Chipper Cash still require verified API contracts. This is partial code coverage, not a count of fully integrated or live-qualified methods.

| Guide | Category | Adapter code | Remaining scope / prerequisites |
| --- | --- | --- | --- |
| [stablecoins/usdc](providers/stablecoins/usdc.md) | stablecoin | erc20-deposit | Direct Ethereum/Base deposits; official Sepolia testnets only in sandbox. Address pool, RPC and production review required. |
| [stablecoins/usdt](providers/stablecoins/usdt.md) | stablecoin | erc20-deposit | Direct Ethereum mainnet only; no fabricated test USDT. Production review required; other networks remain unsupported. |
| [stablecoins/eurc](providers/stablecoins/eurc.md) | stablecoin | erc20-deposit | Direct Ethereum/Base deposits; official Sepolia testnets only in sandbox. Address pool, RPC and production review required. |
| [cards/visa](providers/cards/visa.md) | card | stripe, adyen, paystack, flutterwave | Card scheme, not a separate acquiring API. |
| [cards/mastercard](providers/cards/mastercard.md) | card | stripe, adyen, paystack, flutterwave | Card scheme, not a separate acquiring API. |
| [bank-transfer/paystack](providers/bank-transfer/paystack.md) | bank-transfer | paystack | Enable this method on an eligible merchant account and qualify it. |
| [bank-transfer/flutterwave](providers/bank-transfer/flutterwave.md) | bank-transfer | flutterwave | Enable this method on an eligible merchant account and qualify it. |
| [bank-transfer/monnify](providers/bank-transfer/monnify.md) | bank-transfer | monnify | NGN hosted card/transfer instructions and authenticated query receipts. Merchant contract, real payer fields and qualification required. |
| [bank-transfer/sepa](providers/bank-transfer/sepa.md) | direct-debit | stripe, adyen | Stripe hosted EUR credit transfers and SEPA debit; Adyen SEPA debit. Requires existing Stripe customer. No instant-transfer guarantee. |
| [bank-transfer/ach](providers/bank-transfer/ach.md) | direct-debit | stripe | Stripe hosted USD bank credit transfers (ACH/wire) and ACH debit. Requires existing Stripe customer. Payout, FedNow and RTP remain unimplemented. |
| [bank-transfer/pix](providers/bank-transfer/pix.md) | bank-transfer | stripe, adyen | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/apple-pay](providers/digital-wallets/apple-pay.md) | digital-wallet | adyen | Enable provider wallet certificate/domain configuration. |
| [digital-wallets/google-pay](providers/digital-wallets/google-pay.md) | digital-wallet | adyen | Enable provider wallet/domain configuration. |
| [digital-wallets/paypal](providers/digital-wallets/paypal.md) | digital-wallet | paypal, stripe, adyen | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/alipay](providers/digital-wallets/alipay.md) | digital-wallet | stripe, adyen | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/wechat-pay](providers/digital-wallets/wechat-pay.md) | digital-wallet | stripe, adyen | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/grabpay](providers/digital-wallets/grabpay.md) | digital-wallet | stripe, adyen, xendit | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/gcash](providers/digital-wallets/gcash.md) | digital-wallet | adyen, xendit | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/shopeepay](providers/digital-wallets/shopeepay.md) | digital-wallet | xendit | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/phonepe](providers/digital-wallets/phonepe.md) | bank-transfer | phonepe | UPI checkout can use PhonePe or another UPI app; wallet-balance debit is not implemented. |
| [digital-wallets/paytm](providers/digital-wallets/paytm.md) | digital-wallet | adyen | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/mercado-pago](providers/digital-wallets/mercado-pago.md) | digital-wallet | mercado-pago | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/picpay](providers/digital-wallets/picpay.md) | digital-wallet | picpay | Merchant supplies provider-required customer and device fields. |
| [digital-wallets/paypay](providers/digital-wallets/paypay.md) | digital-wallet | paypay, adyen, stripe | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/kakaopay](providers/digital-wallets/kakaopay.md) | digital-wallet | adyen | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/revolut-pay](providers/digital-wallets/revolut-pay.md) | digital-wallet | stripe | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/wero](providers/digital-wallets/wero.md) | digital-wallet | adyen | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/cash-app](providers/digital-wallets/cash-app.md) | digital-wallet | stripe, adyen | Enable this method on an eligible merchant account and qualify it. |
| [digital-wallets/venmo](providers/digital-wallets/venmo.md) | digital-wallet | paypal-venmo | US/USD only; approved PayPal merchant credentials, eligible Venmo SDK device and authentic capture qualification required. |
| [digital-wallets/opay](providers/digital-wallets/opay.md) | digital-wallet | opay | NGN OPay wallet QR and signed status polling; approved Nigerian merchant account and sandbox qualification required. |
| [digital-wallets/palmpay](providers/digital-wallets/palmpay.md) | digital-wallet | None | Requires merchant/aggregator contract, authenticated API and method-specific receipt fixtures. |
| [digital-wallets/chipper-cash](providers/digital-wallets/chipper-cash.md) | digital-wallet | None | Requires partner API contract and credentials. |
| [mobile-money/mpesa](providers/mobile-money/mpesa.md) | mobile-money | flutterwave | KES M-Pesa through Flutterwave; direct Daraja receipt/callback integration is not implemented. |
| [mobile-money/mtn-momo](providers/mobile-money/mtn-momo.md) | mobile-money | mtn-momo, paystack, flutterwave | Enable this method on an eligible merchant account and qualify it. |
| [mobile-money/airtel-money](providers/mobile-money/airtel-money.md) | mobile-money | flutterwave | Supported local mobile-money checkout through Flutterwave; direct Airtel API requires approved portal access. |
| [crypto-apps/binance-pay](providers/crypto-apps/binance-pay.md) | crypto-app | binance-pay | No published public sandbox; no activation until an approved merchant contract and qualification path exist. |
| [crypto-apps/coinbase-commerce](providers/crypto-apps/coinbase-commerce.md) | crypto-app | coinbase-business | Replaced legacy Commerce with Coinbase Business Checkout; Base USDC only. |
| [bnpl/klarna](providers/bnpl/klarna.md) | bnpl | stripe, adyen | Enable this method on an eligible merchant account and qualify it. |
| [bnpl/affirm](providers/bnpl/affirm.md) | bnpl | stripe, adyen | Enable this method on an eligible merchant account and qualify it. |
| [real-world-assets/ondo-usdy](providers/real-world-assets/ondo-usdy.md) | Excluded RWA | None | Reference only; explicitly excluded from the current product. |

## Native configuration

Store immutable integration configuration with `mode: "NATIVE"`, `adapter`, `environment: "sandbox" | "production"`, and the schema-specific fields below. Defaults: `maintainedBy: "PAYROUTA"`, `timeoutMs: 8000` (500–15000). All credentials are secret-store references, resolved server-side. Register/approve capabilities, account permissions, currencies/countries, economics and authentic observations through the existing operator review. Configuration alone returns Unknown health and never advertises a live route. The generic provider-portal form and simulator certification suite do not automatically provision/qualify new native modules.

| Adapter | Required configuration |
| --- | --- |
| `stripe` | `secretKeyRef`, `returnUrl`, `cancelUrl`, `enabledPaymentTypes`; optional merchant-owned `accountId`, `euBankTransferCountry` (DE/FR/IE/NL, default DE) |
| `erc20-deposit` | Encrypted `rpcKeyRef` (Alchemy) or fixed `publicRpc`; registered EVM network/token, merchant-owned receive address pool and durable deposit store |
| `solana-deposit` | Registered SPL mint and Solana environment; owner receive-address pool, encrypted RPC reference or fixed public RPC, durable store |
| `stellar-deposit` | Registered classic code/issuer and Stellar network; funded authorized receive trustlines, encrypted RPC reference or fixed public RPC, durable store |
| `paypal-venmo` | `clientIdRef`, `clientSecretRef`, exact `merchantId`, `merchantCountry: "US"`, `venmoApproved: true`; USD only |
| `opay` | Nigerian `merchantId`, `secretKeyRef`; NGN wallet QR only |
| `monnify` | `apiKeyRef`, `secretKeyRef`, `contractCode`, `returnUrl`; environment pins sandbox/live origin; NGN card or transfer only |
| `adyen` | `apiKeyRef`, `merchantAccount`, pinned `baseUrl`, `returnUrl`, `countryCode`, `enabledPaymentTypes`; `webhookSecretRef` required to recognize captured funds |
| `mtn-momo` | `apiUserRef`, `apiKeyRef`, `subscriptionKeyRef`, `targetEnvironment`, `currency` |
| `phonepe` | `clientIdRef`, `clientSecretRef`, `clientVersion`, `merchantId`, `returnUrl`, `enabledModes` |
| `paypay` | `apiKeyRef`, `secretKeyRef`, `merchantId`, `returnUrl`; JPY only |
| `xendit` | `secretKeyRef`, `currency`, `returnUrl`, `cancelUrl`, `enabledWallets`; eligible IDR/PHP/THB wallet channels |
| `mercado-pago` | `accessTokenRef`, `collectorId`, `currency`, `returnUrl`, `cancelUrl`; wallet login required |
| `picpay` | `clientIdRef`, `clientSecretRef`; BRL wallet QR only |
| `coinbase-business` | `keyIdRef`, `privateKeyRef` (ECDSA P-256), `returnUrl`, `cancelUrl`; Base USDC only |
| `binance-pay` | `certificateRef`, `secretKeyRef`, `currency`, `goodsType`, `goodsCategory`, `returnUrl`, `cancelUrl`; public sandbox unavailable, so sandbox configuration is refused |

Example (secret reference is a placeholder, not a credential):

```json
{
  "mode": "NATIVE",
  "adapter": "stripe",
  "environment": "sandbox",
  "secretKeyRef": "secret-store-stripe-test-reference",
  "returnUrl": "https://merchant.example/payment-return",
  "cancelUrl": "https://merchant.example/payment-cancel",
  "enabledPaymentTypes": ["card", "cashapp", "klarna", "sepa_debit", "us_bank_account", "pix"]
}
```

Stripe types: `card`, `alipay`, `wechat_pay`, `grabpay`, `cashapp`, `revolut_pay`, `paypay`, `paypal`, `klarna`, `affirm`, `sepa_debit`, `us_bank_account`, `customer_balance`, `pix`. Stripe's card Checkout may show Apple/Google Pay as card funding; a separately chosen digital-wallet Apple/Google Pay uses Adyen's explicit wallet types.

Adyen types: `scheme`, `applepay`, `googlepay`, `alipay`, `wechatpayWeb`, `gcash`, `grabpay_SG`, `grabpay_MY`, `kakaopay`, `cashapp`, `paypal`, `paypay`, `paytm`, `wero`, `klarna`, `affirm`, `pix`, `sepadirectdebit`. Test origin: `https://checkout-test.adyen.com`; production: your approved tenant's `https://<prefix>-checkout-live.adyenpayments.com`. These are declarations, not a promise every type is available for every currency/country/account.

PhonePe `enabledModes`: `CARD`, `UPI_INTENT`, `UPI_QR`, `NET_BANKING`. Bank-transfer checkout excludes cards. Xendit `enabledWallets`: `SHOPEEPAY`, `GCASH`, `GRABPAY`; the merchant account determines regional eligibility. Native adapters refuse other method categories, unsupported hints and wrong assets.

## Merchant inputs and customer actions

Amounts remain exact decimal strings. Fiat precision must match the currency exponent. No adapter substitutes invoice amounts for missing authenticated receipt amounts. No fiat/token conversion or different-network fallback occurs.

Optional metadata restrictions use guide IDs: `preferred_wallet: "apple-pay"`, `"cash-app"`, `"shopeepay"`, `"picpay"`, etc. Bank/debit `payment_rail` examples are `pix`, `ach`, `sepa`, `sepa-credit`, `us-bank-transfer`, `upi`, `net-banking`. Stripe credit transfers use `method: "bank-transfer"` and an enabled `customer_balance` type; `direct-debit` remains a separate selection. Credit transfer requires `metadata.stripe_customer_id` for an existing customer in the exact merchant/connected account. Stripe hosts the bank instructions and reconciles the incoming customer cash balance. EUR selects `eu_bank_transfer` with the configured IBAN country; USD selects `us_bank_transfer`, which permits ACH or wire. This does not certify a specific instantaneous or exclusive ACH rail. The hint must match an explicitly enabled provider type. Monnify requires real `payer_name`, `payer_email`, configured `returnUrl` and a merchant contract. Its hosted checkout is restricted to the selected card or account-transfer method; authentication and transaction queries replace invented account instructions. MTN requires digit-only international `payer_phone`. Paystack and Flutterwave require `payer_email` and operator `returnUrl`; Flutterwave also requires `paymentOptionsControlled: true` after confirming dashboard overrides do not replace requested payment options.

Adyen BNPL requires `metadata.order_lines`, a JSON string of line items with `id`, `description`, `quantity`, `amountIncludingTax` (integer minor units per item). The exact sum must equal the invoice. For example: `[{"id":"sku1","description":"Order","quantity":1,"amountIncludingTax":1234}]` for EUR 12.34. Merchant metadata retains the existing 200-character per-value limit.

PicPay requires merchant-supplied `payer_name`, `payer_email`, `payer_document_type` (CPF/CNPJ/PASSPORT), `payer_document`, `payer_phone_country`, `payer_phone_area`, `payer_phone_number`, `payer_ip`. No invented identity or phone data is sent. The provider's PNG QR and payment code are validated and displayed at checkout; customer identity is not collected by a new PayRouta checkout form.

Coinbase uses the exact registered Base USDC contract (`erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`, `network: "eip155:8453"`, precision 6). Sandbox Checkout uses `/sandbox/api/v1/checkouts`; production uses `/api/v1/checkouts`. This replaces the old Commerce charge API and HMAC webhook assumptions. Fulfillment waits for authenticated `COMPLETED` status.

Binance uses `method: "crypto-app"`, asset identifier `binance:<currency>`, network `binance:pay`, and up to 8 decimal places. This namespace describes the provider balance rail, not an ERC-20 token contract. USDT on Binance is not a direct Ethereum/Tron deposit integration. Live merchant API still permits only reviewed same-currency fiat scopes; crypto-app production therefore remains gated until a corresponding review model exists.

## Direct deposits, OPay and Venmo

Apply `20261006010000_direct_deposits` with the normal deployment migration step before using `erc20-deposit`. It was applied only to the local fictional database during implementation. PostgreSQL stores immutable attempt/address/start-block bindings and globally unique transfer claims. Receive addresses are consumed permanently, including expired checkouts, to prevent late transfers funding another invoice. Operators provision an address pool controlled by the merchant; no keys, custody, automatic address generation, signing or sweeping are implemented. Exhausted pools require operator replenishment.

Direct stablecoin checkout now covers Ethereum, Base, Arc, Avalanche, Arbitrum, Polygon, Solana and Stellar plus their registered test environments. The registry contains 31 exact token/network pairs: USDC on all eight networks, EURC on six, USDT on Ethereum/Avalanche/Solana. Sandbox has only issuer-listed USDC/EURC tokens. ERC-20/SPL precision is six; Stellar classic precision is seven. Customers choose merchant-quoted options before instructions exist; any attempt locks the choice. Mainnet is production-only and requires exact reviewed merchant scope, screening/evidence, country limits and fee valuation. There is no automatic conversion, bridging or token-parity assumption.

The backend verifies exact successful finalized EVM logs, SPL transfer/balance evidence or classic Stellar issuer/payment/closed-ledger evidence before confirmation. A durable global transaction/operation claim prevents invoice reuse. Detection alone does not settle or bill. Merchant deposits settle whole, with a separate platform bill and payer-paid network fees. Wallets sign their own payment; native server relay persists and verifies the exact signed message before broadcast. The MVP does not hold production merchant keys, sweep funds or sign refunds. Public RPC fallback is fixed, network-verified and bounded; ambiguous broadcasts never automatically switch endpoints. Consult the multichain implementation and launch checklists for the asset matrix, native account prerequisites, qualification evidence and capacity/retention boundaries.

OPay uses the public Nigerian international wallet API with `OpayWalletNgQR`. Requests and status queries sign their exact JSON bodies using HMAC-SHA512. Sandbox/live API origins are pinned. A provider-issued OPay QR URL is encoded locally as a PNG; customer scanning is not financial evidence. Authenticated `SUCCESS` status must match the merchant reference, provider order and exact NGN amount. Card fallback is not permitted.

Venmo uses the supported PayPal JS SDK v5 Venmo button with merchant-owned US credentials and explicit approval. Mobile app switching/desktop QR eligibility is decided by PayPal. Client approval requests a backend status refresh; only authenticated Orders v2 reads and idempotent server capture can confirm payment. Before capture, the backend checks Venmo funding, merchant identity, original order/reference, USD and the immutable invoice amount. Completed capture must be final and match the full order amount. Missing provider order IDs require inspection rather than a second order. The ordinary PayPal partner redirect rejects Venmo hints instead of substituting PayPal funding.

## Evidence and recovery

Adyen link completion indicates authorization, not capture. Configure Standard webhooks with successful **CAPTURE** events at `/api/payments/provider/<integrationId>` and a separate test/live HMAC secret. Each item is checked using Adyen's signed-field canonicalization and merchant account. Signed full capture amounts are matched to the immutable invoice; partial captures remain exceptions. Unsigned dates/link IDs cannot provide routing evidence. Inbox identities deduplicate capture PSP references and reject conflicting payloads. A missed capture webhook stays pending/needs inspection; this adapter does not invent capture from link completion.

Other added adapters use authenticated status polling. MTN, PhonePe, PayPay, PicPay and Binance recover with stable merchant request IDs. Stripe, Coinbase and Xendit creation responses supply provider IDs; if a timeout loses those IDs, inspect provider lookup/idempotency records before any new attempt. Mercado Pago searches by external reference and rejects ambiguous multiple receipts. Automatic external creation replay is disabled. No callback from an unverified mobile-money source changes state.

The simulator alone can create simulated settlement/report facts. External integrations require genuine imported settlement reports and allocations; payment confirmation does not imply settlement. Refunds, disputes, payouts, FedNow/RTP, direct Daraja/Airtel collection, other token networks and private PalmPay/Chipper contracts remain unimplemented. M-Pesa and Airtel retain their existing Flutterwave paths. Native onboarding and live account qualification remain operator work. Tests use injected HTTP transports and an official Adyen HMAC test vector; provider sandbox and live credential qualification remain operator work.

## Official API references checked

- [Stripe Checkout create API](https://docs.stripe.com/api/checkout/sessions/create)
- [Adyen Payment Links API](https://docs.adyen.com/api-explorer/Checkout/71/post/paymentLinks) and [supported Pay by Link methods](https://docs.adyen.com/unified-commerce/pay-by-link/supported-payment-methods)
- [Adyen HMAC verification](https://docs.adyen.com/development-resources/webhooks/secure-webhooks/verify-hmac-signatures)
- [MTN MoMo request-to-pay flow](https://momodeveloper.mtn.com/content/html_widgets/v98wn.html)
- [PhonePe official Standard Checkout SDK](https://github.com/PhonePe/phonepe-pg-sdk-python)
- [PayPay Dynamic QR API](https://www.paypay.ne.jp/opa/doc/v1.0/dynamicqrcode) and [authentication](https://www.paypay.ne.jp/opa/doc/v1.0/api_authorization.html)
- [Xendit official Invoice API SDK](https://github.com/xendit/xendit-node/tree/master/invoice) and [ShopeePay requirements](https://docs.xendit.co/docs/shopeepay-1)
- [Mercado Pago Wallet integration](https://www.mercadopago.com.br/developers/en/docs/checkout-api-payments/integration-configuration/integrate-mp-wallet)
- [PicPay wallet charge API](https://developers-business.picpay.com/checkout/en/docs/api/charge-wallet), [charge status](https://developers-business.picpay.com/checkout/en/docs/api/find-charge), [authentication](https://developers-business.picpay.com/checkout/en/docs/authentication)
- [Coinbase Business Checkout API](https://docs.cdp.coinbase.com/api-reference/business-api/rest-api/checkouts/introduction) and [sandbox](https://docs.cdp.coinbase.com/coinbase-business/checkout-apis/sandbox)
- [Binance Pay v3 orders](https://developers.binance.com/en/docs/products/binance-pay-merchant/api-order-create-v3) and [query](https://developers.binance.com/en/docs/products/binance-pay-merchant/api-order-query)

- [Circle USDC contracts](https://developers.circle.com/stablecoins/usdc-contract-addresses) and [EURC contracts](https://developers.circle.com/stablecoins/eurc-contract-addresses)
- [Tether supported protocols](https://tether.to/en/supported-protocols/)
- [Ethereum JSON-RPC finality, logs and receipts](https://ethereum.org/en/developers/docs/apis/json-rpc/)
- [OPay Nigerian wallet QR](https://documentation.opaycheckout.com/opay-wallet-payment) and [signed status queries](https://documentation.opaycheckout.com/query-payment-status)
- [PayPal Venmo v5 integration](https://developer.paypal.com/v5/venmo/integrate) and [SDK reference](https://developer.paypal.com/sdk/js/v1/reference)
- [Stripe bank transfers](https://docs.stripe.com/payments/bank-transfers)
- [Monnify hosted checkout](https://monnify-docs.playground.monnify.com/docs/collections/one-time-payments/checkout-api)
