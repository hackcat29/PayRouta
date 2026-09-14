export interface DemoMethod {
  id: string;
  label: string;
  sublabel?: string;
  directInstitutions?: string[];
}

export interface Scenario {
  id: string;
  name: string;
  flag: string;
  currency: string;
  amount: string;
  summary: string;
  timezoneMatch?: RegExp;
  methods: DemoMethod[];
  unavailable: string;
  reason: string;
}

export const scenarios: Scenario[] = [
  {
    id: "NG",
    name: "Nigeria",
    flag: "🇳🇬",
    currency: "NGN",
    amount: "25,000",
    summary: "NIP account transfers, OPay & PalmPay wallets, mobile money, and stablecoins.",
    timezoneMatch: /Lagos|Accra|Abidjan|Douala|Kinshasa|Africa/i,
    methods: [
      { id: "bank", label: "Bank transfer", sublabel: "NIP & Bank USSD (*737#)" },
      { id: "wallet", label: "Digital wallet", sublabel: "OPay, PalmPay" },
      { id: "mobile", label: "Mobile money", sublabel: "MTN MoMo (STK & USSD)" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC multi-chain" },
      { id: "binance_pay", label: "Crypto app", sublabel: "Binance Pay" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Ondo USDY" },
      { id: "direct_debit", label: "Direct debit", sublabel: "NIBSS mandate" },
      { id: "cash_voucher", label: "Cash voucher", sublabel: "Moniepoint & Baxi POS Agents" },
      { id: "bnpl", label: "Installments", sublabel: "CredPal, Carbon" },
    ],
    unavailable: "Card",
    reason: "No eligible card provider in this fixture.",
  },
  {
    id: "US",
    name: "United States",
    flag: "🇺🇸",
    currency: "USD",
    amount: "100",
    summary: "FedNow/RTP instant push, Apple/Cash App Pay, cards, ACH, and stablecoins.",
    timezoneMatch: /New_York|Chicago|Los_Angeles|Denver|Phoenix|America/i,
    methods: [
      { id: "card", label: "Card", sublabel: "Visa, Mastercard, Amex" },
      { id: "ach", label: "ACH", sublabel: "Direct debit & wire" },
      { id: "bank", label: "Bank transfer", sublabel: "FedNow / RTP Instant" },
      { id: "wallet", label: "Digital wallet", sublabel: "Apple Pay, Cash App" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle Mint & Native USDC" },
      { id: "binance_pay", label: "Crypto app", sublabel: "Coinbase Commerce" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Ondo USDY, BENJI" },
      { id: "bnpl", label: "Installments", sublabel: "Affirm, Klarna" },
      { id: "cash_voucher", label: "Cash voucher", sublabel: "PayNearMe 7-Eleven" },
    ],
    unavailable: "Mobile money",
    reason: "Mobile money is not configured in this demo.",
  },
  {
    id: "GB",
    name: "United Kingdom",
    flag: "🇬🇧",
    currency: "GBP",
    amount: "85",
    summary: "Faster Payments FPS, Open Banking Pay by Bank, cards, Bacs, and stablecoins.",
    timezoneMatch: /London|Belfast|GMT/i,
    methods: [
      { id: "bank", label: "Bank transfer", sublabel: "Faster Payments FPS" },
      { id: "card", label: "Card", sublabel: "Visa & Mastercard" },
      { id: "wallet", label: "Digital wallet", sublabel: "Apple Pay, Revolut" },
      { id: "direct_debit", label: "Direct debit", sublabel: "Bacs Direct Debit" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC (BVNK USDC/EURC)" },
      { id: "bnpl", label: "Installments", sublabel: "Klarna, Clearpay" },
      { id: "binance_pay", label: "Crypto app", sublabel: "Binance Pay, Revolut" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Ondo USDY, Gilts" },
      { id: "cash_voucher", label: "Cash voucher", sublabel: "PayPoint 28,000 stores" },
    ],
    unavailable: "US ACH",
    reason: "ACH is only available for US bank accounts.",
  },
  {
    id: "BR",
    name: "Brazil",
    flag: "🇧🇷",
    currency: "BRL",
    amount: "450",
    summary: "Pix instant 24/7 push, Boleto Bancário, card installments, and stablecoins.",
    timezoneMatch: /Sao_Paulo|Fortaleza|Recife|Manaus|Brazil/i,
    methods: [
      { id: "pix", label: "Pix", sublabel: "Central Bank 24/7" },
      { id: "bank", label: "Bank transfer", sublabel: "Pix Instant QR" },
      { id: "boleto", label: "Boleto", sublabel: "Boleto Bancário / Flash" },
      { id: "card", label: "Card", sublabel: "Elo, Visa, Mastercard" },
      { id: "wallet", label: "Digital wallet", sublabel: "Mercado Pago, PicPay" },
      { id: "bnpl", label: "Installments", sublabel: "Parcelamento 12x" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC (USDT & BRZ)" },
      { id: "binance_pay", label: "Crypto app", sublabel: "Binance Pay Brazil" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Ondo USDY, Agribusiness" },
      { id: "mobile", label: "Mobile money", sublabel: "RecargaPay, Vivo" },
    ],
    unavailable: "SEPA",
    reason: "SEPA is only available in Europe.",
  },
  {
    id: "EU",
    name: "Europe",
    flag: "🇪🇺",
    currency: "EUR",
    amount: "250",
    summary: "SEPA Instant, iDEAL / Wero, domestic cards, SEPA Direct Debit, and MiCA EURC.",
    timezoneMatch: /Berlin|Paris|Amsterdam|Madrid|Rome|Brussels|Vienna|Europe/i,
    methods: [
      { id: "sepa_instant", label: "SEPA Instant", sublabel: "Pan-European SCT Inst" },
      { id: "ideal", label: "iDEAL", sublabel: "iDEAL / Wero (EPI)" },
      { id: "bank", label: "Bank transfer", sublabel: "SEPA Instant" },
      { id: "wallet", label: "Digital wallet", sublabel: "PayPal, Apple Pay" },
      { id: "card", label: "Card", sublabel: "Girocard, CB, Visa" },
      { id: "direct_debit", label: "Direct debit", sublabel: "SEPA Direct Debit SDD" },
      { id: "bnpl", label: "Installments", sublabel: "Klarna Rechnung" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle MiCA EURC & USDC" },
      { id: "cash_voucher", label: "Cash voucher", sublabel: "viacash / Barzahlen" },
      { id: "binance_pay", label: "Crypto app", sublabel: "Bitpanda Pay" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "eWpG Securities, Ondo" },
    ],
    unavailable: "ACH Direct Debit",
    reason: "ACH is only available for US bank accounts.",
  },
  {
    id: "IN",
    name: "India",
    flag: "🇮🇳",
    currency: "INR",
    amount: "3,500",
    summary: "UPI 14B+ instant payments, RuPay scheme, PhonePe/GPay, and NACH e-Mandates.",
    timezoneMatch: /Kolkata|Calcutta|India|Asia\/Kolkata/i,
    methods: [
      { id: "upi", label: "UPI", sublabel: "NPCI Instant Rail" },
      { id: "bank", label: "Bank transfer", sublabel: "UPI & IMPS" },
      { id: "rupay", label: "RuPay", sublabel: "Domestic Card Scheme" },
      { id: "wallet", label: "Digital wallet", sublabel: "PhonePe, Google Pay" },
      { id: "direct_debit", label: "Direct debit", sublabel: "NACH e-Mandates" },
      { id: "bnpl", label: "Installments", sublabel: "Simpl, LazyPay" },
      { id: "mobile", label: "Mobile money", sublabel: "Airtel Payments Bank" },
      { id: "cash_voucher", label: "Cash voucher", sublabel: "Digital COD" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC (Compliant Export Rails)" },
      { id: "binance_pay", label: "Crypto app", sublabel: "FIU-Compliant Checkout" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Digital Gold, Ondo" },
    ],
    unavailable: "SEPA",
    reason: "SEPA is only available in Europe.",
  },
  {
    id: "KE",
    name: "Kenya",
    flag: "🇰🇪",
    currency: "KES",
    amount: "5,000",
    summary: "Safaricom M-Pesa STK Push, Pesalink interbank, Chipper Cash, and stablecoins.",
    timezoneMatch: /Nairobi|Kampala|Dar_es_Salaam|East_Africa/i,
    methods: [
      { id: "mobile", label: "Mobile money", sublabel: "M-Pesa (STK & *334# USSD)" },
      { id: "bank", label: "Bank transfer", sublabel: "Pesalink Interbank" },
      { id: "wallet", label: "Digital wallet", sublabel: "Chipper Cash" },
      { id: "card", label: "Card", sublabel: "Visa & Mastercard" },
      { id: "direct_debit", label: "Direct debit", sublabel: "KEPSS RTGS" },
      { id: "bnpl", label: "Installments", sublabel: "Lipa Later" },
      { id: "cash_voucher", label: "Cash voucher", sublabel: "Equity & KCB Agent POS" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC (Yellow Card USDT/USDC)" },
      { id: "binance_pay", label: "Crypto app", sublabel: "Binance Pay Kenya" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Ondo USDY Yield" },
    ],
    unavailable: "Stablecoin settlement fixture",
    reason: "Stablecoin settlement is not configured in this demo.",
  },
  {
    id: "JP",
    name: "Japan",
    flag: "🇯🇵",
    currency: "JPY",
    amount: "15,000",
    summary: "Zengin 7th gen network, PayPay 60M+ users, JCB cards, and Konbini 24hr cash.",
    timezoneMatch: /Tokyo|Japan|Asia\/Tokyo/i,
    methods: [
      { id: "jcb", label: "JCB", sublabel: "Domestic Card Scheme" },
      { id: "konbini", label: "Konbini cash", sublabel: "7-Eleven, Lawson Cash" },
      { id: "bank", label: "Bank transfer", sublabel: "Zengin System 24/7" },
      { id: "wallet", label: "Digital wallet", sublabel: "PayPay (60M+ users)" },
      { id: "direct_debit", label: "Direct debit", sublabel: "Kouza Furikae" },
      { id: "bnpl", label: "Installments", sublabel: "Paidy SMS Checkout" },
      { id: "mobile", label: "Mobile money", sublabel: "SoftBank Carrier" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC (JPYC Yen & USDC)" },
      { id: "binance_pay", label: "Crypto app", sublabel: "bitFlyer Pay" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Progmat Securities" },
    ],
    unavailable: "Mobile money",
    reason: "Mobile money is not configured in this demo.",
  },
  {
    id: "SG",
    name: "Singapore",
    flag: "🇸🇬",
    currency: "SGD",
    amount: "140",
    summary: "MAS PayNow & FAST instant rail, GrabPay/ShopeePay, NETS debit, and StraitsX XSGD.",
    timezoneMatch: /Singapore|Asia\/Singapore/i,
    methods: [
      { id: "bank", label: "Bank transfer", sublabel: "MAS PayNow & FAST" },
      { id: "wallet", label: "Digital wallet", sublabel: "GrabPay, ShopeePay" },
      { id: "card", label: "Card", sublabel: "NETS Domestic Debit" },
      { id: "direct_debit", label: "Direct debit", sublabel: "GIRO & MEPS+" },
      { id: "bnpl", label: "Installments", sublabel: "Atome, GrabPayLater" },
      { id: "cash_voucher", label: "Cash voucher", sublabel: "AXS 7-Eleven Kiosks" },
      { id: "mobile", label: "Mobile money", sublabel: "Singtel Dash" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC (StraitsX XSGD & USDC)" },
      { id: "binance_pay", label: "Crypto app", sublabel: "Crypto.com Pay" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Project Guardian Tokens" },
    ],
    unavailable: "Boleto",
    reason: "Boleto is only available in Brazil.",
  },
  {
    id: "MX",
    name: "Mexico",
    flag: "🇲🇽",
    currency: "MXN",
    amount: "1,500",
    summary: "SPEI 24/7 instant interbank, OXXO Pay 20,000 stores, Mercado Pago, and MSI.",
    timezoneMatch: /Mexico|Monterrey|Tijuana|Cancun/i,
    methods: [
      { id: "spei", label: "SPEI", sublabel: "Banco de México 24/7" },
      { id: "oxxo", label: "OXXO", sublabel: "OXXO Pay 20,000 stores" },
      { id: "bank", label: "Bank transfer", sublabel: "SPEI Interbank" },
      { id: "wallet", label: "Digital wallet", sublabel: "Mercado Pago Mexico" },
      { id: "card", label: "Card", sublabel: "Carnet & Visa/Mastercard" },
      { id: "bnpl", label: "Installments", sublabel: "Kueski Pay, MSI" },
      { id: "direct_debit", label: "Direct debit", sublabel: "Domiciliación" },
      { id: "mobile", label: "Mobile money", sublabel: "Telcel Carrier Billing" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC (Bitso MMXN & USDT)" },
      { id: "binance_pay", label: "Crypto app", sublabel: "Bitso Pay & Binance" },
      { id: "ondo_usdy", label: "Real-World Asset", sublabel: "Ondo USDY Yield" },
    ],
    unavailable: "SEPA",
    reason: "SEPA is only available in Europe.",
  },
  {
    id: "GLOBAL",
    name: "Global E-Commerce",
    flag: "🌐",
    currency: "USD",
    amount: "1,200",
    summary: "Cross-border crypto checkout, tokenized Real-World Assets, and multi-currency rails.",
    methods: [
      { id: "binance_pay", label: "Crypto app (Binance Pay)", sublabel: "Binance Pay Checkout" },
      { id: "ondo_usdy", label: "Real-World Asset (Ondo USDY)", sublabel: "Ondo USDY Yield Note" },
      { id: "bank", label: "Bank transfer", sublabel: "Cross-Border Wire" },
      { id: "wallet", label: "Digital wallet", sublabel: "Apple Pay, Google Pay" },
      { id: "card", label: "Card", sublabel: "Global Card Schemes" },
      { id: "stablecoins", label: "Stablecoins", sublabel: "Circle USDC (Avalanche, Base, Solana)" },
      { id: "bnpl", label: "Installments", sublabel: "Global BNPL Partners" },
      { id: "direct_debit", label: "Direct debit", sublabel: "International SWIFT" },
    ],
    unavailable: "Cash voucher",
    reason: "Cash vouchers are not supported for digital orders.",
  },
];

export type Policy = "Balanced" | "Lower cost" | "Faster";

export type State = {
  scenario: number;
  method: string | null;
  policy: Policy;
  excluded: string[];
  phase: "idle" | "processing" | "confirmed" | "settled";
  run: number;
};

export const initial: State = {
  scenario: 0,
  method: null,
  policy: "Balanced",
  excluded: [],
  phase: "idle",
  run: 0,
};

interface DirectItem {
  name: string;
  cost: "Low" | "Standard" | "Medium" | "Higher";
  time: string;
  reliability: string;
}

const DIRECT_PROVIDERS_MAP: Record<string, Record<string, DirectItem[]>> = {
  NG: {
    bank: [
      { name: "Guaranty Trust Bank (GTBank)", cost: "Low", time: "Instant push", reliability: "Direct bank API" },
      { name: "Zenith Bank", cost: "Low", time: "Instant push", reliability: "Direct bank API" },
      { name: "Access Bank", cost: "Standard", time: "< 3s push", reliability: "Direct bank API" },
    ],
    wallet: [
      { name: "OPay Wallet", cost: "Low", time: "Instant biometric", reliability: "Direct wallet API" },
      { name: "PalmPay Wallet", cost: "Low", time: "Instant biometric", reliability: "Direct wallet API" },
      { name: "Chipper Cash", cost: "Standard", time: "Instant push", reliability: "Direct wallet API" },
    ],
    mobile: [
      { name: "MTN MoMo PSB", cost: "Low", time: "Instant STK", reliability: "Direct telco API" },
      { name: "Airtel SmartCash PSB", cost: "Low", time: "Instant STK", reliability: "Direct telco API" },
      { name: "9PSB", cost: "Standard", time: "Instant push", reliability: "Direct clearing" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    binance_pay: [
      { name: "Binance Pay App", cost: "Low", time: "Instant off-chain", reliability: "Verified account" },
      { name: "Bybit Pay", cost: "Low", time: "Instant off-chain", reliability: "App push" },
      { name: "Bitget Pay", cost: "Standard", time: "Instant off-chain", reliability: "QR checkout" },
    ],
    ondo_usdy: [
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield note" },
      { name: "Paxos Gold (PAXG)", cost: "Standard", time: "Block finality", reliability: "LBMA vault backed" },
      { name: "Franklin Templeton BENJI", cost: "Standard", time: "On-chain settlement", reliability: "SEC-registered fund" },
    ],
    direct_debit: [
      { name: "NIBSS Direct Debit (Commercial Banks)", cost: "Low", time: "Scheduled mandate", reliability: "Interbank mandate" },
      { name: "Central Bank Auto-Debit", cost: "Standard", time: "Batch settlement", reliability: "Bank mandate" },
      { name: "Remita Mandate Network", cost: "Low", time: "Automated sweep", reliability: "Direct clearing" },
    ],
    cash_voucher: [
      { name: "Baxi POS Agent Network", cost: "Standard", time: "Cashier tender", reliability: "50,000+ agents" },
      { name: "Moniepoint Agent OTC", cost: "Standard", time: "Instant tender receipt", reliability: "100,000+ agents" },
      { name: "Quickteller Branch OTC", cost: "Higher", time: "Teller validated", reliability: "Bank counter" },
    ],
    bnpl: [
      { name: "CredPal Credit", cost: "Standard", time: "Real-time approval", reliability: "Split in 4" },
      { name: "Carbon Zero Installments", cost: "Low", time: "Zero interest", reliability: "Digital approval" },
      { name: "CDCare Installments", cost: "Standard", time: "Weekly plan", reliability: "Automated debit" },
    ],
  },
  US: {
    card: [
      { name: "Visa (Credit & Debit)", cost: "Standard", time: "Sub-second", reliability: "Direct network auth" },
      { name: "Mastercard", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
      { name: "American Express", cost: "Higher", time: "Instant auth", reliability: "Direct scheme" },
    ],
    ach: [
      { name: "ACH Direct Debit (US Banks)", cost: "Low", time: "1-2 business days", reliability: "Nacha direct" },
      { name: "Same-Day ACH Direct", cost: "Standard", time: "Same-day push", reliability: "Nacha direct" },
      { name: "Fedwire Direct Wire", cost: "Higher", time: "Real-time gross", reliability: "Federal Reserve Bank" },
    ],
    bank: [
      { name: "JPMorgan Chase (FedNow / RTP)", cost: "Low", time: "Instant push", reliability: "Direct bank API" },
      { name: "Bank of America (FedNow / RTP)", cost: "Low", time: "Instant push", reliability: "Direct bank API" },
      { name: "Wells Fargo (FedNow / RTP)", cost: "Standard", time: "< 3s push", reliability: "Direct bank API" },
    ],
    wallet: [
      { name: "Apple Pay", cost: "Standard", time: "Instant FaceID", reliability: "Direct biometric" },
      { name: "Google Pay", cost: "Standard", time: "Instant biometric", reliability: "Device tokenized" },
      { name: "Cash App Pay", cost: "Low", time: "Instant push", reliability: "Direct balance" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    binance_pay: [
      { name: "Coinbase Commerce", cost: "Low", time: "Instant confirmation", reliability: "Direct merchant account" },
      { name: "Kraken Pay", cost: "Low", time: "Instant off-chain", reliability: "Verified account" },
      { name: "Robinhood Connect", cost: "Standard", time: "In-app approval", reliability: "Direct balance" },
    ],
    ondo_usdy: [
      { name: "Ondo USDY (US Dollar Yield)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield" },
      { name: "Franklin Templeton BENJI", cost: "Standard", time: "On-chain settlement", reliability: "SEC-registered fund" },
      { name: "WisdomTree Prime Token", cost: "Standard", time: "Regulated clearing", reliability: "Treasury backed" },
    ],
    bnpl: [
      { name: "Affirm", cost: "Standard", time: "Real-time underwriting", reliability: "Split in 4 / monthly" },
      { name: "Klarna US", cost: "Standard", time: "Pay in 4", reliability: "Zero interest" },
      { name: "Afterpay", cost: "Standard", time: "Bi-weekly installments", reliability: "Instant approval" },
    ],
    cash_voucher: [
      { name: "PayNearMe at 7-Eleven", cost: "Standard", time: "Cashier barcode", reliability: "20,000+ stores" },
      { name: "CVS Pharmacy Cash OTC", cost: "Standard", time: "Instant receipt", reliability: "9,000+ locations" },
      { name: "Dollar General Cash Pay", cost: "Standard", time: "Cashier tender", reliability: "18,000+ stores" },
    ],
  },
  GB: {
    bank: [
      { name: "Barclays Bank (Faster Payments)", cost: "Low", time: "Instant push < 2s", reliability: "Direct Open Banking" },
      { name: "HSBC UK (Faster Payments)", cost: "Low", time: "Instant push < 2s", reliability: "Direct Open Banking" },
      { name: "Lloyds Bank (Faster Payments)", cost: "Standard", time: "Instant push < 2s", reliability: "Direct Open Banking" },
    ],
    card: [
      { name: "Visa UK", cost: "Standard", time: "Sub-second", reliability: "3DS2 liability shift" },
      { name: "Mastercard UK", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
      { name: "American Express UK", cost: "Higher", time: "Instant auth", reliability: "Direct network" },
    ],
    wallet: [
      { name: "Apple Pay UK", cost: "Standard", time: "Instant biometric", reliability: "Device tokenized" },
      { name: "Revolut Pay", cost: "Low", time: "Instant 1-click", reliability: "Direct account push" },
      { name: "Google Pay UK", cost: "Standard", time: "Instant biometric", reliability: "Tokenized" },
    ],
    direct_debit: [
      { name: "Bacs Direct Debit (Commercial Banks)", cost: "Low", time: "3 business days", reliability: "Direct bank mandate" },
      { name: "CHAPS High-Value Push", cost: "Higher", time: "Same-day gross", reliability: "Bank of England" },
      { name: "Standing Order Mandate", cost: "Low", time: "Regular bank push", reliability: "Automated clearing" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    bnpl: [
      { name: "Klarna UK", cost: "Standard", time: "Pay in 3", reliability: "Zero interest" },
      { name: "Clearpay (Afterpay)", cost: "Standard", time: "4 bi-weekly payments", reliability: "Instant approval" },
      { name: "Zilch (FCA Regulated)", cost: "Standard", time: "Tap to split", reliability: "FCA consumer credit" },
    ],
    binance_pay: [
      { name: "Binance Pay UK", cost: "Low", time: "Instant off-chain", reliability: "Verified account" },
      { name: "Revolut Crypto Checkout", cost: "Low", time: "Instant confirmation", reliability: "FCA-registered" },
      { name: "Kraken Pay UK", cost: "Standard", time: "Instant confirmation", reliability: "Account direct" },
    ],
    ondo_usdy: [
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "Yield-bearing asset" },
      { name: "Archax Tokenized UK Gilts", cost: "Standard", time: "Daily yield accrual", reliability: "HM Treasury backed" },
      { name: "Paxos Gold (PAXG)", cost: "Standard", time: "Block finality", reliability: "LBMA vault backed" },
    ],
    cash_voucher: [
      { name: "PayPoint Store Network", cost: "Standard", time: "Barcode at checkout", reliability: "28,000 UK stores" },
      { name: "Post Office Counter Cash", cost: "Standard", time: "Cashier validated", reliability: "11,500 branches" },
      { name: "Paysafecard Retail Vouchers", cost: "Higher", time: "16-digit PIN checkout", reliability: "Direct vouchers" },
    ],
  },
  BR: {
    pix: [
      { name: "Nubank (Pix Instantâneo)", cost: "Low", time: "Instant < 2s push", reliability: "Banco Central do Brasil" },
      { name: "Itaú Unibanco (Pix)", cost: "Low", time: "Instant < 2s push", reliability: "Banco Central do Brasil" },
      { name: "Banco Bradesco (Pix)", cost: "Standard", time: "Instant < 2s push", reliability: "Banco Central do Brasil" },
    ],
    bank: [
      { name: "Banco do Brasil (Pix / TED)", cost: "Low", time: "Instant push", reliability: "Direct central bank rail" },
      { name: "Banco Santander Brasil", cost: "Low", time: "Instant push", reliability: "Direct clearing" },
      { name: "Banco Inter (Pix 24/7)", cost: "Standard", time: "Instant push", reliability: "Direct clearing" },
    ],
    boleto: [
      { name: "Boleto Bancário (Caixa)", cost: "Low", time: "1 business day", reliability: "Federal bank barcode" },
      { name: "Boleto Flash (Bradesco)", cost: "Standard", time: "< 1 hr clearing", reliability: "Accelerated bank DDA" },
      { name: "Lotéricas da Caixa OTC", cost: "Standard", time: "Instant receipt", reliability: "13,000 lottery shops" },
    ],
    card: [
      { name: "Elo (Domestic Card Scheme)", cost: "Standard", time: "Sub-second", reliability: "130M+ Brazilian cards" },
      { name: "Visa Brasil", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
      { name: "Mastercard Brasil", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
    ],
    wallet: [
      { name: "Mercado Pago Carteira", cost: "Low", time: "Instant 1-tap", reliability: "QR & balance direct" },
      { name: "PicPay Carteira Digital", cost: "Low", time: "Instant push", reliability: "30M+ Brazilian users" },
      { name: "PagBank (PagSeguro)", cost: "Standard", time: "Instant confirmation", reliability: "Balance & cards" },
    ],
    bnpl: [
      { name: "Parcelamento sem juros (Itaú / Bradesco)", cost: "Standard", time: "Real-time authorization", reliability: "Issuer funded 12x" },
      { name: "Koin Boleto Parcelado", cost: "Standard", time: "Digital credit approval", reliability: "4x-24x installments" },
      { name: "Drip Parcelado Pix", cost: "Low", time: "Automated Pix debit", reliability: "Pay in 3x via Pix" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    binance_pay: [
      { name: "Binance Pay Brasil", cost: "Low", time: "Instant off-chain", reliability: "BRL direct conversion" },
      { name: "Mercado Bitcoin Pay", cost: "Low", time: "Instant confirmation", reliability: "Local regulation" },
      { name: "NovaDAX Pay", cost: "Standard", time: "Instant confirmation", reliability: "Account direct" },
    ],
    ondo_usdy: [
      { name: "Ondo USDY (Dólar com Rendimento)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield" },
      { name: "Recebíveis do Agronegócio (CRA Token)", cost: "Standard", time: "Regulated token", reliability: "Asset backed" },
      { name: "Paxos Gold (PAXG Brasil)", cost: "Standard", time: "Block finality", reliability: "LBMA gold backed" },
    ],
    mobile: [
      { name: "RecargaPay Mobile", cost: "Low", time: "Instant push", reliability: "Mobile balance direct" },
      { name: "Claro Pay Direct", cost: "Low", time: "Instant confirmation", reliability: "Telco mobile account" },
      { name: "Vivo Pay", cost: "Standard", time: "Instant confirmation", reliability: "Telefônica Brasil" },
    ],
  },
  EU: {
    sepa_instant: [
      { name: "BNP Paribas (SCT Inst)", cost: "Low", time: "Instant push < 3s", reliability: "Pan-European SCT Inst" },
      { name: "Deutsche Bank (SEPA Instant)", cost: "Low", time: "Instant push < 3s", reliability: "Pan-European SCT Inst" },
      { name: "ING Bank (SEPA Instant)", cost: "Standard", time: "Instant push < 3s", reliability: "Pan-European SCT Inst" },
    ],
    ideal: [
      { name: "Rabobank (iDEAL / Wero)", cost: "Low", time: "Instant bank push", reliability: "Direct bank API" },
      { name: "ABN AMRO (iDEAL / Wero)", cost: "Low", time: "Instant bank push", reliability: "Direct bank API" },
      { name: "ING Bank Netherlands", cost: "Standard", time: "Instant bank push", reliability: "Direct bank API" },
    ],
    bank: [
      { name: "BNP Paribas (SEPA Instant)", cost: "Low", time: "Instant push < 3s", reliability: "Pan-European SCT Inst" },
      { name: "Deutsche Bank (SEPA Instant)", cost: "Low", time: "Instant push < 3s", reliability: "Pan-European SCT Inst" },
      { name: "Crédit Agricole", cost: "Standard", time: "Instant push < 3s", reliability: "Direct clearing" },
    ],
    wallet: [
      { name: "PayPal Europe", cost: "Standard", time: "Instant 1-tap", reliability: "Direct wallet balance" },
      { name: "Apple Pay Europe", cost: "Standard", time: "Instant FaceID", reliability: "Direct biometric" },
      { name: "Wero (European Payments Initiative)", cost: "Low", time: "Instant A2A", reliability: "European bank wallet" },
    ],
    card: [
      { name: "Cartes Bancaires (CB France)", cost: "Low", time: "Sub-second", reliability: "Domestic scheme" },
      { name: "Girocard (German Domestic Scheme)", cost: "Low", time: "Sub-second", reliability: "100M+ German cards" },
      { name: "Visa & Mastercard Europe", cost: "Standard", time: "Sub-second", reliability: "3DS2 direct" },
    ],
    direct_debit: [
      { name: "SEPA Direct Debit SDD (Eurozone Banks)", cost: "Low", time: "1 business day", reliability: "EBA clearing direct" },
      { name: "SEPA B2B Direct Debit", cost: "Low", time: "Same-day clearing", reliability: "Non-refundable mandate" },
      { name: "EBA Interbank Mandate", cost: "Standard", time: "Automated mandate", reliability: "Direct clearing" },
    ],
    bnpl: [
      { name: "Klarna Rechnung", cost: "Standard", time: "Pay in 30 days", reliability: "Zero customer interest" },
      { name: "Scalapay Italy / France", cost: "Standard", time: "3 monthly payments", reliability: "Digital approval" },
      { name: "Alma BNPL", cost: "Standard", time: "Pay in 2x-4x", reliability: "Instant authorization" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    cash_voucher: [
      { name: "viacash / Barzahlen (Rewe, DM, Penny)", cost: "Standard", time: "Cashier barcode checkout", reliability: "12,000+ supermarkets" },
      { name: "Paysafecard Retail Vouchers", cost: "Higher", time: "16-digit PIN checkout", reliability: "Direct vouchers" },
      { name: "Supermarket OTC Cash Desk", cost: "Standard", time: "Instant tender receipt", reliability: "Retail network" },
    ],
    binance_pay: [
      { name: "Bitpanda Pay", cost: "Low", time: "Instant confirmation", reliability: "BaFin / FMA regulated" },
      { name: "Coinhouse Pay France", cost: "Low", time: "Instant confirmation", reliability: "AMF registered" },
      { name: "Binance Pay Europe", cost: "Standard", time: "Instant off-chain", reliability: "Verified account" },
    ],
    ondo_usdy: [
      { name: "eWpG Electronic Securities (Germany)", cost: "Standard", time: "Daily yield settlement", reliability: "German Electronic Securities" },
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield" },
      { name: "Paxos Gold (PAXG Europe)", cost: "Standard", time: "Block finality", reliability: "Allocated gold tokens" },
    ],
  },
  IN: {
    upi: [
      { name: "State Bank of India (UPI / IMPS)", cost: "Low", time: "Instant < 2s push", reliability: "NPCI direct rail" },
      { name: "HDFC Bank (UPI / IMPS)", cost: "Low", time: "Instant < 2s push", reliability: "NPCI direct rail" },
      { name: "ICICI Bank (UPI / IMPS)", cost: "Standard", time: "Instant < 2s push", reliability: "NPCI direct rail" },
    ],
    bank: [
      { name: "State Bank of India (IMPS / NEFT)", cost: "Low", time: "Instant push", reliability: "RBI direct rail" },
      { name: "HDFC Bank Direct", cost: "Low", time: "Instant push", reliability: "Direct bank API" },
      { name: "ICICI Bank Direct", cost: "Standard", time: "Instant push", reliability: "Direct bank API" },
    ],
    rupay: [
      { name: "RuPay Platinum (NPCI)", cost: "Low", time: "Sub-second", reliability: "Domestic card scheme" },
      { name: "RuPay Select (Direct Credit)", cost: "Standard", time: "Sub-second", reliability: "Domestic scheme" },
      { name: "RuPay Classic Debit", cost: "Low", time: "Sub-second", reliability: "Domestic scheme" },
    ],
    wallet: [
      { name: "PhonePe UPI Wallet", cost: "Low", time: "Instant biometric", reliability: "Direct UPI handle" },
      { name: "Google Pay (Tez)", cost: "Low", time: "Instant biometric", reliability: "Direct UPI push" },
      { name: "Paytm Payments Wallet", cost: "Standard", time: "Instant QR push", reliability: "Direct wallet" },
    ],
    direct_debit: [
      { name: "NACH e-Mandate (State Bank of India)", cost: "Low", time: "Automated clearing", reliability: "NPCI mandate" },
      { name: "HDFC Bank NACH Mandate", cost: "Low", time: "Automated clearing", reliability: "NPCI mandate" },
      { name: "ICICI Bank e-Mandate", cost: "Standard", time: "Automated clearing", reliability: "NPCI mandate" },
    ],
    bnpl: [
      { name: "Simpl 1-Tap Checkout", cost: "Low", time: "Pay in 15 days", reliability: "Direct underwriting" },
      { name: "LazyPay (PayU India)", cost: "Standard", time: "Instant credit line", reliability: "Digital approval" },
      { name: "ZestMoney EMI", cost: "Standard", time: "Monthly installments", reliability: "NBFC partner" },
    ],
    mobile: [
      { name: "Airtel Payments Bank", cost: "Low", time: "Instant mobile push", reliability: "Direct PSB account" },
      { name: "Jio Payments Bank", cost: "Low", time: "Instant mobile push", reliability: "Direct PSB account" },
      { name: "Paytm Payments Bank Rail", cost: "Standard", time: "Instant push", reliability: "Direct mobile bank" },
    ],
    cash_voucher: [
      { name: "India Post Digital COD", cost: "Standard", time: "Cash on delivery receipt", reliability: "Nationwide post network" },
      { name: "Ecom Express Cash Verification", cost: "Standard", time: "Instant courier receipt", reliability: "Delivery network" },
      { name: "Delhivery Digital COD", cost: "Standard", time: "Real-time OTP verification", reliability: "Logistics network" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    binance_pay: [
      { name: "FIU-IND Registered Binance Pay", cost: "Low", time: "Instant off-chain", reliability: "FIU compliant account" },
      { name: "CoinDCX Pay", cost: "Low", time: "Instant confirmation", reliability: "Direct INR crypto rail" },
      { name: "Mudrex Pay Gateway", cost: "Standard", time: "Instant confirmation", reliability: "Direct gateway" },
    ],
    ondo_usdy: [
      { name: "Digital Gold (MMTC-PAMP Token)", cost: "Low", time: "Block finality", reliability: "24K 999.9 pure gold" },
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield" },
      { name: "Sovereign Gold Bond Token", cost: "Standard", time: "Settlement clearing", reliability: "RBI backed scheme" },
    ],
  },
  KE: {
    mobile: [
      { name: "Safaricom M-Pesa STK Push", cost: "Low", time: "Instant STK prompt", reliability: "90%+ market share" },
      { name: "Airtel Money Kenya", cost: "Low", time: "Instant USSD prompt", reliability: "Direct telco API" },
      { name: "Equity Equitel SIM", cost: "Standard", time: "Instant push", reliability: "Direct banking SIM" },
    ],
    bank: [
      { name: "Equity Bank (Pesalink)", cost: "Low", time: "Instant interbank", reliability: "Pesalink direct" },
      { name: "KCB Bank (Pesalink)", cost: "Low", time: "Instant interbank", reliability: "Pesalink direct" },
      { name: "Co-operative Bank Kenya", cost: "Standard", time: "Instant push", reliability: "Pesalink direct" },
    ],
    wallet: [
      { name: "Chipper Cash Kenya", cost: "Low", time: "Instant push", reliability: "Direct wallet API" },
      { name: "PesaPal Digital Wallet", cost: "Standard", time: "Instant push", reliability: "Direct wallet" },
      { name: "JumiaPay Kenya", cost: "Standard", time: "Instant confirmation", reliability: "Ecosystem wallet" },
    ],
    card: [
      { name: "Visa Kenya (Credit & Debit)", cost: "Standard", time: "Sub-second", reliability: "3DS enabled" },
      { name: "Mastercard Kenya", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
      { name: "Equity Bank Card Direct", cost: "Low", time: "Sub-second", reliability: "Direct issuer" },
    ],
    direct_debit: [
      { name: "KEPSS RTGS Clearing", cost: "Standard", time: "Same-day settlement", reliability: "Central Bank of Kenya" },
      { name: "Direct Debit Mandate Kenya", cost: "Low", time: "1 business day", reliability: "Interbank mandate" },
      { name: "Pesalink Scheduled Pull", cost: "Low", time: "Real-time mandate", reliability: "Automated clearing" },
    ],
    bnpl: [
      { name: "Lipa Later", cost: "Standard", time: "Monthly installments", reliability: "Direct credit line" },
      { name: "Aspira Kenya", cost: "Standard", time: "Split payments", reliability: "Digital approval" },
      { name: "Crediation Small Split", cost: "Low", time: "Real-time underwriting", reliability: "Zero customer interest" },
    ],
    cash_voucher: [
      { name: "Equity Agent OTC Network", cost: "Standard", time: "Cashier tender", reliability: "50,000+ agents" },
      { name: "KCB Mtaani Agency", cost: "Standard", time: "Instant tender receipt", reliability: "40,000+ agents" },
      { name: "Co-op Kwa Jirani Counter", cost: "Standard", time: "Teller receipt", reliability: "30,000+ agents" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    binance_pay: [
      { name: "Binance Pay Kenya", cost: "Low", time: "Instant off-chain", reliability: "Verified account" },
      { name: "Bitnob Pay App", cost: "Low", time: "Instant push", reliability: "Direct Bitcoin & stablecoin" },
      { name: "Yellow Card Pay", cost: "Standard", time: "Instant confirmation", reliability: "Direct merchant account" },
    ],
    ondo_usdy: [
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "USD inflation hedge (5%+)" },
      { name: "Paxos Gold (PAXG Kenya)", cost: "Standard", time: "Block finality", reliability: "LBMA allocated gold" },
      { name: "Franklin Templeton BENJI", cost: "Standard", time: "On-chain settlement", reliability: "US Treasury money fund" },
    ],
  },
  JP: {
    jcb: [
      { name: "JCB Card (Domestic Scheme)", cost: "Standard", time: "Sub-second", reliability: "150M+ JCB cards" },
      { name: "JCB Gold Direct", cost: "Standard", time: "Sub-second", reliability: "Direct scheme auth" },
      { name: "JCB Contactless Pay", cost: "Low", time: "Instant NFC", reliability: "Direct contactless" },
    ],
    konbini: [
      { name: "7-Eleven Convenience Store Cash", cost: "Standard", time: "Real-time barcode", reliability: "21,000+ stores" },
      { name: "Lawson Loppi Cash Counter", cost: "Standard", time: "Loppi kiosk ticket", reliability: "14,000+ stores" },
      { name: "FamilyMart FamiPort Cash", cost: "Standard", time: "FamiPort kiosk ticket", reliability: "16,000+ stores" },
    ],
    bank: [
      { name: "Mitsubishi UFJ Bank (Zengin 24/7)", cost: "Low", time: "Instant push", reliability: "Zengin 7th gen rail" },
      { name: "Sumitomo Mitsui Banking (SMBC)", cost: "Low", time: "Instant push", reliability: "Zengin 7th gen rail" },
      { name: "Mizuho Bank (Zengin 24/7)", cost: "Standard", time: "Instant push", reliability: "Direct clearing" },
    ],
    wallet: [
      { name: "PayPay (60M+ Users)", cost: "Low", time: "Instant QR / 1-tap", reliability: "SoftBank / Yahoo direct" },
      { name: "LINE Pay", cost: "Low", time: "Instant in-app push", reliability: "Direct messaging wallet" },
      { name: "Rakuten Pay", cost: "Standard", time: "Instant biometric", reliability: "Rakuten ecosystem" },
    ],
    direct_debit: [
      { name: "Kouza Furikae Auto-Debit (Bank Direct)", cost: "Low", time: "Scheduled mandate", reliability: "Japanese interbank auto-debit" },
      { name: "Japan Post Bank Kouza Furikae", cost: "Low", time: "Scheduled mandate", reliability: "Nationwide postal mandate" },
      { name: "Internet Bank Direct Debit", cost: "Standard", time: "Automated pull", reliability: "Direct clearing" },
    ],
    bnpl: [
      { name: "Paidy SMS Checkout", cost: "Standard", time: "Pay next month via SMS", reliability: "Instant phone approval" },
      { name: "Atome Japan", cost: "Standard", time: "3 monthly payments", reliability: "Zero interest" },
      { name: "Net Protections NP Atobarai", cost: "Standard", time: "Post-pay invoice", reliability: "Established credit" },
    ],
    mobile: [
      { name: "SoftBank Carrier Billing", cost: "Low", time: "Added to phone bill", reliability: "Direct carrier auth" },
      { name: "NTT Docomo d-Barai", cost: "Low", time: "Carrier invoice push", reliability: "Direct carrier auth" },
      { name: "au by KDDI Kantan Kessai", cost: "Standard", time: "Carrier invoice push", reliability: "Direct carrier auth" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    binance_pay: [
      { name: "bitFlyer Pay", cost: "Low", time: "Instant off-chain", reliability: "JFSA licensed exchange" },
      { name: "Coincheck Pay", cost: "Low", time: "Instant confirmation", reliability: "JFSA licensed exchange" },
      { name: "Binance Japan Pay", cost: "Standard", time: "Instant off-chain", reliability: "Compliant local entity" },
    ],
    ondo_usdy: [
      { name: "Progmat Security Token (MUFG)", cost: "Standard", time: "On-chain bond settlement", reliability: "Regulated tokenized securities" },
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield asset" },
      { name: "Paxos Gold (PAXG Japan)", cost: "Standard", time: "Block finality", reliability: "Physical gold allocated" },
    ],
  },
  SG: {
    bank: [
      { name: "DBS / POSB (PayNow & FAST)", cost: "Low", time: "Instant push < 2s", reliability: "MAS direct rail" },
      { name: "OCBC Bank (PayNow & FAST)", cost: "Low", time: "Instant push < 2s", reliability: "MAS direct rail" },
      { name: "United Overseas Bank (UOB)", cost: "Standard", time: "Instant push < 2s", reliability: "MAS direct rail" },
    ],
    wallet: [
      { name: "GrabPay Wallet", cost: "Low", time: "Instant 1-tap", reliability: "Direct ecosystem wallet" },
      { name: "ShopeePay Singapore", cost: "Low", time: "Instant push", reliability: "Sea group wallet" },
      { name: "Singtel Dash Wallet", cost: "Standard", time: "Instant biometric", reliability: "Telco wallet" },
    ],
    card: [
      { name: "NETS Domestic Debit", cost: "Low", time: "Sub-second", reliability: "Singapore domestic scheme" },
      { name: "Visa Singapore", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
      { name: "Mastercard Singapore", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
    ],
    direct_debit: [
      { name: "GIRO Interbank Direct Debit", cost: "Low", time: "Scheduled clearing", reliability: "ABS interbank mandate" },
      { name: "MEPS+ Real-Time Gross", cost: "Higher", time: "Real-time settlement", reliability: "Monetary Authority of Singapore" },
      { name: "Fast Standing Order Mandate", cost: "Low", time: "Instant push schedule", reliability: "Automated clearing" },
    ],
    bnpl: [
      { name: "Atome Singapore", cost: "Standard", time: "3 monthly payments", reliability: "Zero interest" },
      { name: "GrabPayLater", cost: "Standard", time: "Pay next month / 4 splits", reliability: "Direct grab app" },
      { name: "ShopBack PayLater", cost: "Standard", time: "Split in 3", reliability: "Instant approval" },
    ],
    cash_voucher: [
      { name: "AXS Kiosk Network (7-Eleven)", cost: "Standard", time: "Barcode payment", reliability: "1,000+ kiosks & stores" },
      { name: "Cheers Convenience Store Cash", cost: "Standard", time: "Instant cashier tender", reliability: "Nationwide counters" },
      { name: "SAM Post Kiosks (SingPost)", cost: "Standard", time: "Real-time terminal receipt", reliability: "Postal network" },
    ],
    mobile: [
      { name: "Singtel Dash Mobile Push", cost: "Low", time: "Direct mobile debit", reliability: "Singtel direct" },
      { name: "StarHub Mobile Pay", cost: "Low", time: "Direct carrier billing", reliability: "Direct carrier auth" },
      { name: "M1 Mobile Billing", cost: "Standard", time: "Carrier invoice", reliability: "Direct carrier auth" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    binance_pay: [
      { name: "Crypto.com Pay (MPI Licensed)", cost: "Low", time: "Instant confirmation", reliability: "MAS licensed entity" },
      { name: "Coinhako Pay", cost: "Low", time: "Instant confirmation", reliability: "MAS licensed broker" },
      { name: "Binance Pay App", cost: "Standard", time: "Instant off-chain", reliability: "Verified account" },
    ],
    ondo_usdy: [
      { name: "Project Guardian Tokenized Assets", cost: "Standard", time: "MAS pilot settlement", reliability: "Institutional grade" },
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield" },
      { name: "ADDX Digital Securities", cost: "Standard", time: "Regulated exchange clearing", reliability: "MAS recognized market" },
    ],
  },
  MX: {
    spei: [
      { name: "BBVA México (SPEI 24/7)", cost: "Low", time: "Instant < 3s push", reliability: "Banco de México direct" },
      { name: "Banorte (SPEI 24/7)", cost: "Low", time: "Instant < 3s push", reliability: "Banco de México direct" },
      { name: "Santander México (SPEI)", cost: "Standard", time: "Instant < 3s push", reliability: "Direct clearing" },
    ],
    oxxo: [
      { name: "OXXO Pay (20,000+ Stores)", cost: "Standard", time: "Real-time cashier barcode", reliability: "Instant tender receipt" },
      { name: "7-Eleven México Cash OTC", cost: "Standard", time: "Real-time tender", reliability: "2,000+ stores" },
      { name: "Farmacias del Ahorro Cash", cost: "Standard", time: "Real-time tender", reliability: "1,500+ branches" },
    ],
    bank: [
      { name: "SPEI Interbancario (Banco de México)", cost: "Low", time: "Instant 24/7 push", reliability: "Banxico direct rail" },
      { name: "BBVA México Direct", cost: "Low", time: "Instant push", reliability: "Direct bank API" },
      { name: "Citibanamex Direct", cost: "Standard", time: "Instant push", reliability: "Direct clearing" },
    ],
    wallet: [
      { name: "Mercado Pago México", cost: "Low", time: "Instant 1-tap", reliability: "Direct wallet balance" },
      { name: "Spin by OXXO", cost: "Low", time: "Instant cash & digital", reliability: "OXXO ecosystem" },
      { name: "PayPal México", cost: "Standard", time: "Instant biometric", reliability: "Direct balance" },
    ],
    card: [
      { name: "Carnet (Domestic Card Scheme)", cost: "Low", time: "Sub-second", reliability: "Domestic scheme" },
      { name: "Visa México", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
      { name: "Mastercard México", cost: "Standard", time: "Sub-second", reliability: "Tokenized direct" },
    ],
    bnpl: [
      { name: "Kueski Pay (No Card Required)", cost: "Standard", time: "Bi-weekly installments", reliability: "Real-time approval" },
      { name: "Meses Sin Intereses (MSI Direct)", cost: "Low", time: "3-12 monthly payments", reliability: "Issuer funded" },
      { name: "Aplazo México", cost: "Standard", time: "Split in 5 fortnights", reliability: "Digital credit line" },
    ],
    direct_debit: [
      { name: "Domiciliación Bancaria (Banxico)", cost: "Low", time: "Scheduled mandate", reliability: "Banco de México mandate" },
      { name: "CLABE Domiciliada Recurrente", cost: "Low", time: "Batch settlement", reliability: "Direct bank mandate" },
      { name: "SPEI Domiciliación Automatizada", cost: "Standard", time: "Same-day push", reliability: "Direct clearing" },
    ],
    mobile: [
      { name: "Telcel Carrier Billing", cost: "Low", time: "Added to mobile bill", reliability: "Direct América Móvil" },
      { name: "AT&T México Billing", cost: "Low", time: "Carrier invoice push", reliability: "Direct carrier auth" },
      { name: "Movistar México Direct", cost: "Standard", time: "Carrier invoice", reliability: "Telefônica direct" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    binance_pay: [
      { name: "Bitso Pay", cost: "Low", time: "Instant off-chain", reliability: "Local licensed entity" },
      { name: "Binance Pay México", cost: "Low", time: "Instant off-chain", reliability: "Verified account" },
      { name: "Tauros Pay", cost: "Standard", time: "Instant confirmation", reliability: "Direct gateway" },
    ],
    ondo_usdy: [
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield hedge" },
      { name: "CetesDirecto Tokenized Treasury", cost: "Standard", time: "Daily yield accrual", reliability: "Government debt backing" },
      { name: "Paxos Gold (PAXG México)", cost: "Standard", time: "Block finality", reliability: "Allocated gold tokens" },
    ],
  },
  GLOBAL: {
    binance_pay: [
      { name: "Binance Pay App", cost: "Low", time: "Instant off-chain", reliability: "Direct exchange balance" },
      { name: "Coinbase Commerce", cost: "Low", time: "Instant confirmation", reliability: "Direct merchant gateway" },
      { name: "OKX Pay App", cost: "Standard", time: "Instant off-chain", reliability: "Direct account push" },
    ],
    ondo_usdy: [
      { name: "Ondo USDY (Yield Note)", cost: "Low", time: "On-chain finality", reliability: "5%+ USD yield note" },
      { name: "Franklin Templeton BENJI Fund", cost: "Standard", time: "On-chain settlement", reliability: "US Govt money fund" },
      { name: "Paxos Gold (PAXG Allocated)", cost: "Standard", time: "Block finality", reliability: "Physical gold allocated" },
    ],
    bank: [
      { name: "JPMorgan Chase Global Clearing", cost: "Standard", time: "Same-day wire", reliability: "Direct commercial clearing" },
      { name: "HSBC International Wire", cost: "Standard", time: "Direct cross-border", reliability: "Multi-currency direct" },
      { name: "Deutsche Bank SWIFT gpi", cost: "Higher", time: "SWIFT gpi push", reliability: "Direct correspondent" },
    ],
    wallet: [
      { name: "Apple Pay Global", cost: "Standard", time: "Instant FaceID", reliability: "Direct biometric" },
      { name: "Google Pay Global", cost: "Standard", time: "Instant biometric", reliability: "Device tokenized" },
      { name: "PayPal International", cost: "Standard", time: "Instant 1-tap", reliability: "Global balance & cards" },
    ],
    card: [
      { name: "Visa Global Scheme", cost: "Standard", time: "Sub-second", reliability: "Global 3DS2 auth" },
      { name: "Mastercard Global", cost: "Standard", time: "Sub-second", reliability: "Global tokenized auth" },
      { name: "American Express Worldwide", cost: "Higher", time: "Instant auth", reliability: "Direct network" },
    ],
    stablecoins: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    usdc: [
      { name: "Avalanche C-Chain (Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Base (Native Circle USDC)", cost: "Low", time: "Sub-second", reliability: "Circle Mint direct" },
      { name: "Solana (SPL Circle USDC)", cost: "Low", time: "< 1s finality", reliability: "High throughput" },
    ],
    bnpl: [
      { name: "Klarna Global", cost: "Standard", time: "Pay in 3/4", reliability: "International BNPL" },
      { name: "Affirm Cross-Border", cost: "Standard", time: "Monthly installments", reliability: "Digital credit approval" },
      { name: "Afterpay Worldwide", cost: "Standard", time: "Bi-weekly installments", reliability: "Instant approval" },
    ],
    direct_debit: [
      { name: "SWIFT International Direct Debit", cost: "Standard", time: "1-2 business days", reliability: "Direct correspondent mandate" },
      { name: "SEPA B2B Mandate", cost: "Low", time: "Same-day clearing", reliability: "Direct clearing" },
      { name: "US Federal ACH International", cost: "Low", time: "1 business day", reliability: "Nacha direct" },
    ],
  },
};

export const ALL_DIRECT_INSTITUTIONS_MAP: Record<string, Record<string, string[]>> = {
  NG: {
    bank: [
      "Guaranty Trust Bank (GTBank)",
      "Zenith Bank",
      "Access Bank",
      "First Bank of Nigeria",
      "United Bank for Africa (UBA)",
      "Kuda Bank",
      "Moniepoint MFB",
      "Stanbic IBTC Bank",
      "Sterling Bank",
      "Wema Bank (ALAT)",
    ],
    wallet: [
      "OPay Wallet",
      "PalmPay",
      "Chipper Cash",
      "PocketApp (Piggyvest)",
      "Kuda Wallet",
      "Gomoney",
    ],
    mobile: [
      "MTN MoMo PSB",
      "Airtel SmartCash PSB",
      "9PSB",
      "Hope PSB",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    binance_pay: [
      "Binance Pay App",
      "Bybit Pay",
      "Bitget Pay",
      "OKX Pay",
      "KuCoin Pay",
    ],
    ondo_usdy: [
      "Ondo USDY (Yield Note)",
      "Paxos Gold (PAXG)",
      "Franklin Templeton BENJI",
      "Backed bIB01",
    ],
    direct_debit: [
      "NIBSS Direct Debit (Commercial Banks)",
      "Central Bank Auto-Debit",
      "Remita Mandate Network",
    ],
    cash_voucher: [
      "Baxi POS Agent Network",
      "Moniepoint Agent OTC",
      "Quickteller Branch OTC",
      "Paga Agent Network",
    ],
    bnpl: [
      "CredPal Credit",
      "Carbon Zero Installments",
      "CDCare Installments",
      "FairMoney PayLater",
    ],
  },
  US: {
    card: [
      "Visa Network Direct",
      "Mastercard Direct",
      "American Express Direct",
      "Discover Financial",
    ],
    ach: [
      "ACH Direct Debit (US Banks)",
      "Same-Day ACH Direct",
      "Fedwire Real-Time Wire",
    ],
    bank: [
      "JPMorgan Chase",
      "Bank of America",
      "Wells Fargo",
      "Citibank",
      "U.S. Bank",
      "Capital One",
      "PNC Bank",
      "Truist Financial",
    ],
    wallet: [
      "Apple Pay",
      "Google Pay",
      "Cash App Pay",
      "Venmo",
      "PayPal",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    binance_pay: [
      "Coinbase Commerce",
      "Kraken Pay",
      "Robinhood Connect",
      "Gemini Pay",
    ],
    ondo_usdy: [
      "Ondo USDY (US Dollar Yield)",
      "Franklin Templeton BENJI",
      "WisdomTree Prime Token",
      "Hashnote USYC",
    ],
    bnpl: [
      "Affirm",
      "Klarna US",
      "Afterpay",
      "Sezzle",
    ],
    cash_voucher: [
      "PayNearMe at 7-Eleven",
      "CVS Pharmacy Cash OTC",
      "Dollar General Cash Pay",
      "Family Dollar Cash",
    ],
  },
  GB: {
    bank: [
      "Barclays",
      "HSBC UK",
      "Lloyds Bank",
      "NatWest",
      "Santander UK",
      "Monzo Bank",
      "Starling Bank",
      "Revolut UK",
    ],
    card: [
      "Visa UK Direct",
      "Mastercard UK Direct",
      "American Express UK",
    ],
    wallet: [
      "Apple Pay UK",
      "Revolut Pay",
      "Google Pay UK",
      "PayPal UK",
    ],
    direct_debit: [
      "Bacs Direct Debit",
      "CHAPS Same-Day Push",
      "Standing Order Mandate",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    bnpl: [
      "Klarna UK",
      "Clearpay (Afterpay)",
      "Zilch (FCA Regulated)",
      "Monzo Flex",
    ],
    binance_pay: [
      "Binance Pay UK",
      "Revolut Crypto Checkout",
      "Kraken Pay UK",
      "Crypto.com Pay",
    ],
    ondo_usdy: [
      "Ondo USDY (Yield Note)",
      "Tokenized UK Gilts",
      "Paxos Gold (PAXG)",
    ],
    cash_voucher: [
      "PayPoint (28,000 Stores)",
      "Post Office Cash Service",
      "Payzone Agent Counters",
    ],
  },
  BR: {
    pix: [
      "Nubank",
      "Itaú Unibanco",
      "Banco Bradesco",
      "Banco do Brasil",
      "Santander Brasil",
      "Caixa Econômica Federal",
      "Banco Inter",
      "C6 Bank",
    ],
    bank: [
      "Nubank",
      "Itaú Unibanco",
      "Banco Bradesco",
      "Banco do Brasil",
      "Santander Brasil",
      "Caixa Econômica Federal",
      "Banco Inter",
      "C6 Bank",
    ],
    boleto: [
      "Boleto Bancário Registrado",
      "Boleto Flash / Lotérica",
      "Caixa Econômica Boleto",
      "Banco do Brasil Boleto",
    ],
    card: [
      "Elo Card Scheme",
      "Nubank Mastercard",
      "Itaú Visa",
      "Bradesco Elo",
      "Hipercard",
    ],
    wallet: [
      "Mercado Pago",
      "PicPay",
      "RecargaPay",
      "Ame Digital",
      "PagBank",
    ],
    bnpl: [
      "Parcelamento no Cartão (12x)",
      "Mercado Crédito",
      "Koin Parcelado",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    binance_pay: [
      "Binance Pay Brazil",
      "Bitso Pay Brazil",
      "Mercado Bitcoin Pay",
    ],
    ondo_usdy: [
      "Ondo USDY Token",
      "Tokenized Agribusiness Notes (CPR)",
      "Liqi Tokenized Assets",
    ],
    mobile: [
      "Vivo Pay",
      "Claro Pay",
      "TIM Brasil",
    ],
  },
  EU: {
    sepa_instant: [
      "BNP Paribas",
      "Deutsche Bank",
      "ING Bank",
      "Banco Santander",
      "Crédit Agricole",
      "Intesa Sanpaolo",
      "BBVA",
      "ABN AMRO",
      "Rabobank",
      "Revolut EU",
    ],
    ideal: [
      "ING Bank",
      "Rabobank",
      "ABN AMRO",
      "de Volksbank",
      "ASN Bank",
      "RegioBank",
      "Triodos Bank",
    ],
    bank: [
      "BNP Paribas",
      "Deutsche Bank",
      "ING Bank",
      "Banco Santander",
      "Crédit Agricole",
      "Intesa Sanpaolo",
      "BBVA",
      "ABN AMRO",
      "Rabobank",
      "Revolut EU",
    ],
    wallet: [
      "PayPal",
      "Apple Pay EU",
      "Google Pay EU",
      "Wero (European Payments Initiative)",
      "Payconiq",
    ],
    card: [
      "Girocard Germany",
      "Carte Bancaire (CB) France",
      "BNP Paribas Visa",
      "Santander Mastercard",
    ],
    direct_debit: [
      "SEPA Direct Debit (Core SDD)",
      "SEPA B2B Direct Debit",
      "SDD Tier-1 Clearing",
    ],
    bnpl: [
      "Klarna Rechnung",
      "Alma Pay France",
      "Riverty (AfterPay EU)",
      "Scalapay Italy",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    cash_voucher: [
      "viacash / Barzahlen (12,000 Retailers)",
      "Paysafecard OTC",
      "Penny / Rewe Cash Pay",
    ],
    binance_pay: [
      "Bitpanda Pay",
      "Binance Pay EU",
      "Kraken Pay EU",
    ],
    ondo_usdy: [
      "eWpG Tokenized Securities",
      "Ondo USDY (MiCA Compliant)",
      "Siemens Bond on Polygon",
    ],
  },
  IN: {
    upi: [
      "State Bank of India (SBI)",
      "HDFC Bank",
      "ICICI Bank",
      "Axis Bank",
      "Kotak Mahindra Bank",
      "Punjab National Bank",
      "Bank of Baroda",
      "IndusInd Bank",
    ],
    bank: [
      "State Bank of India (SBI)",
      "HDFC Bank",
      "ICICI Bank",
      "Axis Bank",
      "Kotak Mahindra Bank",
      "Punjab National Bank",
      "Bank of Baroda",
      "IndusInd Bank",
    ],
    rupay: [
      "RuPay Credit on UPI",
      "RuPay Platinum Debit",
      "RuPay Select",
    ],
    wallet: [
      "PhonePe",
      "Google Pay (Tez)",
      "Paytm Wallet",
      "Amazon Pay India",
      "CRED UPI",
    ],
    direct_debit: [
      "NACH e-Mandate Direct Debit",
      "NPCI UPI AutoPay Mandate",
      "e-Sign Direct Mandate",
    ],
    bnpl: [
      "Simpl 1-Tap Checkout",
      "LazyPay Installments",
      "Flipkart Pay Later",
      "Amazon Pay Later",
    ],
    mobile: [
      "Airtel Payments Bank",
      "Jio Payments Bank",
      "India Post Payments Bank (IPPB)",
    ],
    cash_voucher: [
      "Digital COD (Cash on Delivery)",
      "India Post OTC Collection",
      "CSC Rural Vouchers",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    binance_pay: [
      "FIU-Registered Binance Pay",
      "Mudrex Pay",
      "ZebPay Direct",
    ],
    ondo_usdy: [
      "Digital Gold (MMTC-PAMP)",
      "Ondo USDY Cross-Border",
      "Sovereign Gold Bonds (RBI)",
    ],
  },
  KE: {
    mobile: [
      "Safaricom M-Pesa STK Push",
      "Airtel Money Kenya",
      "Telkom T-Kash",
    ],
    bank: [
      "Equity Bank (Pesalink)",
      "KCB Bank Kenya",
      "Co-operative Bank",
      "NCBA Bank",
      "Standard Chartered Kenya",
      "Absa Bank Kenya",
    ],
    wallet: [
      "Chipper Cash Kenya",
      "Safaricom M-Pesa App",
      "Kraken Mobile",
    ],
    card: [
      "Equity Visa Card",
      "KCB Mastercard",
      "Standard Chartered Visa",
    ],
    direct_debit: [
      "KEPSS Real-Time Clearing",
      "Central Bank EFT Mandate",
      "Pesalink Direct Mandate",
    ],
    bnpl: [
      "Lipa Later",
      "Aspira Kenya",
      "Kopo Kopo Installments",
    ],
    cash_voucher: [
      "Equity Agent OTC (40,000+ Agents)",
      "KCB Mtaani Agent Network",
      "Posta Kenya Counters",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    binance_pay: [
      "Binance Pay Kenya",
      "Bybit Kenya Pay",
      "Paxful Direct Checkout",
    ],
    ondo_usdy: [
      "Ondo USDY Yield Token",
      "Tokenized Treasury Bills",
      "M-Akiba Retail Bond",
    ],
  },
  JP: {
    jcb: [
      "JCB Domestic Scheme",
      "Rakuten JCB Card",
      "Mitsui Sumitomo Card",
      "EPOS Card",
    ],
    konbini: [
      "7-Eleven Konbini Pay",
      "Lawson Loppi Cash",
      "FamilyMart FamiPort Cash",
      "Ministop Loppi",
    ],
    bank: [
      "MUFG Bank (Mitsubishi UFJ)",
      "Sumitomo Mitsui Banking (SMBC)",
      "Mizuho Bank",
      "Japan Post Bank (Yucho)",
      "Resona Bank",
      "Rakuten Bank",
      "SBI Sumishin Net Bank",
    ],
    wallet: [
      "PayPay (60M+ Users)",
      "LINE Pay",
      "Rakuten Pay",
      "d Barai (NTT DoCoMo)",
      "au PAY (KDDI)",
    ],
    direct_debit: [
      "Kouza Furikae (Direct Account Transfer)",
      "Pay-easy Clearing",
      "Bank Net Transfer",
    ],
    bnpl: [
      "Paidy (SMS Verification)",
      "NP After Delivery (NP Koubarai)",
      "Atome Japan",
    ],
    mobile: [
      "SoftBank Carrier Billing",
      "NTT DoCoMo Keitai Barai",
      "au Simple Payment",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    binance_pay: [
      "bitFlyer Pay",
      "Binance Japan Pay",
      "Coincheck Payment",
    ],
    ondo_usdy: [
      "Progmat Tokenized Securities",
      "BOOSTRY Security Tokens",
      "Ondo USDY Yield",
    ],
  },
  SG: {
    bank: [
      "DBS Bank (PayNow & FAST)",
      "OCBC Bank (FAST)",
      "UOB (United Overseas Bank)",
      "Standard Chartered SG",
      "Citibank Singapore",
      "HSBC Singapore",
    ],
    wallet: [
      "GrabPay",
      "ShopeePay Singapore",
      "DBS PayLah!",
      "Singtel Dash",
      "FavePay",
    ],
    card: [
      "NETS Domestic FlashPay & Debit",
      "DBS Visa Card",
      "UOB One Card",
      "OCBC 365 Card",
    ],
    direct_debit: [
      "Interbank GIRO Mandate",
      "MEPS+ Real-Time Gross",
      "Direct Debit Authorization (DDA)",
    ],
    bnpl: [
      "Atome Singapore",
      "GrabPayLater",
      "ShopBack PayLater",
    ],
    cash_voucher: [
      "AXS Payment Kiosks",
      "7-Eleven Cash Counters",
      "Cheers Retail Outlets",
    ],
    mobile: [
      "Singtel Dash Mobile",
      "StarHub Direct Billing",
      "M1 Carrier Pay",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    binance_pay: [
      "Crypto.com Pay Singapore",
      "Coinhako Direct Pay",
      "Binance Pay Global",
    ],
    ondo_usdy: [
      "Project Guardian Tokenized Funds",
      "Ondo USDY Note",
      "ADDX Private Credit",
    ],
  },
  MX: {
    spei: [
      "BBVA México (SPEI 24/7)",
      "Banorte (SPEI)",
      "Santander México",
      "Citibanamex",
      "HSBC México",
      "Scotiabank México",
      "Banco Azteca",
      "Inbursa",
    ],
    oxxo: [
      "OXXO Pay (20,000+ Stores)",
      "7-Eleven PayNet México",
      "Farmacias del Ahorro Cash",
      "Circle K PayNet",
    ],
    bank: [
      "BBVA México (SPEI 24/7)",
      "Banorte (SPEI)",
      "Santander México",
      "Citibanamex",
      "HSBC México",
      "Scotiabank México",
      "Banco Azteca",
      "Inbursa",
    ],
    wallet: [
      "Mercado Pago México",
      "Spin by OXXO",
      "PayPal México",
      "Didi Pay",
      "Bazu",
    ],
    card: [
      "Carnet Scheme",
      "BBVA Visa Card",
      "Banorte Mastercard",
      "Santander Fiesta Rewards",
    ],
    bnpl: [
      "Kueski Pay",
      "Meses Sin Intereses (MSI)",
      "Aplazo",
      "Klar Crédito",
    ],
    direct_debit: [
      "Domiciliación Bancaria Directa",
      "SPEI Recurrente",
      "Mandato Interbancario",
    ],
    mobile: [
      "Telcel Carrier Billing",
      "AT&T Conecta México",
      "Movistar Pago Directo",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    binance_pay: [
      "Bitso Pay",
      "Binance Pay México",
      "Bybit Pay LatAm",
    ],
    ondo_usdy: [
      "Ondo USDY Yield Note",
      "Tokenized CETES (Mexican Treasury)",
      "Paxos Gold (PAXG)",
    ],
  },
  GLOBAL: {
    binance_pay: [
      "Binance Pay Global",
      "Coinbase Commerce",
      "Kraken Pay",
      "Bybit Pay",
      "OKX Pay",
    ],
    ondo_usdy: [
      "Ondo USDY Yield Note",
      "Franklin Templeton BENJI",
      "Paxos Gold (PAXG)",
      "WisdomTree Prime Token",
    ],
    bank: [
      "JPMorgan Chase Direct Wire",
      "HSBC Global Payments",
      "Barclays International",
      "Deutsche Bank Trust",
      "Standard Chartered Global",
      "Citigroup Direct",
    ],
    wallet: [
      "Apple Pay Global",
      "Google Pay Global",
      "PayPal International",
      "Revolut Pay Global",
    ],
    card: [
      "Visa Global Scheme",
      "Mastercard Worldwide",
      "American Express Direct",
      "UnionPay International",
    ],
    stablecoins: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    usdc: [
      "Avalanche C-Chain (Circle USDC)",
      "Base (Native Circle USDC)",
      "Solana (SPL Circle USDC)",
      "Ethereum (ERC-20 Circle USDC)",
      "Arbitrum One (Circle USDC)",
      "Polygon PoS (Circle USDC)",
      "Circle Mint Direct",
    ],
    bnpl: [
      "Klarna Global",
      "Affirm Cross-Border",
      "Afterpay Worldwide",
    ],
    direct_debit: [
      "SWIFT International Direct Debit",
      "SEPA B2B Mandate",
      "US Federal ACH International",
    ],
  },
};

export function getAllDirectProviders(scenarioId: string, methodId: string): string[] {
  const list = ALL_DIRECT_INSTITUTIONS_MAP[scenarioId]?.[methodId];
  if (list && list.length > 0) return list;
  const custom = DIRECT_PROVIDERS_MAP[scenarioId]?.[methodId];
  if (custom && custom.length > 0) return custom.map((c) => c.name);
  return ["Primary Direct Institution", "Secondary Direct Institution", "Regional Direct Institution"];
}

export function getDirectProviderCategoryName(methodId: string): string {
  switch (methodId) {
    case "bank":
      return "banks";
    case "pix":
      return "banks & PIX participants";
    case "upi":
      return "banks & UPI PSPs";
    case "spei":
      return "banks & SPEI participants";
    case "sepa_instant":
    case "ideal":
      return "banks & SEPA participants";
    case "wallet":
      return "digital wallets";
    case "mobile":
      return "mobile money operators";
    case "card":
    case "rupay":
    case "jcb":
      return "card issuers & schemes";
    case "stablecoins":
    case "usdc":
      return "Circle USDC networks & mints";
    case "binance_pay":
      return "crypto apps";
    case "ondo_usdy":
      return "tokenized assets";
    case "cash_voucher":
    case "oxxo":
    case "konbini":
    case "boleto":
      return "authorized cash networks";
    case "bnpl":
      return "installment providers";
    case "direct_debit":
    case "ach":
      return "clearing schemes";
    default:
      return "direct providers";
  }
}

function getDirectProvidersForMethod(scenarioId: string, methodId: string): DirectItem[] {
  const custom = DIRECT_PROVIDERS_MAP[scenarioId]?.[methodId];
  if (custom && custom.length >= 3) {
    return custom.slice(0, 3);
  }
  return [
    { name: "Primary Direct Provider", cost: "Low", time: "Instant push", reliability: "Direct institution API" },
    { name: "Secondary Direct Provider", cost: "Medium", time: "Instant push", reliability: "Direct institution API" },
    { name: "Alternative Direct Provider", cost: "Higher", time: "< 3s push", reliability: "Direct clearing" },
  ];
}

export function providers(s: State) {
  if (!s.method) return [];
  const scenario = scenarios[s.scenario];
  const scenarioId = scenario ? scenario.id : "GLOBAL";
  const directList = getDirectProvidersForMethod(scenarioId, s.method);

  const ranks = [
    { Balanced: 1, "Lower cost": 0, Faster: 2 },
    { Balanced: 0, "Lower cost": 1, Faster: 0 },
    { Balanced: 2, "Lower cost": 2, Faster: 1 },
  ];

  return directList
    .map((item, index) => ({
      id: `${s.scenario}-${s.method}-${index}`,
      method: s.method as string,
      name: item.name,
      cost: item.cost,
      time: item.time,
      reliability: item.reliability,
      rank: ranks[index],
    }))
    .filter((p) => !s.excluded.includes(p.id))
    .sort((a, b) => a.rank[s.policy] - b.rank[s.policy]);
}

export type Action =
  | { type: "scenario"; value: number }
  | { type: "method"; value: string }
  | { type: "policy"; value: Policy }
  | { type: "exclude" }
  | { type: "start" }
  | { type: "advance"; phase: "confirmed" | "settled"; run: number }
  | { type: "reset" };

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "scenario":
      return scenarios[a.value]
        ? { ...initial, scenario: a.value, run: s.run + 1 }
        : s;
    case "method": {
      const targetId =
        a.value === "usdc" &&
        !scenarios[s.scenario].methods.some((m) => m.id === "usdc") &&
        scenarios[s.scenario].methods.some((m) => m.id === "stablecoins")
          ? "stablecoins"
          : a.value;
      return scenarios[s.scenario].methods.some((m) => m.id === targetId)
        ? { ...s, method: targetId, excluded: [], phase: "idle", run: s.run + 1 }
        : s;
    }
    case "policy":
      return { ...s, policy: a.value, phase: "idle", run: s.run + 1 };
    case "exclude": {
      const p = providers(s)[0];
      return s.phase === "idle" && p
        ? { ...s, excluded: [...s.excluded, p.id], run: s.run + 1 }
        : s;
    }
    case "start":
      return s.phase === "idle" && providers(s).length
        ? { ...s, phase: "processing", run: s.run + 1 }
        : s;
    case "advance":
      return a.run === s.run &&
        ((s.phase === "processing" && a.phase === "confirmed") ||
          (s.phase === "confirmed" && a.phase === "settled"))
        ? { ...s, phase: a.phase }
        : s;
    case "reset":
      return { ...initial, scenario: s.scenario, run: s.run + 1 };
  }
}
