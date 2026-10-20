// Every public-facing fact on the marketing site lives here: availability,
// coverage and prices. Edit this file (not the page components) when they
// change. Buyers of payment services read these as commitments, so keep each
// line true today, not on the roadmap.

export const status = {
  stage: "Early access",
  summary:
    "Stablecoin and crypto payments are live. Cards, bank transfers, wallets and mobile money open region by region. Credit opens country by country as licensed lenders join.",
} as const;

// "available": merchants in early access can use it live today.
// "testing": built and working in test mode; live once the partner signs off.
// "planned": on the roadmap, not built yet.
export type Availability = "available" | "testing" | "planned";

export const markets: {
  name: string;
  currencies: string;
  methods: string;
  availability: Availability;
}[] = [
  {
    name: "Worldwide",
    currencies: "USD, EUR, GBP, CAD, AUD, JPY, CHF, SEK, SGD, AED",
    methods: "Visa, Mastercard, American Express, Apple Pay, Google Pay",
    availability: "testing",
  },
  {
    name: "Europe and the UK",
    currencies: "EUR, GBP",
    methods: "Pay by bank (SEPA, Faster Payments)",
    availability: "testing",
  },
  {
    name: "Latin America",
    currencies: "BRL, MXN, COP",
    methods: "Pix, cards, bank transfer, local wallets",
    availability: "testing",
  },
  {
    name: "Asia",
    currencies: "INR, PHP, SGD, JPY",
    methods: "Cards, bank transfer, local wallets",
    availability: "testing",
  },
  {
    name: "Africa",
    currencies: "NGN, GHS, KES, ZAR, XOF",
    methods: "Cards, bank transfer, USSD, M-Pesa, MTN MoMo",
    availability: "testing",
  },
  {
    name: "Anywhere",
    currencies: "USDC, USDT, EURC",
    methods: "Stablecoins, paid straight to your own wallet",
    availability: "available",
  },
  {
    name: "Anywhere",
    currencies: "ETH, SOL, XLM, AVAX, POL and major tokens",
    methods: "Crypto from the customer's wallet, paid straight to yours",
    availability: "available",
  },
  {
    name: "Anywhere",
    currencies: "Binance Pay, Coinbase",
    methods: "Paying from a crypto exchange account",
    availability: "testing",
  },
];

// What customers can pay with, by region, for the front page's coverage
// grid. Must agree with `markets` above; "planned" is shown as "Coming" and
// null means not offered there.
export const methodFamilies = [
  ["card", "Cards"],
  ["wallet", "Digital wallets"],
  ["bank", "Bank transfer"],
  ["mobile", "Mobile money"],
  ["ussd", "USSD"],
  ["credit", "Pay with credit"],
  ["crypto", "Stablecoins & crypto"],
] as const;
export type MethodFamily = (typeof methodFamilies)[number][0];
export const coverage: { region: string; examples: string; cells: Record<MethodFamily, Availability | null> }[] = [
  {
    region: "Africa",
    examples: "Verve, M-Pesa, MTN MoMo, USSD",
    cells: { card: "testing", wallet: "planned", bank: "testing", mobile: "testing", ussd: "testing", credit: "planned", crypto: "available" },
  },
  {
    region: "Latin America",
    examples: "Pix, local cards and wallets",
    cells: { card: "testing", wallet: "testing", bank: "testing", mobile: null, ussd: null, credit: "planned", crypto: "available" },
  },
  {
    region: "Asia",
    examples: "Cards, bank transfer, local wallets",
    cells: { card: "testing", wallet: "testing", bank: "testing", mobile: null, ussd: null, credit: "planned", crypto: "available" },
  },
  {
    region: "Europe and the UK",
    examples: "Cards, Apple Pay, pay by bank",
    cells: { card: "testing", wallet: "testing", bank: "testing", mobile: null, ussd: null, credit: "planned", crypto: "available" },
  },
  {
    region: "Everywhere else",
    examples: "Visa, Mastercard, Amex, Apple Pay, Google Pay",
    cells: { card: "testing", wallet: "testing", bank: null, mobile: null, ussd: null, credit: "planned", crypto: "available" },
  },
];

// Where merchants can receive their money.
export const payouts: { destination: string; detail: string; availability: Availability }[] = [
  {
    destination: "Bank account",
    detail: "Local or international, on a schedule you set",
    availability: "testing",
  },
  {
    destination: "Crypto wallet",
    detail: "Stablecoin and crypto payments arrive directly",
    availability: "available",
  },
  {
    destination: "Mobile money wallet",
    detail: "M-Pesa, MTN MoMo and others",
    availability: "planned",
  },
  {
    destination: "Stablecoins from card and bank payments",
    detail: "Your balance paid out as USDC or USDT",
    availability: "planned",
  },
];

// PayRouta's thesis (docs/THESIS.md), pillar by pillar, with what is true
// today. "planned" here means built and testable in sandbox, not yet live
// with real money; the note says what stands between it and live.
export const pillars: {
  id: "button" | "credit" | "anyChain" | "platforms";
  title: string;
  availability: Availability;
  note: string;
}[] = [
  {
    id: "button",
    title: "One checkout button",
    availability: "available",
    note: "Works today with stablecoin and crypto checkout. Cards, digital wallets, bank transfers and mobile money join as they open in your region.",
  },
  {
    id: "credit",
    title: "Pay with credit",
    availability: "planned",
    note: "Built and testable in sandbox with a fictional lender. Live credit opens country by country as licensed lenders join PayRouta.",
  },
  {
    id: "anyChain",
    title: "Any wallet, any chain",
    availability: "available",
    note: "Pay from a wallet on eight networks, or with any of 125+ assets on 36+ chains through NEAR Intents.",
  },
  {
    id: "platforms",
    title: "Shopify and WooCommerce",
    availability: "planned",
    note: "Both are built. The WooCommerce plugin is in private testing; Shopify listing waits on Shopify's payments-partner approval.",
  },
];

// Where merchants can add the button.
export const platforms: { name: string; detail: string; availability: Availability }[] = [
  { name: "No website", detail: "A payment link you share on WhatsApp, Instagram, SMS or an invoice", availability: "available" },
  { name: "Any website or app", detail: "One script tag and a button", availability: "available" },
  { name: "Your own server", detail: "Node and Python SDKs, one call per order", availability: "available" },
  { name: "WooCommerce", detail: "PayRouta Checkout plugin", availability: "planned" },
  { name: "Shopify", detail: "PayRouta payments app at Shopify checkout", availability: "planned" },
];

// Credit at checkout. No lender is live yet; keep this list empty until one
// is, and name lenders only with their agreement.
export const creditLenders: { country: string; lender: string; availability: Availability }[] = [];

export const availabilityLabel: Record<Availability, string> = {
  available: "Live",
  testing: "In testing",
  planned: "Coming",
};

// PayRouta's fee per successful payment. Where a partner processes the
// payment, its standard processing fee is charged as well. Where PayRouta is
// the only processor (stablecoins and native crypto), there is no partner fee.
export const pricing = {
  partnerProcessed: {
    rate: "1%",
    cap: "$5",
    methods: "Cards, wallets, bank transfer, USSD, mobile money",
    note: "plus the standard fee of the partner that processed the payment",
  },
  payroutaOnly: {
    rate: "1.5%",
    methods: "Stablecoins and crypto",
    note: "all in: PayRouta is the only processor, so there is no partner fee",
  },
  volumeThreshold: "$100,000 a month",
} as const;
