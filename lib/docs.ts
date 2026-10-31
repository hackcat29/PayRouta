import fs from "node:fs";
import path from "node:path";

export type DocEntryTuple = readonly [
  slug: string,
  title: string,
  category?: string,
  group?: string,
];

export const docEntries: readonly DocEntryTuple[] = [
  // Core Guides & Concepts
  ["overview", "Overview", "Getting Started", "Concepts"],
  ["quickstart", "Quickstart", "Getting Started", "Concepts"],
  ["payment-links", "Payment Links", "Getting Started", "Concepts"],
  ["checkout-button", "Checkout Button", "Getting Started", "Concepts"],
  ["provider-accounts", "Provider Accounts", "Core Concepts", "Concepts"],
  ["payment-intents", "Payment Intents", "Core Concepts", "Concepts"],
  ["payment-methods", "Payment Methods", "Core Concepts", "Concepts"],
  ["settlement", "Settlement", "Core Concepts", "Concepts"],
  ["billing", "Fees & Billing", "Core Concepts", "Concepts"],
  ["credit", "Pay with Credit", "Core Concepts", "Concepts"],
  ["crypto-payments", "Crypto Wallet Payments", "Core Concepts", "Concepts"],
  ["cross-chain", "Pay from Any Chain", "Core Concepts", "Concepts"],
  ["near-intents", "Your NEAR Intents Account", "Core Concepts", "Concepts"],
  ["agents", "Agentic Payments", "Core Concepts", "Concepts"],

  // Integration
  ["api-reference", "API Reference", "Integration", "Integration"],
  ["sdks", "SDKs", "Integration", "Integration"],
  ["webhooks", "Webhooks", "Integration", "Integration"],
  ["mcp", "MCP Server", "Integration", "Integration"],
  ["provider-integration", "Provider Integration", "Integration", "Integration"],
  ["provider-coverage", "Integration Coverage", "Integration", "Integration"],
  ["errors", "Errors & Recovery", "Integration", "Integration"],
  ["woocommerce", "WooCommerce", "Platforms", "Integration"],
  ["shopify", "Shopify", "Platforms", "Integration"],

  // Providers Directory Hub
  ["providers", "Provider Directory", "Providers", "Providers"],

  // Category: Stablecoins
  ["providers/stablecoins", "Stablecoin Rails", "Stablecoins", "Providers"],
  ["providers/stablecoins/usdc", "Circle USDC", "Stablecoins", "Providers"],
  ["providers/stablecoins/usdt", "Tether USDT", "Stablecoins", "Providers"],
  ["providers/stablecoins/eurc", "Circle EURC", "Stablecoins", "Providers"],

  // Category: Cards & Schemes
  ["providers/cards", "Card Payment Rails", "Cards", "Providers"],
  ["providers/cards/stripe", "Stripe Connect", "Cards", "Providers"],
  ["providers/cards/visa", "Visa Direct", "Cards", "Providers"],
  ["providers/cards/mastercard", "Mastercard", "Cards", "Providers"],

  // Category: Bank Transfer & Fast Rails
  ["providers/bank-transfer", "Bank Transfer & Fast Rails", "Bank Transfer", "Providers"],
  ["providers/bank-transfer/paystack", "Paystack", "Bank Transfer", "Providers"],
  ["providers/bank-transfer/flutterwave", "Flutterwave", "Bank Transfer", "Providers"],
  ["providers/bank-transfer/monnify", "Monnify", "Bank Transfer", "Providers"],
  ["providers/bank-transfer/sepa", "SEPA Instant", "Bank Transfer", "Providers"],
  ["providers/bank-transfer/ach", "FedNow & ACH", "Bank Transfer", "Providers"],
  ["providers/bank-transfer/pix", "Pix (Brazil)", "Bank Transfer", "Providers"],

  // Category: Digital Wallets (Global & Regional)
  ["providers/digital-wallets", "Digital Wallets", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/apple-pay", "Apple Pay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/google-pay", "Google Pay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/paypal", "PayPal", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/alipay", "Alipay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/wechat-pay", "WeChat Pay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/grabpay", "GrabPay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/gcash", "GCash", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/shopeepay", "ShopeePay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/phonepe", "PhonePe", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/paytm", "Paytm", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/mercado-pago", "Mercado Pago", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/picpay", "PicPay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/paypay", "PayPay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/kakaopay", "KakaoPay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/revolut-pay", "Revolut Pay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/wero", "Wero (EPI)", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/cash-app", "Cash App Pay", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/venmo", "Venmo", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/opay", "OPay Wallet", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/palmpay", "PalmPay Wallet", "Digital Wallets", "Providers"],
  ["providers/digital-wallets/chipper-cash", "Chipper Cash", "Digital Wallets", "Providers"],

  // Category: Mobile Money
  ["providers/mobile-money", "Mobile Money", "Mobile Money", "Providers"],
  ["providers/mobile-money/mpesa", "Safaricom M-Pesa", "Mobile Money", "Providers"],
  ["providers/mobile-money/mtn-momo", "MTN MoMo", "Mobile Money", "Providers"],
  ["providers/mobile-money/airtel-money", "Airtel Money", "Mobile Money", "Providers"],

  // Category: Crypto Apps
  ["providers/crypto-apps", "Crypto App Rails", "Crypto Apps", "Providers"],
  ["providers/crypto-apps/binance-pay", "Binance Pay", "Crypto Apps", "Providers"],
  ["providers/crypto-apps/coinbase-commerce", "Coinbase Commerce", "Crypto Apps", "Providers"],

  // Category: Real-World Assets
  ["providers/real-world-assets", "Real-World Asset Rails", "Real-World Assets", "Providers"],
  ["providers/real-world-assets/ondo-usdy", "Ondo USDY", "Real-World Assets", "Providers"],

  // Category: BNPL
  ["providers/bnpl", "Buy Now, Pay Later", "BNPL", "Providers"],
  ["providers/bnpl/klarna", "Klarna", "BNPL", "Providers"],
  ["providers/bnpl/affirm", "Affirm", "BNPL", "Providers"],
] as const;

export interface DocItem {
  slug: string;
  title: string;
  href: string;
  content: string;
  category?: string;
  group?: string;
  aliases: string[];
}

export function docHref(slug: string) {
  return slug === "overview" ? "/docs" : `/docs/${slug}`;
}

function resolveDocFile(slug: string): string | null {
  const docsRoot = path.join(process.cwd(), "docs");
  const fallbackRoot = path.join(process.cwd(), "content/docs");
  const candidates = [
    path.join(docsRoot, `${slug}.md`),
    path.join(docsRoot, slug, "README.md"),
    path.join(docsRoot, slug, "index.md"),
    path.join(fallbackRoot, `${slug}.md`),
    path.join(fallbackRoot, slug, "README.md"),
    path.join(fallbackRoot, slug, "index.md"),
  ];
  if (slug === "overview") {
    candidates.push(path.join(docsRoot, "README.md"));
    candidates.push(path.join(fallbackRoot, "README.md"));
  }
  for (const c of candidates) {
    if (fs.existsSync(/*turbopackIgnore: true*/ c)) return c;
  }
  return null;
}

export function readDocs(): DocItem[] {
  return docEntries.map(([slug, title, category, group]) => {
    const filePath = resolveDocFile(slug);

    let content = "";
    if (filePath && fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      content = fs.readFileSync(/*turbopackIgnore: true*/ filePath, "utf8");
    } else {
      content = `# ${title}\n\nDocumentation for ${title} under ${category || "General"}.`;
    }

    const aliases: string[] = [];
    if (slug.startsWith("providers/")) {
      aliases.push(slug.replace(/^providers\//, ""));
    }

    return {
      slug,
      title,
      href: docHref(slug),
      content,
      category,
      group,
      aliases,
    };
  });
}

export function findDoc(slug: string): DocItem | undefined {
  const docs = readDocs();
  const normalized = slug || "overview";
  return docs.find(
    (d) => d.slug === normalized || d.aliases.includes(normalized),
  );
}
