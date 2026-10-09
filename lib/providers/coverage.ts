import type { PaymentMethodId } from "./normalized";

// Directory inventory, not a claim of live qualification. Every guide has an
// explicit execution path or an explicit remaining prerequisite.
type Coverage = {
  guide: string;
  method: PaymentMethodId | null;
  adapters: readonly string[];
  requirement?: string;
};
export const providerCoverage: readonly Coverage[] = [
  {
    guide: "stablecoins/usdc",
    method: "stablecoin",
    adapters: ["erc20-deposit"],
    requirement:
      "Direct Ethereum/Base deposits; official Sepolia testnets only in sandbox. Address pool, RPC and production review required.",
  },
  {
    guide: "stablecoins/usdt",
    method: "stablecoin",
    adapters: ["erc20-deposit"],
    requirement:
      "Direct Ethereum mainnet only; no fabricated test USDT. Production review required; other networks remain unsupported.",
  },
  {
    guide: "stablecoins/eurc",
    method: "stablecoin",
    adapters: ["erc20-deposit"],
    requirement:
      "Direct Ethereum/Base deposits; official Sepolia testnets only in sandbox. Address pool, RPC and production review required.",
  },
  {
    guide: "cards/stripe",
    method: "card",
    adapters: ["stripe", "stripe-connect"],
  },
  {
    guide: "cards/visa",
    method: "card",
    adapters: ["stripe", "adyen", "paystack", "flutterwave"],
    requirement: "Card scheme, not a separate acquiring API.",
  },
  {
    guide: "cards/mastercard",
    method: "card",
    adapters: ["stripe", "adyen", "paystack", "flutterwave"],
    requirement: "Card scheme, not a separate acquiring API.",
  },
  {
    guide: "bank-transfer/paystack",
    method: "bank-transfer",
    adapters: ["paystack"],
  },
  {
    guide: "bank-transfer/flutterwave",
    method: "bank-transfer",
    adapters: ["flutterwave"],
  },
  {
    guide: "bank-transfer/monnify",
    method: "bank-transfer",
    adapters: ["monnify"],
    requirement:
      "NGN hosted card/transfer instructions and authenticated query receipts. Merchant contract, real payer fields and qualification required.",
  },
  {
    guide: "bank-transfer/sepa",
    method: "direct-debit",
    adapters: ["stripe", "adyen"],
    requirement:
      "Stripe hosted EUR credit transfers and SEPA debit; Adyen SEPA debit. Requires existing Stripe customer. No instant-transfer guarantee.",
  },
  {
    guide: "bank-transfer/ach",
    method: "direct-debit",
    adapters: ["stripe"],
    requirement:
      "Stripe hosted USD bank credit transfers (ACH/wire) and ACH debit. Requires existing Stripe customer. Payout, FedNow and RTP remain unimplemented.",
  },
  {
    guide: "bank-transfer/pix",
    method: "bank-transfer",
    adapters: ["stripe", "adyen"],
  },
  {
    guide: "digital-wallets/apple-pay",
    method: "digital-wallet",
    adapters: ["adyen"],
    requirement: "Enable provider wallet certificate/domain configuration.",
  },
  {
    guide: "digital-wallets/google-pay",
    method: "digital-wallet",
    adapters: ["adyen"],
    requirement: "Enable provider wallet/domain configuration.",
  },
  {
    guide: "digital-wallets/paypal",
    method: "digital-wallet",
    adapters: ["paypal", "stripe", "adyen"],
  },
  {
    guide: "digital-wallets/alipay",
    method: "digital-wallet",
    adapters: ["stripe", "adyen"],
  },
  {
    guide: "digital-wallets/wechat-pay",
    method: "digital-wallet",
    adapters: ["stripe", "adyen"],
  },
  {
    guide: "digital-wallets/grabpay",
    method: "digital-wallet",
    adapters: ["stripe", "adyen", "xendit"],
  },
  {
    guide: "digital-wallets/gcash",
    method: "digital-wallet",
    adapters: ["adyen", "xendit"],
  },
  {
    guide: "digital-wallets/shopeepay",
    method: "digital-wallet",
    adapters: ["xendit"],
  },
  {
    guide: "digital-wallets/phonepe",
    method: "bank-transfer",
    adapters: ["phonepe"],
    requirement:
      "UPI checkout can use PhonePe or another UPI app; wallet-balance debit is not implemented.",
  },
  {
    guide: "digital-wallets/paytm",
    method: "digital-wallet",
    adapters: ["adyen"],
  },
  {
    guide: "digital-wallets/mercado-pago",
    method: "digital-wallet",
    adapters: ["mercado-pago"],
  },
  {
    guide: "digital-wallets/picpay",
    method: "digital-wallet",
    adapters: ["picpay"],
    requirement:
      "Merchant supplies provider-required customer and device fields.",
  },
  {
    guide: "digital-wallets/paypay",
    method: "digital-wallet",
    adapters: ["paypay", "adyen", "stripe"],
  },
  {
    guide: "digital-wallets/kakaopay",
    method: "digital-wallet",
    adapters: ["adyen"],
  },
  {
    guide: "digital-wallets/revolut-pay",
    method: "digital-wallet",
    adapters: ["stripe"],
  },
  {
    guide: "digital-wallets/wero",
    method: "digital-wallet",
    adapters: ["adyen"],
  },
  {
    guide: "digital-wallets/cash-app",
    method: "digital-wallet",
    adapters: ["stripe", "adyen"],
  },
  {
    guide: "digital-wallets/venmo",
    method: "digital-wallet",
    adapters: ["paypal-venmo"],
    requirement:
      "US/USD only; approved PayPal merchant credentials, eligible Venmo SDK device and authentic capture qualification required.",
  },
  {
    guide: "digital-wallets/opay",
    method: "digital-wallet",
    adapters: ["opay"],
    requirement:
      "NGN OPay wallet QR and signed status polling; approved Nigerian merchant account and sandbox qualification required.",
  },
  {
    guide: "digital-wallets/palmpay",
    method: "digital-wallet",
    adapters: [],
    requirement:
      "Requires merchant/aggregator contract, authenticated API and method-specific receipt fixtures.",
  },
  {
    guide: "digital-wallets/chipper-cash",
    method: "digital-wallet",
    adapters: [],
    requirement: "Requires partner API contract and credentials.",
  },
  {
    guide: "mobile-money/mpesa",
    method: "mobile-money",
    adapters: ["flutterwave"],
    requirement:
      "KES M-Pesa through Flutterwave; direct Daraja receipt/callback integration is not implemented.",
  },
  {
    guide: "mobile-money/mtn-momo",
    method: "mobile-money",
    adapters: ["mtn-momo", "paystack", "flutterwave"],
  },
  {
    guide: "mobile-money/airtel-money",
    method: "mobile-money",
    adapters: ["flutterwave"],
    requirement:
      "Supported local mobile-money checkout through Flutterwave; direct Airtel API requires approved portal access.",
  },
  {
    guide: "crypto-apps/binance-pay",
    method: "crypto-app",
    adapters: ["binance-pay"],
    requirement:
      "No published public sandbox; no activation until an approved merchant contract and qualification path exist.",
  },
  {
    guide: "crypto-apps/coinbase-commerce",
    method: "crypto-app",
    adapters: ["coinbase-business"],
    requirement:
      "Replaced legacy Commerce with Coinbase Business Checkout; Base USDC only.",
  },
  { guide: "bnpl/klarna", method: "bnpl", adapters: ["stripe", "adyen"] },
  { guide: "bnpl/affirm", method: "bnpl", adapters: ["stripe", "adyen"] },
  {
    guide: "real-world-assets/ondo-usdy",
    method: null,
    adapters: [],
    requirement:
      "Reference only; explicitly excluded from the current product.",
  },
];
