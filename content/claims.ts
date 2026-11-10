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
    examples: "Verve, M-Pesa, MTN MoMo, USSD, Migo Credit",
    cells: { card: "testing", wallet: "testing", bank: "testing", mobile: "testing", ussd: "testing", credit: "testing", crypto: "available" },
  },
  {
    region: "Latin America",
    examples: "Pix, SPEI, Mercado Crédito, Kueski Pay",
    cells: { card: "testing", wallet: "testing", bank: "testing", mobile: null, ussd: null, credit: "testing", crypto: "available" },
  },
  {
    region: "Asia",
    examples: "UPI, QRIS, GoPay, Kredivo, Atome",
    cells: { card: "testing", wallet: "testing", bank: "testing", mobile: null, ussd: null, credit: "testing", crypto: "available" },
  },
  {
    region: "Europe and the UK",
    examples: "SEPA, Faster Payments, Apple Pay, Klarna",
    cells: { card: "testing", wallet: "testing", bank: "testing", mobile: null, ussd: null, credit: "testing", crypto: "available" },
  },
  {
    region: "Everywhere else",
    examples: "Visa, Mastercard, Amex, Apple Pay, Affirm",
    cells: { card: "testing", wallet: "testing", bank: null, mobile: null, ussd: null, credit: "testing", crypto: "available" },
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
    availability: "testing",
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
    availability: "testing",
    note: "Built and testable in sandbox across 5 continental credit switches. Live credit opens country by country as licensed lenders join PayRouta.",
  },
  {
    id: "anyChain",
    title: "Any wallet, any chain",
    availability: "available",
    note: "Pay with any token on any chain: 125+ listed through NEAR Intents across 36+ chains, and any other by its contract address, swapped to the merchant's stablecoin before the payment completes.",
  },
  {
    id: "platforms",
    title: "Shopify and WooCommerce",
    availability: "available",
    note: "The PayRouta Checkout plugin adds PayRouta to WooCommerce checkout. In Shopify, buyers pay from a Pay button on the order page after checkout, and the order is marked paid.",
  },
];

// Where merchants can add the button.
export const platforms: { name: string; detail: string; availability: Availability }[] = [
  { name: "No website", detail: "A payment link you share on WhatsApp, Instagram, SMS or an invoice", availability: "available" },
  { name: "Any website or app", detail: "One script tag and a button", availability: "available" },
  { name: "Your own server", detail: "Node and Python SDKs, one call per order", availability: "available" },
  { name: "AI agents", detail: "Agents pay your links and invoices over HTTP; your assistant runs payments over MCP", availability: "available" },
  { name: "Command line", detail: "The payrouta CLI, for terminals, scripts and CI", availability: "available" },
  { name: "WooCommerce", detail: "PayRouta Checkout plugin", availability: "available" },
  { name: "Shopify", detail: "A Pay button on the order page after Shopify checkout", availability: "available" },
];

// Credit at checkout. No lender is live yet; keep this list empty until one
// is, and name lenders only with their agreement.
export const creditLenders: { country: string; lender: string; availability: Availability }[] = [];

export const availabilityLabel: Record<Availability, string> = {
  available: "Live",
  testing: "In testing",
  planned: "Coming",
};

// What a marketing page says about availability: "Coming" for what isn't
// built yet, nothing otherwise. Where a merchant or customer acts on an
// option (settlement in the dashboard, methods at checkout), options that
// can't be used are marked "Not available" there instead.
export const publicLabel = (a: Availability) => (a === "planned" ? availabilityLabel.planned : undefined);

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

// The front page's figures. Each restates a line above: ways to pay from
// methodFamilies, chains from pillars.anyChain. "Any" token: listed ones
// through NEAR Intents, any other by its contract address.
export const figures: { value: string; prefix?: string; suffix?: string; label: string }[] = [
  { value: "1", label: "checkout for every customer" },
  { value: String(methodFamilies.length), label: "ways to pay" },
  { value: "Any", label: "token, listed or by contract address" },
  { value: "36", suffix: "+", label: "chains" },
];

// The front page's strip of ways to pay, by family, with the brand mark from
// components/marketing/brand-logos.ts (none: drawn as a wordmark). Payment
// methods only: lenders are named only once they're live partners.
export type WayToPay = {
  name: string;
  family: "card" | "wallet" | "bank" | "mobile" | "crypto";
  logo?: string;
  // Wordmark tiles for brands with no openly licensed mark.
  mark?: { text: string; color: string; bg?: string };
};
export const waysToPay: WayToPay[] = [
  { name: "Visa", family: "card", logo: "visa" },
  { name: "Mastercard", family: "card", logo: "mastercard" },
  { name: "American Express", family: "card", logo: "amex" },
  { name: "Apple Pay", family: "wallet", logo: "applepay" },
  { name: "Google Pay", family: "wallet", logo: "googlepay" },
  { name: "PayPal", family: "wallet", logo: "paypal" },
  { name: "Venmo", family: "wallet", logo: "venmo" },
  { name: "PicPay", family: "wallet", logo: "picpay" },
  { name: "Pix", family: "bank", logo: "pix" },
  { name: "SEPA", family: "bank", logo: "sepa" },
  { name: "UPI", family: "bank", mark: { text: "UPI", color: "#097939" } },
  { name: "Faster Payments", family: "bank", mark: { text: "FPS", color: "#2e37a4" } },
  { name: "M-Pesa", family: "mobile", mark: { text: "M", color: "#ffffff", bg: "#00a650" } },
  { name: "MTN MoMo", family: "mobile", mark: { text: "MoMo", color: "#1e2466", bg: "#ffcb05" } },
  { name: "USSD", family: "mobile", mark: { text: "*#", color: "#ffffff", bg: "#1e2466" } },
  { name: "USDC", family: "crypto", logo: "usdc" },
  { name: "USDT", family: "crypto", logo: "usdt" },
  { name: "Bitcoin", family: "crypto", logo: "btc" },
  { name: "Ethereum", family: "crypto", logo: "eth" },
  { name: "Solana", family: "crypto", logo: "sol" },
  { name: "NEAR", family: "crypto", logo: "near" },
  { name: "Stellar", family: "crypto", logo: "xlm" },
  { name: "Polygon", family: "crypto", logo: "matic" },
  { name: "Avalanche", family: "crypto", logo: "avax" },
  { name: "Tron", family: "crypto", logo: "trx" },
  { name: "BNB Chain", family: "crypto", logo: "bnb" },
  { name: "Optimism", family: "crypto", logo: "optimism" },
];

// What a merchant can be settled in, whatever the customer paid with. Card,
// bank and wallet payments settle through the partner that processed them;
// crypto settles through the merchant's own wallet or NEAR Intents account.
// Change an availability only after it has run with real money.
export const settleIn: { id: string; name: string; detail: string; availability: Availability }[] = [
  { id: "stablecoin", name: "USDC, USDT or EURC", detail: "To your own wallet", availability: "available" },
  { id: "intents", name: "Any token on any chain", detail: "Through your NEAR Intents account", availability: "testing" },
  { id: "bank", name: "Your bank account", detail: "USD by ACH or wire, EUR by SEPA", availability: "testing" },
  { id: "local", name: "Local bank or mobile money", detail: "Naira, cedi, shilling, rand and more", availability: "testing" },
];
