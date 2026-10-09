export const pages = {
  "provider-routing": {
    title: "Provider Routing",
    headline: "Use the right provider for the payment in front of you.",
    intro:
      "PayRouta routes every payment to the best eligible provider for the method your customer chose, and fails over to another provider for that same method when the first one can't complete it.",
    sections: [
      [
        "Compare providers after customer choice",
        "Customers decide how to pay first. Providers are never treated as interchangeable across different payment methods.",
      ],
      [
        "Check eligibility before comparing cost",
        "Each route must use a provider account the merchant owns and has had approved, and must pass corridor, asset, amount, compliance, certification, health, and operational checks. Ineligible providers are excluded before any comparison.",
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
      "Your providers settle to you directly. PayRouta gives you one reconciled view of every payment, fee and settlement across all of them — with mismatches surfaced as exceptions, never silent balances.",
    sections: [
      [
        "Track confirmation separately from payment to the merchant",
        "Confirmation means the payer’s value was accepted. Settlement means the merchant allocation was completed by the provider.",
      ],
      [
        "Use the settlement path supported by the provider",
        "Each provider pays you into the destination you set in your own account with them. PayRouta never receives or forwards funds, and never invents exchange rates. Provider settlement evidence determines the final record.",
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
      "Follow a payment through PayRouta: create an intent, offer only methods that can work, let the customer choose, route to the best provider, recover quietly, and reconcile settlement.",
    sections: [
      [
        "Open your provider accounts",
        "Apply once. PayRouta pre-fills an application with each provider you choose, and each account is opened in your name.",
      ],
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
      "Apply once to PayRouta and accept every major way your customers pay. One integration routes each payment across our regulated processing partners, with a backup per method and a checkout that keeps working when a partner doesn't.",
    sections: [
      [
        "Apply once",
        "One application to PayRouta. We verify your business and set up processing with our partners; you never fill in a provider's forms.",
      ],
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
    headline: "Merchants apply once. You onboard them directly.",
    intro:
      "If your programme opens accounts that merchants own, PayRouta can send you pre-screened, pre-filled applications from merchants who choose you. You run your own KYC, contract with the merchant, and settle to them. PayRouta routes their payments to you.",
    sections: [
      [
        "Offer accounts merchants own",
        "The merchant contracts with you, logs in to their own account, bears their own losses and keeps the account if they leave PayRouta. PayRouta never sits between you and the merchant's money.",
      ],
      [
        "Receive pre-filled applications",
        "PayRouta screens each business first, then sends only the fields your programme needs, with the merchant's explicit consent. You collect identity documents and bank details yourself.",
      ],
      [
        "Choose a connection",
        "Use your partner onboarding API, implement the PayRouta Provider API, map an existing API declaratively, or ask about a native PayRouta-built integration.",
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
      "One API across all your providers. Idempotent requests, normalized payment states, signed webhooks, TypeScript and Python SDKs for early-access merchants, and a sandbox that simulates provider outages.",
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
      "Simple, usage-based pricing: a free sandbox, a capped platform fee on successful payments, billed monthly, and volume pricing for businesses at scale.",
    sections: [
      [
        "Corridors and methods",
        "Costs depend on the payment methods and provider arrangements that can serve each route.",
      ],
      [
        "Provider fees",
        "Each provider charges its processing fees on your own account, under your contract with them. Settlement timing follows each provider's schedule.",
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
      "PayRouta is building the payment routing layer that works for ordinary businesses: apply once, own your provider accounts, accept the ways your customers pay — and never lose a sale to a single provider's bad day.",
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
        "Your money, on your schedule",
        "Regulated processing partners hold your balance, never PayRouta's own bank accounts, and PayRouta pays you out on your schedule. Stablecoins go straight to your wallet.",
      ],
    ],
  },
  "payment-methods": {
    title: "Payment Methods",
    headline: "One schema for familiar payment categories.",
    intro:
      "Cards, instant bank transfers, mobile money, wallets, direct debit, vouchers, installments and stablecoins — one schema for the ways the world pays. Which methods you can offer depends on the provider accounts you hold.",
    sections: [],
  },
  "use-cases": {
    title: "Use Cases",
    headline: "One payment layer. Real business scenarios.",
    intro:
      "How online stores, SaaS and digital sellers, and local merchants use PayRouta to open provider accounts in their own name, accept the methods their customers use, and keep checkout working through provider outages.",
    sections: [],
  },
} as const;
export type PageSlug = keyof typeof pages;
export const methodContent = [
  {
    name: "Bank transfers",
    group: "Instant & A2A",
    icon: "Zap",
    examples: "Pix · SEPA Instant · UPI · FedNow · Faster Payments · NIP",
    copy: "Customers move money directly from a bank account and authorize the payment through their own banking flow.",
    consideration:
      "Available through providers you hold an account with, for the corridors they serve.",
  },
  {
    name: "Cards",
    group: "Traditional",
    icon: "CreditCard",
    examples: "Visa · Mastercard · American Express · domestic schemes",
    copy: "Customers pay by card and complete whatever authorization their issuer or wallet requires.",
    consideration:
      "Provider comparison happens only after the customer selects cards.",
  },
  {
    name: "Mobile money",
    group: "Local methods",
    icon: "Smartphone",
    examples: "M-Pesa · MTN MoMo · Airtel Money · Orange Money",
    copy: "Customers approve a payment using a mobile-money account or phone prompt.",
    consideration:
      "Limits and prompts depend on the mobile-money provider and account.",
  },
  {
    name: "Digital wallets",
    group: "Instant & A2A",
    icon: "Wallet",
    examples: "Apple Pay · Google Pay · regional super-apps",
    copy: "Customers check out with a stored wallet balance, linked card, or linked bank account.",
    consideration:
      "Wallet support depends on the customer’s device and the provider’s checkout rules.",
  },
  {
    name: "Direct debit",
    group: "Traditional",
    icon: "Landmark",
    examples: "SEPA Direct Debit · ACH · Bacs",
    copy: "Customers authorize a merchant-initiated debit for a subscription or invoice.",
    consideration:
      "Clearing and return rules follow the domestic banking system.",
  },
  {
    name: "Cash vouchers",
    group: "Local methods",
    icon: "Receipt",
    examples: "Boleto · OXXO · retail payment codes",
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
    examples: "USDC, EURC and USDT on supported networks",
    copy: "Customers send an exact stablecoin payment to a wallet address you control. PayRouta observes the chain and never takes custody.",
    consideration:
      "Asset, network, amount precision, confirmations, and wallet screening can all affect eligibility.",
  },
  {
    name: "Crypto wallet payments",
    group: "Digital assets",
    icon: "QrCode",
    examples: "Native coins and original token deployments across eight networks",
    copy: "Customers pay directly from Web3 wallets using a CoinGecko quote. The selected coin arrives in your own wallet.",
    consideration:
      "Network fees are separate. Wrapped tokens are excluded; exchange-app payments are Coming soon.",
  },
  {
    name: "Other local methods",
    group: "Local methods",
    icon: "Network",
    examples: "Market-specific payment flows",
    copy: "Customers use the payment process established by a local provider.",
    consideration:
      "These methods appear only when one of your provider accounts can serve them.",
  },
];
export const useCases = [
  {
    title: "One application, several providers",
    need: "A merchant wants a backup provider without filling in two applications.",
    choice:
      "The merchant picks providers and sees exactly what each will receive.",
    route:
      "PayRouta screens the business and pre-fills each provider's application.",
    outcome:
      "Each provider verifies the merchant and opens an account in the merchant's name.",
    benefit:
      "Redundancy without re-onboarding, and no funds held by a middleman.",
  },
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
    choice:
      "The customer selects stablecoin when asset and network are eligible.",
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
    benefit:
      "The network can grow without a custom deployment for every provider.",
  },
];
