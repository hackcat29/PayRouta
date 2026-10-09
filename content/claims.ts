// Every public-facing figure, rail name and commercial term on the marketing
// site lives here. Edit this file (not the page components) when coverage,
// pricing or product facts change. Keep each figure defensible: payments
// buyers treat numbers on this site as commitments.

export const headlineStats = [
  { value: "1", label: "application for every provider you choose" },
  { value: "0", label: "customer funds held by PayRouta" },
  { value: "10", label: "payment method families in one schema" },
  { value: "5", label: "normalized payment states, whatever the provider" },
] as const;

// Where the product is today. Shown wherever the site describes availability.
export const status = {
  stage: "Early access",
  sandbox: "Sandbox available now",
  live: "Live processing opens provider by provider, after each integration passes qualification",
  sdks: "TypeScript and Python SDKs for early-access merchants",
} as const;

// Method families, the transit-line colour each one uses across the site, and
// the letter shown in its route bullet.
export const lines = {
  card: { label: "Cards", color: "var(--line-card)", bullet: "C" },
  bank: { label: "Bank transfers", color: "var(--line-bank)", bullet: "B" },
  mobile: { label: "Mobile money", color: "var(--line-mobile)", bullet: "M" },
  wallet: {
    label: "Digital wallets",
    color: "var(--line-wallet)",
    bullet: "W",
  },
  crypto: { label: "Stablecoins", color: "var(--line-crypto)", bullet: "S" },
} as const;
export type LineKey = keyof typeof lines;

// Rails PayRouta's method schema is designed to route. Shown in the marquee and
// the payment-method atlas. Actual availability depends on the provider
// accounts each merchant holds; never present this list as live coverage.
export const rails: { name: string; line: LineKey }[] = [
  { name: "Visa", line: "card" },
  { name: "Mastercard", line: "card" },
  { name: "American Express", line: "card" },
  { name: "Verve", line: "card" },
  { name: "SEPA Instant", line: "bank" },
  { name: "Pix", line: "bank" },
  { name: "UPI", line: "bank" },
  { name: "FedNow", line: "bank" },
  { name: "Faster Payments", line: "bank" },
  { name: "NIP", line: "bank" },
  { name: "M-Pesa", line: "mobile" },
  { name: "MTN MoMo", line: "mobile" },
  { name: "Airtel Money", line: "mobile" },
  { name: "Apple Pay", line: "wallet" },
  { name: "Google Pay", line: "wallet" },
  { name: "USDC on Base", line: "crypto" },
];

export const regions = [
  {
    name: "Europe",
    methods: [
      "Cards",
      "SEPA Instant",
      "SEPA Direct Debit",
      "Apple Pay",
      "Google Pay",
    ],
    currencies: ["EUR", "GBP", "CHF", "PLN"],
  },
  {
    name: "North America",
    methods: ["Cards", "FedNow / RTP", "ACH", "Apple Pay", "Google Pay"],
    currencies: ["USD", "CAD"],
  },
  {
    name: "Latin America",
    methods: ["Pix", "Cards", "Cash vouchers", "Installments"],
    currencies: ["BRL", "MXN", "COP"],
  },
  {
    name: "Africa",
    methods: [
      "Bank transfer (NIP)",
      "Cards",
      "M-Pesa",
      "MTN MoMo",
      "Airtel Money",
    ],
    currencies: ["NGN", "KES", "GHS", "ZAR"],
  },
  {
    name: "Asia-Pacific",
    methods: ["UPI", "Cards", "Digital wallets", "Bank transfer"],
    currencies: ["INR", "SGD", "IDR", "AUD"],
  },
  {
    name: "On-chain",
    methods: ["USDC on Base", "USDC on Ethereum"],
    currencies: ["USDC"],
  },
] as const;

export const pricing = {
  rate: "0.25%",
  lowerRate: "0.10%",
  cardCap: "$2",
  bankCap: "$1",
  rateNote: "cards, digital wallets and BNPL; capped at $2 per USD payment",
  lowerRateNote:
    "bank transfers, direct debit, USSD, mobile money and crypto; capped at $1 per USD payment",
  plusNote:
    "your provider's processing fees are charged on your own account, under your contract with them",
  sandbox: "Free, unlimited sandbox",
  volumeThreshold: "$100,000 / month",
} as const;

// Countries shown in the hero routing widget and the flag strip. Amounts are
// illustrative; methods are those PayRouta's schema is built to route there.
export const corridors = [
  {
    code: "BR",
    name: "Brazil",
    amount: "R$ 389,90",
    methods: [
      ["bank", "Pix"],
      ["card", "Cards"],
      ["wallet", "Google Pay"],
    ],
  },
  {
    code: "IN",
    name: "India",
    amount: "₹7,499",
    methods: [
      ["bank", "UPI"],
      ["card", "Cards"],
      ["wallet", "Digital wallets"],
    ],
  },
  {
    code: "KE",
    name: "Kenya",
    amount: "KSh 2,450",
    methods: [
      ["mobile", "M-Pesa"],
      ["mobile", "Airtel Money"],
      ["card", "Cards"],
    ],
  },
  {
    code: "DE",
    name: "Germany",
    amount: "€240.00",
    methods: [
      ["bank", "SEPA Instant"],
      ["card", "Cards"],
      ["wallet", "Apple Pay"],
    ],
  },
  {
    code: "US",
    name: "United States",
    amount: "$264.00",
    methods: [
      ["card", "Cards"],
      ["wallet", "Apple Pay"],
      ["crypto", "USDC"],
    ],
  },
  {
    code: "NG",
    name: "Nigeria",
    amount: "₦185,000",
    methods: [
      ["bank", "Bank transfer"],
      ["card", "Cards"],
      ["crypto", "USDC"],
    ],
  },
  {
    code: "GB",
    name: "United Kingdom",
    amount: "£205.00",
    methods: [
      ["bank", "Faster Payments"],
      ["card", "Cards"],
      ["wallet", "Apple Pay"],
    ],
  },
  {
    code: "MX",
    name: "Mexico",
    amount: "MX$4,590",
    methods: [
      ["card", "Cards"],
      ["bank", "SPEI"],
      ["wallet", "Google Pay"],
    ],
  },
] as const satisfies readonly {
  code: string;
  name: string;
  amount: string;
  methods: readonly (readonly [LineKey, string])[];
}[];
