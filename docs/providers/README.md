# Payment Providers Directory

PayRouta connects merchants to payment providers across fiat rails, local banking schemes, mobile money, digital wallets, and blockchain networks through accounts that **you own directly**.

Every provider available through PayRouta meets our five non-negotiable principles:
1. **Direct Contracting**: You contract directly with the provider; PayRouta is never a payment facilitator or merchant-of-record.
2. **Merchant-Held Credentials**: You hold your own login and API credentials.
3. **Isolated Liability**: You or the provider bear chargebacks and losses, never PayRouta.
4. **Direct Settlement**: Funds settle straight from the provider to your designated bank account or wallet.
5. **Portability**: You keep your provider account if you leave PayRouta.

---

## Provider Categories

Explore provider guides, integration options, and failover behavior organized by category:

| Category | Typical Methods & Rails | Example Providers |
| --- | --- | --- |
| [**Stablecoins**](providers/stablecoins/README.md) | Native on-chain USDC, USDT, EURC on Base & Ethereum | [USDC (Circle)](providers/stablecoins/usdc.md), [USDT](providers/stablecoins/usdt.md), [EURC](providers/stablecoins/eurc.md) |
| [**Cards & Global Schemes**](providers/cards/README.md) | Visa, Mastercard, American Express with 3DS2 | [Stripe](providers/cards/stripe.md), [Visa Direct](providers/cards/visa.md), [Mastercard](providers/cards/mastercard.md) |
| [**Bank Transfer & Fast Rails**](providers/bank-transfer/README.md) | NIP, SEPA Instant, FedNow/RTP, Pix, Instant A2A | [Paystack](providers/bank-transfer/paystack.md), [Flutterwave](providers/bank-transfer/flutterwave.md), [Monnify](providers/bank-transfer/monnify.md), [SEPA](providers/bank-transfer/sepa.md), [ACH/FedNow](providers/bank-transfer/ach.md), [Pix](providers/bank-transfer/pix.md) |
| [**Digital Wallets**](providers/digital-wallets/README.md) | 1-tap biometric wallets, global & regional super-apps | [Apple Pay](providers/digital-wallets/apple-pay.md), [Google Pay](providers/digital-wallets/google-pay.md), [PayPal](providers/digital-wallets/paypal.md), [Alipay](providers/digital-wallets/alipay.md), [WeChat Pay](providers/digital-wallets/wechat-pay.md), [GrabPay](providers/digital-wallets/grabpay.md), [GCash](providers/digital-wallets/gcash.md), [Mercado Pago](providers/digital-wallets/mercado-pago.md), [PhonePe](providers/digital-wallets/phonepe.md), [PayPay](providers/digital-wallets/paypay.md), [Revolut Pay](providers/digital-wallets/revolut-pay.md), [Cash App](providers/digital-wallets/cash-app.md), [OPay](providers/digital-wallets/opay.md), [PalmPay](providers/digital-wallets/palmpay.md), [Chipper Cash](providers/digital-wallets/chipper-cash.md) |
| [**Mobile Money**](providers/mobile-money/README.md) | Telecom SIM toolkit (STK Push) and USSD prompts | [Safaricom M-Pesa](providers/mobile-money/mpesa.md), [MTN MoMo](providers/mobile-money/mtn-momo.md), [Airtel Money](providers/mobile-money/airtel-money.md) |
| [**Crypto Apps**](providers/crypto-apps/README.md) | Off-chain exchange-held balance checkouts | [Binance Pay](providers/crypto-apps/binance-pay.md), [Coinbase Commerce](providers/crypto-apps/coinbase-commerce.md) |
| [**Real-World Assets (RWA)**](providers/real-world-assets/README.md) | Tokenized short-term US Treasury and yield notes | [Ondo USDY](providers/real-world-assets/ondo-usdy.md) |
| [**Buy Now, Pay Later (BNPL)**](providers/bnpl/README.md) | Split in 4, Pay in 30 days, monthly financing | [Klarna](providers/bnpl/klarna.md), [Affirm](providers/bnpl/affirm.md) |

---

## Same-Method Failover

PayRouta executes **same-method failover**. When a customer selects a method at checkout (for example, *Bank Transfer* in Nigeria or *Stablecoin* on Base), PayRouta ranks all of your approved providers that support that exact method and currency. If the primary provider times out or experiences an outage, PayRouta automatically reroutes to your backup provider for that **same method** before the customer experiences a failure.

A payment selected as *Card* is never converted to *Bank Transfer*, and a *Stablecoin* payment is never converted to *Fiat*. Customer intent is immutable.

---

## Integration Modes

Providers connect to PayRouta via one of three integration modes:
- **`NATIVE`**: PayRouta maintains the provider-specific adapter according to normalized contracts (e.g., Paystack, Flutterwave, Monnify, Stripe Connect).
- **`STANDARD`**: The provider implements the PayRouta Provider API (`docs/provider-api.md`).
- **`CONFIGURABLE`**: Declarative mapping of a provider's existing REST API via the Provider Portal with zero custom code deployment.
