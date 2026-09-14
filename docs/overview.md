# Overview

PayRouta is a global payment availability and intelligent routing platform. A merchant describes payment requirements, the engine determines viable payment methods and initiation channels, and the customer chooses how to pay. Provider comparison and smart execution follow that selection.

> [!NOTE]
> **Early access notice**: PayRouta interfaces, schemas, and SDKs are provisional concepts and subject to refinement. Examples illustrate integration patterns, not a final published contract.

---

## The core transaction lifecycle

```mermaid
graph LR
    A["1. Payment Intent"] --> B["2. Evaluate Availability"]
    B --> C["3. Customer Choice"]
    C --> D["4. Route Within Method"]
    D --> E["5. Confirm & Settle"]
```

1. **Create a payment intent**: Specify amount, invoice currency, accepted methods, and merchant settlement preferences.
2. **Evaluate availability**: Determine which payment rails and initiation channels can serve the payer and merchant in the current context.
3. **Customer selection**: The customer explicitly chooses their preferred available method (e.g., instant bank transfer, digital wallet, card, stablecoin).
4. **Intelligent routing**: Compare eligible direct providers strictly within the customer's selected method based on cost, latency, and reliability.
5. **Reconciliation & settlement**: Coordinate execution updates, webhook delivery, and decoupled merchant settlement.

---

## Core architectural principles

### 1. Customer choice stays explicit
A list of accepted methods is a merchant preference, not proof that every method is viable for every transaction. Present viable choices dynamically and let the customer decide. If a chosen method loses all eligible providers before execution, prompt the customer for reselection rather than silently switching rails.

### 2. Provider comparison follows selection
A bank transfer choice leads to bank comparison (e.g., Chase, GTBank, SEPA). A card choice compares domestic and international acquirers. A stablecoin selection compares blockchain finality and mint liquidity. Lower processing costs on an alternative rail never authorize altering customer intent.

### 3. Initiation channels vs. settlement rails
PayRouta separates how a payment is initiated from where funds settle:
- **Initiation channels**: Web browser, mobile apps (iOS/Android), dynamic QR codes, offline feature-phone **Bank USSD** (`*737#`), **Telco USSD** (`*334#`), and in-person **Point-of-Sale (POS) terminals** / SoftPOS.
- **Settlement rails**: The 10 fundamental clearing systems moving value globally.

### 4. Pre-execution failover remains strictly within method
If a primary banking or card provider is degraded prior to authorization, the routing engine fails over to secondary or tertiary providers supporting that same payment method. Failover never crosses method boundaries.

### 5. Decoupled pay-in and settlement
Merchants are never forced to settle in the customer's payment method or currency. Customers can pay in local bank transfers, cards, or stablecoins, while merchants receive settlement in corporate bank accounts, multi-currency treasury, Circle USDC, or tokenized Real-World Assets (RWAs).

---

## Supported settlement rails

| Rail Category | Global Examples | Initiation Channels | Typical Settlement |
| :--- | :--- | :--- | :--- |
| **Instant Bank Transfers** | Pix, UPI, FedNow, RTP, iDEAL, NIP, Faster Payments | Web, App, QR, Bank USSD (`*737#`) | Instant / Real-time |
| **Digital Wallets** | Apple Pay, Google Pay, PayPal, Cash App, OPay, PalmPay | Mobile App, 1-Tap Biometric, QR | Instant push |
| **Cards & Schemes** | Visa, Mastercard, Amex, RuPay, JCB, Elo, Cartes Bancaires | E-commerce, In-Person POS, SoftPOS | T+1 to T+2 batch |
| **Direct Debit & Wire** | ACH Direct Debit, SEPA SDD, Bacs, Fedwire, SWIFT | Batch mandate, Bank portal | 1–3 business days |
| **Cash Vouchers** | OXXO Pay, Boleto, Konbini, Moniepoint & Baxi POS | Retail barcode, Agent POS counter | Cash tender confirmation |
| **Installments (BNPL)** | Klarna, Affirm, Afterpay, Brazilian *Parcelamento* | Checkout widget, Card installment | Full merchant upfront |
| **Mobile Money** | M-Pesa, MTN MoMo, Airtel Money, Carrier Billing | STK Push, Telco USSD (`*334#`) | Instant |
| **Stablecoins** | Circle USDC (Avalanche, Base, Solana, Ethereum, Polygon) | Web3 wallet, Circle Mint, Direct transfer | Sub-second finality |
| **Crypto Apps** | Binance Pay, Coinbase Commerce, Gate Pay, OKX Pay | In-app transfer, Dynamic QR | Instant off-chain |
| **Real-World Assets** | Ondo USDY, Franklin Templeton BENJI, Paxos Gold (PAXG) | On-chain token transfer, Treasury vault | Real-time yield accrual |

---

## Shared terminology

| Term | Definition |
| :--- | :--- |
| **Payment Intent** | The merchant's requirements for a particular transaction (amount, currency, settlement preference). |
| **Availability** | Dynamic evaluation determining whether a rail can execute right now given payer context and limits. |
| **Selected Method** | The customer's explicit choice at checkout (e.g., Bank Transfer, Apple Pay, USDC). |
| **Eligible Provider** | An acquirer, bank, or gateway capable of executing the chosen method under current conditions. |
| **Pay-in** | The mechanism and currency used by the buyer to tender payment. |
| **Settlement** | The mechanism and currency received by the merchant, tracked separately from payment confirmation. |

---

## Next steps

* [Quickstart guide](quickstart.md) — Walk through the proposed integration flow in 5 minutes.
* [Payment Methods & Channels](payment-methods.md) — Explore the 10 rails and initiation channels.
* [Payment Intents](payment-intents.md) — Learn how to construct intent requests.
* [API Reference](api-reference.md) — Review proposed REST API schemas and parameters.
