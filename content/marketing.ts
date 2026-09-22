export const pages = {
  "provider-routing": {
    title: "Provider Routing",
    headline: "Use the right provider for the payment in front of you.",
    intro:
      "After a customer selects an available payment method, PayRouta compares only eligible providers for that method and uses an available route.",
    sections: [
      [
        "Compare providers after customer choice",
        "Customers decide how to pay first. Providers are never treated as interchangeable across different payment methods.",
      ],
      [
        "Check eligibility before comparing cost",
        "Each route must satisfy corridor, asset, amount, compliance, certification, credential, health, and operational checks. Ineligible providers are excluded before any comparison.",
      ],
      [
        "Balance cost with reliability",
        "PayRouta considers fees, confirmation speed, capacity, success history, and merchant policy. A lower fee does not rescue an ineligible route.",
      ],
      [
        "Keep a backup within the same method",
        "If the first provider cannot start the selected payment method, PayRouta can try another eligible provider for that same method.",
      ],
      [
        "Recheck status before retrying",
        "A timeout is not a rejection. PayRouta rechecks the provider-side status before deciding whether another request is safe.",
      ],
    ],
  },
  settlement: {
    title: "Settlement",
    headline: "Confirmation and settlement are separate facts.",
    intro:
      "A customer payment can be confirmed before the merchant receives funds. PayRouta records each state separately and reconciles provider settlement evidence.",
    sections: [
      [
        "Track confirmation separately from payment to the merchant",
        "Confirmation means the payer’s value was accepted. Settlement means the merchant allocation was completed by the provider.",
      ],
      [
        "Use the settlement path supported by the provider",
        "PayRouta does not invent exchange rates or move customer funds itself. Provider settlement evidence determines the final merchant record.",
      ],
      [
        "Reconcile every allocation",
        "Payments, fees, settlement references, journal entries, and provider reports are checked against one another. Mismatches become exceptions instead of silent balances.",
      ],
    ],
  },
  "payment-flow": {
    title: "Payment Flow",
    headline: "From customer checkout to merchant settlement.",
    intro:
      "Create an intent, show only methods that can work, let the customer choose, use an eligible provider, and reconcile settlement.",
    sections: [
      [
        "Create a payment intent",
        "State the amount, asset, accepted methods, settlement asset, and return destination.",
      ],
      [
        "Check eligible methods",
        "PayRouta checks transaction classification, compliance, certification, availability, cost, health, and merchant policy.",
      ],
      [
        "Let the customer choose",
        "Customers see only methods available for that transaction and choose the approach they trust.",
      ],
      [
        "Use an eligible provider",
        "PayRouta locks an eligible route for the selected method instead of exposing provider mechanics at checkout.",
      ],
      [
        "Execute carefully",
        "Dispatch is idempotent, uncertain states are rechecked, and retries never assume that an unknown payment failed.",
      ],
      [
        "Confirm and track settlement",
        "Normalize provider outcomes, record confirmation, process settlement evidence, and reconcile exceptions.",
      ],
    ],
  },
  merchants: {
    title: "For Merchants",
    headline: "Accept more payments. Lose fewer customers.",
    intro:
      "PayRouta connects your business to multiple payment providers and uses an available route when a customer pays. Integrate once and show customers the methods they already trust.",
    sections: [
      [
        "Integrate once",
        "Payment intents, checkout sessions, webhooks, settlements, and reconciliation use one merchant interface.",
      ],
      [
        "Show only methods that can work",
        "A customer never sees a payment method that failed eligibility, certification, compliance, or operational checks for that transaction.",
      ],
      [
        "Let the customer stay in control",
        "The selected method remains fixed while PayRouta handles provider comparison and same-method backup.",
      ],
      [
        "Follow money without provider jargon",
        "Merchants see payment status, settlement status, exceptions, and recent activity—not routing internals.",
      ],
    ],
  },
  providers: {
    title: "For Providers",
    headline: "Tell us what you process. Certification decides what can route.",
    intro:
      "Providers can register independently, declare payment methods and coverage, connect a sandbox integration, pass certification, and request review. Declaration alone never enables production routing.",
    sections: [
      [
        "Declare methods, countries, currencies, and operations",
        "Plain-language answers become structured capabilities for collection, payout, conversion, authorization, and settlement.",
      ],
      [
        "Choose a connection",
        "Use the PayRouta Standard, map an existing API declaratively, or ask about a native PayRouta-built integration.",
      ],
      [
        "Test and certify the integration",
        "Certification checks payment creation, status lookup, idempotency, webhooks, cancellation, refunds, payouts, settlement, and reports for the capabilities you declared.",
      ],
      [
        "Stay eligible through monitoring",
        "Approved capabilities still need current compliance evidence, valid credentials, acceptable health, and operational availability.",
      ],
    ],
  },
  developers: {
    title: "Developers",
    headline: "A predictable payment workflow.",
    intro:
      "Create intents, display evaluated methods, handle normalized outcomes, and reconcile settlement with signed events and idempotent requests.",
    sections: [
      [
        "Start with a payment intent",
        "Specify what is owed, which methods may be offered, and which settlement asset is expected.",
      ],
      [
        "Display evaluated methods",
        "Checkout receives only methods that can serve the transaction. Customers choose from that evaluated list.",
      ],
      [
        "Handle normalized payment states",
        "Providers return different statuses and errors. PayRouta normalizes confirmation, pending, action-required, rejected, and unknown states.",
      ],
      [
        "Reconcile signed updates",
        "Verify webhook signatures, deduplicate events, recheck uncertain outcomes, and match settlement allocations.",
      ],
    ],
  },
  pricing: {
    title: "Pricing",
    headline: "Straightforward pricing shaped around your business.",
    intro:
      "Discuss payment methods, countries, volume, provider arrangements, and settlement requirements before a pilot. There is no public fee schedule yet.",
    sections: [
      [
        "Corridors and methods",
        "Costs depend on the payment methods and provider arrangements that can serve each route.",
      ],
      [
        "Settlement and conversion",
        "Settlement timing, provider fees, and any regulated conversion path are confirmed commercially.",
      ],
      [
        "What to include",
        "Share methods, corridors, expected volume, settlement needs, and support requirements. Never send account credentials or customer financial data.",
      ],
    ],
  },
  about: {
    title: "About",
    headline: "A payment network ordinary businesses can use.",
    intro:
      "PayRouta hides provider complexity from merchants and customers while retaining explicit eligibility, availability, execution, settlement, and reconciliation controls.",
    sections: [
      [
        "Customer choice",
        "Customers decide how to pay. Routing respects that decision.",
      ],
      [
        "Explicit eligibility",
        "Compliance, certification, credentials, health, and operational checks decide which methods and routes are available.",
      ],
      [
        "No custody claims",
        "PayRouta coordinates routing and transaction status. Regulated providers handle the movement and settlement of funds.",
      ],
    ],
  },
  "payment-methods": {
    title: "Payment Methods",
    headline: "One schema for familiar payment categories.",
    intro:
      "PayRouta normalizes payment methods, providers, rails, and execution adapters. The methods shown at checkout still depend on certified providers and the payment context.",
    sections: [],
  },
  "use-cases": {
    title: "Use Cases",
    headline: "One payment layer. Real business scenarios.",
    intro:
      "These examples explain how availability, customer choice, provider comparison, execution, and reconciliation fit together.",
    sections: [],
  },
} as const;
export type PageSlug = keyof typeof pages;
export const methodContent = [
  {
    name: "Bank transfers",
    group: "Instant & A2A",
    icon: "Zap",
    examples: "Domestic instant rails · Bank-authorized transfers",
    copy: "Customers move money directly from a bank account and authorize the payment through their own banking flow.",
    consideration:
      "Only certified bank-transfer providers and corridors can serve a given transaction.",
  },
  {
    name: "Cards",
    group: "Traditional",
    icon: "CreditCard",
    examples: "Global and domestic card networks",
    copy: "Customers pay by card and complete whatever authorization their issuer or wallet requires.",
    consideration:
      "Provider comparison happens only after the customer selects cards.",
  },
  {
    name: "Mobile money",
    group: "Local methods",
    icon: "Smartphone",
    examples: "Carrier wallets · Phone-balance payments",
    copy: "Customers approve a payment using a mobile-money account or phone prompt.",
    consideration:
      "Limits and prompts depend on the mobile-money provider and account.",
  },
  {
    name: "Digital wallets",
    group: "Instant & A2A",
    icon: "Wallet",
    examples: "Browser and app wallets",
    copy: "Customers check out with a stored wallet balance, linked card, or linked bank account.",
    consideration:
      "Wallet support depends on the customer’s device and the provider’s checkout rules.",
  },
  {
    name: "Direct debit",
    group: "Traditional",
    icon: "Landmark",
    examples: "Recurring bank debits",
    copy: "Customers authorize a merchant-initiated debit for a subscription or invoice.",
    consideration:
      "Clearing and return rules follow the domestic banking system.",
  },
  {
    name: "Cash vouchers",
    group: "Local methods",
    icon: "Receipt",
    examples: "Retail-generated payment codes",
    copy: "Customers receive a voucher or barcode and complete payment through the designated retail process.",
    consideration:
      "The payment is confirmed only when the voucher process completes.",
  },
  {
    name: "Installments",
    group: "Local methods",
    icon: "CalendarClock",
    examples: "Pay-later and installment plans",
    copy: "Customers split a purchase into scheduled payments handled by the financing provider.",
    consideration:
      "Eligibility depends on the financing provider’s approval rules.",
  },
  {
    name: "Stablecoins",
    group: "Digital assets",
    icon: "Coins",
    examples: "USDC on Base",
    copy: "Customers send an exact stablecoin payment to an observed on-chain address.",
    consideration:
      "Asset, network, amount precision, confirmations, and wallet screening can all affect eligibility.",
  },
  {
    name: "Crypto apps",
    group: "Digital assets",
    icon: "QrCode",
    examples: "Exchange-held balances",
    copy: "Customers pay from an existing crypto-app balance through that app’s checkout flow.",
    consideration:
      "Conversion and settlement remain regulated provider operations.",
  },
  {
    name: "Other local methods",
    group: "Local methods",
    icon: "Network",
    examples: "Market-specific payment flows",
    copy: "Customers use the payment process established by a local provider.",
    consideration:
      "These methods appear only when a certified provider can serve them.",
  },
];
export const useCases = [
  {
    title: "Same-method backup",
    need: "A provider cannot start the customer’s selected method.",
    choice: "The customer’s choice stays unchanged.",
    route:
      "PayRouta checks another eligible provider for the same payment method before checkout concludes.",
    outcome:
      "The payment continues through the backup route, or the customer selects another method.",
    benefit: "Fewer failed checkouts without changing what the customer chose.",
  },
  {
    title: "Mobile checkout in one tap",
    need: "A customer wants a familiar mobile payment method.",
    choice: "The customer selects an available mobile method.",
    route: "An eligible provider executes that method.",
    outcome: "The checkout updates from the normalized payment state.",
    benefit: "Customers do not need to understand provider plumbing.",
  },
  {
    title: "Direct stablecoin payment",
    need: "A customer wants to pay on-chain.",
    choice: "The customer selects stablecoin when asset and network are eligible.",
    route: "PayRouta observes the transaction and waits for finality.",
    outcome: "The payment becomes confirmed only after chain rules are met.",
    benefit: "Blockchain observation stays inside the same payment lifecycle.",
  },
  {
    title: "Settlement tracked separately",
    need: "A merchant needs clear payout records.",
    choice: "The customer pays through any eligible method.",
    route: "Settlement allocations are tied to provider evidence.",
    outcome: "Confirmation and settlement remain separate, reconcilable facts.",
    benefit: "Finance teams can investigate mismatches as exceptions.",
  },
  {
    title: "Provider certification",
    need: "A new provider wants production traffic.",
    choice: "The provider declares methods, coverage, and operations.",
    route: "Automated certification tests only the declared capabilities.",
    outcome:
      "Approved capabilities can route when all production gates remain satisfied.",
    benefit: "The network can grow without a custom deployment for every provider.",
  },
];
