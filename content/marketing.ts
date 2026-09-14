export const pages = {
  "provider-routing": {
    title: "Provider Routing",
    headline: "Route each payment through the best provider.",
    intro:
      "PayRouta finds eligible providers for the payment method your customer chose, then routes the transaction based on your fee and speed preferences.",
    sections: [
      [
        "Check eligibility before comparing providers",
        "Match the customer’s payment method against provider capabilities, currencies, limits, compliance requirements, and current operating status. A lower price does not make an ineligible provider suitable.",
      ],
      [
        "Compare providers within the selected method",
        "For instant bank payments (like iDEAL in Europe, FedNow in the US, Pix in Brazil, or NIP in Nigeria), compare domestic banking providers. For card payments, compare domestic and global acquirers (Visa, Mastercard, Verve, Cartes Bancaires, JCB). For digital wallets (like Apple Pay, Google Pay, OPay, PalmPay, or Alipay), route to supported wallet gateways. For crypto platforms (like Binance Pay), route through supported exchange APIs. For Real-World Assets (like Ondo USDY or tokenized commodities), route through supported asset providers. The customer’s payment choice stays fixed.",
      ],
      [
        "Apply your routing preference",
        "Rank providers by lowest fee, fastest settlement, or highest reliability. PayRouta compares providers only within the chosen method, without treating different payment methods as interchangeable.",
      ],
      [
        "Backup routes before charging",
        "If a primary provider is unavailable before a payment begins, PayRouta checks for another provider that supports the same method. If none is available, the customer is asked to choose another way to pay.",
      ],
      [
        "Check payment status before retrying",
        "A network timeout after submitting does not mean a payment failed. PayRouta verifies the authoritative status with the provider before allowing any retry, preventing accidental double charges.",
      ],
    ],
  },
  settlement: {
    title: "Settlement",
    headline: "Settlement is flexible — get paid in any available method you prefer.",
    intro:
      "Settlement is not fixed. How a customer pays and what a merchant receives are independent choices. You can accept payments in any local method worldwide and settle in any available method you prefer—whether local bank accounts, multi-currency balances, digital wallets, stablecoins, crypto exchange accounts, or Real-World Assets (RWAs).",
    sections: [
      [
        "Settlement is not fixed",
        "You are never locked into a single settlement method or restricted to what the customer paid with. Choose to be settled in any supported method available to your business: instant bank transfers, local clearing (ACH, SEPA), multi-currency accounts, stablecoins, crypto apps (like Binance Pay), or Real-World Assets (RWAs) like Ondo USDY and tokenized commodities.",
      ],
      [
        "Cross-border currency conversion",
        "Convert between currencies and assets (like USD, EUR, BRL, INR, and stablecoins) where licensed providers and liquidity exist. Conversion in one direction does not guarantee support for the reverse.",
      ],
      [
        "Payment confirmed vs. settlement complete",
        "A customer's payment is often confirmed immediately, while your settlement clears based on local banking hours, exchange rules, or blockchain confirmations. PayRouta keeps these two states clear.",
      ],
      [
        "Crypto exchange balances",
        "When customers pay using crypto apps or exchange balances, funds can settle instantly between accounts without network transfer fees, with options for auto-conversion to bank deposits.",
      ],
      [
        "Clear reconciliation",
        "Every transaction links payment confirmation, fees, and final settlement to a single reference, giving you a clear view of your revenue across all payment methods.",
      ],
    ],
  },
  "payment-flow": {
    title: "Payment Flow",
    headline: "From customer checkout to merchant settlement.",
    intro:
      "Create a payment intent. PayRouta checks which methods can work, the customer chooses how to pay, the transaction routes through an eligible provider, and funds settle to your account.",
    sections: [
      [
        "Create a payment intent",
        "Set the invoice amount, currency, accepted payment methods (such as cards, bank transfers, digital wallets, crypto apps, or cash vouchers), and your settlement preference.",
      ],
      [
        "Check what’s available",
        "PayRouta evaluates the customer’s country, currency, transaction size, and provider operating status to show only viable payment options.",
      ],
      [
        "Let the customer choose",
        "Customers pick the payment method they know and trust — whether that is iDEAL in the Netherlands, FedNow in the US, Pix in Brazil, PayNow in Singapore, Apple Pay, OPay or PalmPay in Nigeria, a domestic card scheme, or a crypto app.",
      ],
      [
        "Route to an eligible provider",
        "Compare providers that support the customer's chosen method, picking the one that best fits your priorities for cost, speed, or reliability.",
      ],
      [
        "Coordinate execution",
        "The selected provider processes the payment. If it becomes unavailable before starting, PayRouta can switch to a backup provider for that same method.",
      ],
      [
        "Track settlement",
        "Follow the payment from customer confirmation through to final settlement in any preferred available method—including your bank account, digital wallet, stablecoin balance, or Real-World Asset (RWA).",
      ],
    ],
  },
  merchants: {
    title: "For Merchants",
    headline: "Every way your customers pay. One integration.",
    intro:
      "Stop juggling dozens of separate payment gateways. Let your customers pay with their preferred local methods and receive funds in your chosen currency.",
    sections: [
      [
        "One integration for all 10 payment categories",
        "Accept instant bank transfers (such as iDEAL, FedNow, PayNow, Pix, and NIP), digital wallets (Apple Pay, Google Pay, OPay, PalmPay, Alipay), debit and credit cards (Visa, Mastercard, Verve, CB, JCB, RuPay), direct debits (ACH, SEPA, Bacs), cash vouchers (OXXO, Konbini, Boleto), buy now pay later installments (Klarna, Affirm, Tabby), mobile money (M-Pesa, MTN MoMo), stablecoins (USDC, USDT, EURC), crypto apps (Binance Pay), and Real-World Assets (RWAs like Ondo USDY) through one integration.",
      ],
      [
        "Higher checkout conversion",
        "When customers see the payment methods and currencies they use every day, they finish checkout instead of dropping off due to declined foreign cards.",
      ],
      [
        "Lower processing costs",
        "Route domestic payments through local bank systems and low-cost clearing networks rather than paying high international credit card fees.",
      ],
      [
        "Settlement in your preferred method",
        "Settlement is not fixed. Choose to receive funds in any available method you prefer—local bank accounts, multi-currency balances, stablecoins, crypto exchange balances, or Real-World Assets (RWAs) like Ondo USDY and tokenized commodities.",
      ],
    ],
  },
  providers: {
    title: "For Providers",
    headline: "Connect your payment services to global businesses.",
    intro:
      "Whether you process instant bank transfers, digital wallets, cards, direct debits, cash vouchers, installments, mobile money, stablecoins, crypto apps, or Real-World Assets (RWAs), connect your services to merchants on PayRouta.",
    sections: [
      [
        "Declare supported methods and corridors",
        "Publish your payment methods, supported countries, currencies, transaction limits, and settlement windows so PayRouta can route eligible transactions to you.",
      ],
      [
        "Crypto exchange checkouts",
        "Connect exchange payment services (like Binance Pay or Coinbase Commerce) so your users can spend account balances at global merchants.",
      ],
      [
        "Real-World Asset (RWA) integration",
        "Connect tokenized Real-World Assets (including Ondo USDY, tokenized commodities, and debt instruments) so customers can pay with them or merchants can settle in them.",
      ],
      [
        "Real-time availability and health",
        "Share real-time status, processing speed, and liquidity conditions so PayRouta routes transactions reliably.",
      ],
    ],
  },
  developers: {
    title: "Developers",
    headline: "One clean API for global payments.",
    intro:
      "Build once to accept instant bank transfers, digital wallets, cards, direct debits, cash vouchers, installments, mobile money, stablecoins, crypto apps, and Real-World Assets (RWAs) with simple, predictable interfaces.",
    sections: [
      [
        "Start with a payment intent",
        "Specify what’s owed, accepted payment methods, and where you want funds settled in one straightforward API call.",
      ],
      [
        "Discover available methods dynamically",
        "Ask PayRouta which payment methods can serve a customer based on their location and cart total, without maintaining complex country-by-country logic.",
      ],
      [
        "Reliable webhooks and idempotency",
        "Receive signed webhook events for payment confirmation and settlement completion, with built-in protection against duplicate notifications.",
      ],
      [
        "Honest status and safe retries",
        "Clear status codes, automatic pre-charge failover, and status verification endpoints make it easy to build reliable checkout flows.",
      ],
    ],
  },
  pricing: {
    title: "Pricing",
    headline: "Straightforward pricing shaped around your business.",
    intro:
      "Pricing depends on the payment methods you need, your target countries, transaction volume, and settlement preferences across all 10 payment categories—from domestic instant bank rails and digital wallets to cards, direct debit, cash vouchers, installments, mobile money, stablecoins, crypto apps, and RWAs.",
    sections: [
      [
        "Corridors and methods",
        "Save on processing fees by using low-cost domestic bank transfers (such as SEPA in Europe, FedNow in the US, Interac in Canada, or Pix in Brazil) instead of expensive cross-border card networks.",
      ],
      [
        "Crypto and direct payments",
        "Cut transaction fees further with direct crypto payments and low-cost stablecoins.",
      ],
      [
        "Real-World Asset (RWA) settlement",
        "Settle into supported tokenized Real-World Assets (such as yield-earning notes or commodities) to hold value in tokenized assets.",
      ],
    ],
  },
  about: {
    title: "About",
    headline: "Connecting the world’s payment systems.",
    intro:
      "PayRouta is building a universal payment network: enabling any merchant in any country to accept payments from anywhere in the world, using any payment method.",
    sections: [
      [
        "Unifying fragmented payment systems",
        "Payments grew around local banking habits, national rules, and regional apps. PayRouta connects these systems into one clean experience for businesses and their customers.",
      ],
      [
        "Every payment method in one place",
        "From instant bank transfers across every continent (including iDEAL, FedNow, Interac, Pix, UPI, PayNow, and NIP), domestic card schemes (Visa, Mastercard, Verve, Cartes Bancaires, JCB, UnionPay), and digital wallets (Apple Pay, Google Pay, OPay, PalmPay, Alipay, Cash App) to direct debit & wire transfers, cash vouchers (OXXO, Konbini, Boleto), buy now pay later & installments (Klarna, Affirm, Tabby), mobile money (M-Pesa, MTN MoMo), stablecoins, crypto apps, and Real-World Assets (RWAs), PayRouta lets you support them all through one integration.",
      ],
      [
        "Routing without custody",
        "PayRouta coordinates routing and transaction status. It does not hold customer deposits or act as a bank. Regulated payment providers, banks, and licensed partners handle the funds.",
      ],
    ],
  },
  "payment-methods": {
    title: "Payment Methods",
    headline: "Every way your customers pay. Anywhere in the world.",
    intro:
      "Instant bank transfers, digital wallets, debit & credit cards, direct debit & wire transfers, cash vouchers, installments & BNPL, mobile money, stablecoins, crypto apps & exchanges, and Real-World Assets (RWAs) — all supported through PayRouta.",
    sections: [],
  },
  "use-cases": {
    title: "Use Cases",
    headline: "One payment layer. Real business scenarios.",
    intro:
      "See how availability, customer choice, and provider routing work across global commerce. These examples illustrate how the platform handles different payment needs.",
    sections: [],
  },
} as const;
export type PageSlug = keyof typeof pages;
export const methodContent = [
  {
    name: "Instant bank transfers",
    group: "Instant & A2A",
    icon: "Zap",
    examples:
      "iDEAL (Europe) · FedNow / RTP (US) · Interac (Canada) · Pix (Brazil) · UPI (India) · PayNow (Singapore) · NIP & Bank USSD (Nigeria) · Blik (Poland)",
    copy: "Real-time account-to-account bank transfers across Europe, North America, Latin America, Asia, and Africa. Customers authorize directly in their banking app, scan a QR code, or dial offline Bank USSD shortcodes, moving funds directly from their account in seconds.",
    consideration:
      "Requires an eligible local banking provider or aggregator in that country.",
  },
  {
    name: "Digital wallets",
    group: "Instant & A2A",
    icon: "Wallet",
    examples:
      "Apple Pay · Google Pay · PayPal · Cash App · OPay (Nigeria) · PalmPay (Nigeria) · Alipay & WeChat Pay (China) · PayPay (Japan) · GCash · Mercado Pago",
    copy: "One-tap checkout from phones, browsers, and mobile apps. Customers pay using stored cards, linked bank accounts, or wallet balances (such as Apple Pay, Google Pay, PayPal, Cash App, OPay, PalmPay, and Alipay).",
    consideration:
      "Availability depends on the customer’s device, regional wallet support, and account rules.",
  },
  {
    name: "Debit & credit cards",
    group: "Traditional",
    icon: "CreditCard",
    examples: "Visa · Mastercard · Amex · Cartes Bancaires (France) · UnionPay (China) · JCB (Japan) · RuPay (India) · Elo (Brazil) · Verve (Africa)",
    copy: "International and domestic card networks across online e-commerce and in-person Point-of-Sale (POS) terminals or SoftPOS (Tap-to-Phone). Local card schemes often have much higher approval rates than cross-border cards.",
    consideration:
      "Provider comparison happens after the customer chooses card payment.",
  },
  {
    name: "Direct debit & wire",
    group: "Traditional",
    icon: "Landmark",
    examples: "ACH Direct Debit (US) · SEPA Direct Debit (Europe) · Bacs (UK) · Pre-Authorized Debits (Canada) · Fedwire · SWIFT",
    copy: "Traditional bank payments and recurring bank debits for subscriptions, recurring bills, and large invoices. Unlike instant transfers, these clear through standard banking batch windows over 1 to 3 business days.",
    consideration:
      "Clearing times follow domestic banking cutoffs and processing windows.",
  },
  {
    name: "Cash vouchers",
    group: "Local methods",
    icon: "Receipt",
    examples:
      "OXXO (Mexico) · Boleto (Brazil) · Konbini (Japan) · Paysafecard (Europe) · Moniepoint & Baxi POS Agents (Nigeria) · PayNearMe (US)",
    copy: "Customers generate a barcode online or visit neighborhood agency banking counters and POS agent terminals to pay with physical cash.",
    consideration:
      "Payment confirms only after the customer physically hands over cash at a local store or POS agent counter.",
  },
  {
    name: "Installments & BNPL",
    group: "Local methods",
    icon: "CalendarClock",
    examples: "Klarna (Europe) · Affirm (US) · Afterpay (Australia/US) · Local card installments (Brazil, Mexico, Argentina)",
    copy: "Split payments and pay-later options. The merchant gets paid upfront, while the financing provider handles customer installments.",
    consideration:
      "Eligibility depends on the customer’s credit check and order size.",
  },
  {
    name: "Mobile money",
    group: "Local methods",
    icon: "Smartphone",
    examples: "M-Pesa · MTN MoMo · Airtel Money · Telco USSD (*334#, *671#) · Phone bill charging",
    copy: "Customers pay using phone balances or mobile carrier accounts via SIM Toolkit (STK Push) or offline USSD shortcodes, widely used across Africa and parts of Asia.",
    consideration:
      "Depends on local telecom network uptime and phone account limits.",
  },
  {
    name: "Stablecoins",
    group: "Digital assets",
    icon: "Coins",
    examples: "Circle USDC (Avalanche · Base · Solana · Ethereum · Polygon · Arbitrum) · EURC",
    copy: "Fast, low-cost digital dollar transfers with Circle USDC across supported blockchains (including Avalanche, Base, Solana, and Ethereum). Settle directly in USDC or convert to local bank currency.",
    consideration:
      "Requires matching the supported blockchain network and exchange compliance checks.",
  },
  {
    name: "Crypto apps & exchanges",
    group: "Digital assets",
    icon: "QrCode",
    examples: "Binance Pay · Coinbase Commerce · Gate Pay · OKX Pay",
    copy: "Lets customers pay directly using balances they already keep on crypto platforms and exchanges, like Binance Pay or Coinbase Commerce.",
    consideration:
      "Uses the exchange’s merchant checkout service and account rules.",
  },
  {
    name: "Real-World Assets (RWAs)",
    group: "Digital assets",
    icon: "TrendingUp",
    examples: "Ondo USDY · Paxos Gold (PAXG) · Franklin Templeton BENJI · Tokenized T-Bills",
    copy: "Enables customers to pay using supported tokenized real-world assets—including treasury notes, yield assets, and tokenized commodities—while allowing merchants to settle in them or convert to bank currency.",
    consideration:
      "Requires provider and network support for the specific tokenized asset.",
  },
];
export const useCases = [
  {
    title: "Local payments for an online merchant",
    need: "Customers want familiar payment options at checkout.",
    choice: "The customer selects an available local bank payment.",
    route:
      "Compare eligible bank-payment providers for that invoice and context.",
    outcome:
      "The merchant follows payment confirmation and local-currency settlement separately.",
    benefit:
      "A shared integration normalizes provider differences and status updates.",
  },
  {
    title: "Digital wallets and super-apps across regions",
    need: "An international merchant wants high conversion through mobile wallets and local super-apps.",
    choice:
      "Customers choose their everyday digital wallet—such as Apple Pay or Google Pay in the US and Europe, OPay or PalmPay in Nigeria, Alipay or WeChat Pay in China, or Mercado Pago in Latin America.",
    route:
      "Routes directly through the recognized wallet gateway or local wallet aggregator for that region.",
    outcome:
      "The payment confirms immediately via one biometric tap or QR code scan.",
    benefit:
      "Lets shoppers check out with the mobile wallet apps they already use daily, without typing card numbers.",
  },
  {
    title: "Stablecoin pay-in, local currency settlement",
    need: "A customer wants to pay with USDC while a merchant prefers local bank currency.",
    choice:
      "The customer selects USDC if the asset, network, and conversion path are available.",
    route:
      "Connects customer pay-in, currency conversion, and local bank payout.",
    outcome:
      "The merchant receives local currency in their bank account.",
    benefit: "Pay-in and settlement currencies are handled independently.",
  },
  {
    title: "Automatic backup providers",
    need: "A merchant wants alternatives when a provider cannot process a payment.",
    choice:
      "The customer chose bank transfer and that choice stays fixed.",
    route:
      "Before charging, an unavailable provider is skipped and another bank-transfer provider is used.",
    outcome:
      "If none is available, the customer is asked to choose another method. Unfinished charges are verified first.",
    benefit:
      "Built-in backups reduce failed checkouts without changing how the customer pays.",
  },
  {
    title: "Instant account-to-account payments worldwide",
    need: "An online merchant wants to accept domestic bank payments across North America, Europe, Asia, and Latin America (such as iDEAL in the Netherlands, FedNow in the US, Interac in Canada, or Pix in Brazil) without foreign card declines.",
    choice:
      "The customer selects their domestic bank method and confirms the payment in their banking app or via instant QR code.",
    route:
      "Routes through an eligible domestic bank rail or clearing partner in that jurisdiction.",
    outcome:
      "The payment confirms in seconds with direct bank clearing, settling into local currency, USD, or EUR.",
    benefit:
      "Accept dominant domestic bank payment methods across every continent without establishing separate foreign bank entities.",
  },
  {
    title: "Accepting crypto from apps and exchanges",
    need: "A digital service wants to let users pay from their balances on crypto exchanges.",
    choice:
      "The customer selects a supported crypto app (like Binance Pay or Coinbase Commerce) and confirms on their phone.",
    route:
      "Verifies the transfer directly with the exchange checkout service.",
    outcome:
      "Payment is confirmed immediately; the merchant can receive local bank currency or stablecoins.",
    benefit:
      "Allows customers to spend exchange balances without paying blockchain network fees.",
  },
  {
    title: "Paying and settling with Real-World Assets (RWAs)",
    need: "A business wants to accept tokenized Real-World Assets from buyers and choose whether to hold them or convert to cash.",
    choice:
      "The customer pays using a supported RWA (such as Ondo USDY or tokenized gold).",
    route:
      "Verifies the tokenized asset transfer on-chain and applies merchant settlement preferences.",
    outcome:
      "The merchant is settled in their preferred available method—whether the asset directly, local bank currency, or stablecoins.",
    benefit:
      "Accepts payments from tokenized real-world assets without managing custom smart contracts.",
  },
  {
    title: "Cash vouchers at local stores",
    need: "An online store wants to reach customers who prefer paying with cash.",
    choice:
      "The customer gets a barcode for OXXO in Mexico, Boleto in Brazil, or a Konbini store in Japan.",
    route:
      "Tracks the pending voucher with regional retail payment networks.",
    outcome:
      "When the customer pays at a nearby convenience store, the order is automatically marked paid.",
    benefit:
      "Reaches shoppers who prefer paying in cash at local stores.",
  },
  {
    title: "Installments and local cards",
    need: "A retailer wants to increase sales by offering split monthly payments.",
    choice:
      "The customer chooses monthly installments via a local card (like RuPay or Parcelamento) or Klarna.",
    route:
      "Routes through local installment-capable card providers.",
    outcome:
      "The merchant gets paid in full upfront; the provider collects customer installments.",
    benefit:
      "Makes larger purchases more affordable for customers without merchant credit risk.",
  },
];
