// Localization-as-a-Service (LaaS) Checkout Engine.
//
// Adapts payment method prioritization, localized rail naming, badges, and
// default presentment context to the buyer's country and currency:
//   - Germany (DE): SEPA Direct Debit & Giropay / SEPA Instant first
//   - Indonesia (ID): QRIS & local e-wallets (GoPay, OVO, DANA) first
//   - United States (US): Apple Pay, Google Pay & Credit/Debit Cards first
//   - Nigeria (NG): NIBSS Instant Bank Transfer & USSD first
//   - Kenya (KE) / Ghana (GH): M-Pesa / MTN Mobile Money first
//   - Brazil (BR): Pix Instant Payment first
//   - Japan (JP): PayPay / Konbini / JCB & Cards first
//   - India (IN): UPI & RuPay / NetBanking first

export type CheckoutMethodOption = {
  method: string;
  label?: string;
  status: string;
  explanation?: string;
};

export type LocalizedMethodDescriptor = CheckoutMethodOption & {
  localizedLabel: string;
  localizedBlurb: string;
  badges: string[];
  priorityRank: number;
  recommended: boolean;
};

export type CountryCheckoutProfile = {
  country: string;
  region: "EU" | "UK" | "NA" | "LATAM" | "AFRICA" | "APAC" | "GLOBAL";
  defaultCurrency: string;
  locale: string;
  priorityOrder: string[];
  methodOverrides: Record<
    string,
    {
      label: string;
      blurb: string;
      badges: string[];
    }
  >;
};

const DEFAULT_LABELS: Record<string, string> = {
  card: "Card",
  "bank-transfer": "Bank transfer",
  "mobile-money": "Mobile money",
  ussd: "USSD",
  "digital-wallet": "Wallet",
  "direct-debit": "Direct debit",
  bnpl: "Pay with credit",
};

const DEFAULT_BLURBS: Record<string, string> = {
  card: "Visa, Mastercard and more. Apple Pay and Google Pay where available.",
  "bank-transfer": "Pay from your bank account or banking app.",
  "mobile-money": "M-Pesa, MTN MoMo and other mobile wallets.",
  ussd: "Dial a short code from your phone. No internet needed.",
  "digital-wallet": "Pay with your digital wallet.",
  "direct-debit": "Authorise a one-off debit from your bank account.",
  bnpl: "Spread the cost with a licensed lender. See the full cost before you agree.",
};

const COUNTRY_PROFILES: Record<string, CountryCheckoutProfile> = {
  DE: {
    country: "DE",
    region: "EU",
    defaultCurrency: "EUR",
    locale: "de-DE",
    priorityOrder: ["direct-debit", "bank-transfer", "digital-wallet", "card", "bnpl"],
    methodOverrides: {
      "direct-debit": {
        label: "SEPA-Lastschrift (SEPA Direct Debit)",
        blurb: "Direct debit from any IBAN account across the SEPA zone.",
        badges: ["SEPA", "IBAN"],
      },
      "bank-transfer": {
        label: "Giropay & SEPA Instant",
        blurb: "Instant online bank transfer via Giropay or SEPA Instant.",
        badges: ["Giropay", "SEPA Instant"],
      },
      "digital-wallet": {
        label: "Apple Pay, Google Pay & PayPal",
        blurb: "Express checkout with your German wallet.",
        badges: ["Apple Pay", "Google Pay"],
      },
      card: {
        label: "Kredit- oder Debitkarte",
        blurb: "Girocard, Visa, Mastercard and Maestro.",
        badges: ["Visa", "Mastercard"],
      },
      bnpl: {
        label: "Rechnung & Ratenkauf",
        blurb: "Pay in 30 days or spread across monthly instalments.",
        badges: ["Klarna", "BNPL"],
      },
    },
  },
  AT: {
    country: "AT",
    region: "EU",
    defaultCurrency: "EUR",
    locale: "de-AT",
    priorityOrder: ["direct-debit", "bank-transfer", "digital-wallet", "card", "bnpl"],
    methodOverrides: {
      "direct-debit": {
        label: "SEPA Direct Debit",
        blurb: "Direct debit from your Austrian or EU IBAN account.",
        badges: ["SEPA", "IBAN"],
      },
      "bank-transfer": {
        label: "EPS & SEPA Instant",
        blurb: "Instant Austrian bank transfer via EPS or SEPA.",
        badges: ["EPS", "SEPA Instant"],
      },
    },
  },
  NL: {
    country: "NL",
    region: "EU",
    defaultCurrency: "EUR",
    locale: "nl-NL",
    priorityOrder: ["bank-transfer", "direct-debit", "digital-wallet", "card", "bnpl"],
    methodOverrides: {
      "bank-transfer": {
        label: "iDEAL & SEPA Instant",
        blurb: "Pay directly from your Dutch bank app with iDEAL.",
        badges: ["iDEAL", "SEPA"],
      },
      "direct-debit": {
        label: "SEPA Incasso (Direct Debit)",
        blurb: "Authorise a SEPA debit from your IBAN.",
        badges: ["SEPA"],
      },
    },
  },
  ID: {
    country: "ID",
    region: "APAC",
    defaultCurrency: "IDR",
    locale: "id-ID",
    priorityOrder: ["digital-wallet", "bank-transfer", "card", "bnpl"],
    methodOverrides: {
      "digital-wallet": {
        label: "QRIS & E-Wallets (GoPay, OVO)",
        blurb: "Scan QRIS or pay instantly with GoPay, OVO, DANA or ShopeePay.",
        badges: ["QRIS", "GoPay", "OVO"],
      },
      "bank-transfer": {
        label: "Virtual Account (BCA, Mandiri, BNI, BRI)",
        blurb: "Instant Indonesian bank transfer via BI-FAST or Virtual Account.",
        badges: ["BCA", "Mandiri", "BI-FAST"],
      },
      card: {
        label: "Kartu Kredit / Debit",
        blurb: "Visa, Mastercard, JCB and GPN cards.",
        badges: ["Visa", "Mastercard", "JCB"],
      },
    },
  },
  US: {
    country: "US",
    region: "NA",
    defaultCurrency: "USD",
    locale: "en-US",
    priorityOrder: ["digital-wallet", "card", "direct-debit", "bank-transfer", "bnpl"],
    methodOverrides: {
      "digital-wallet": {
        label: "Apple Pay & Google Pay",
        blurb: "One-tap express payment with Apple Pay or Google Pay.",
        badges: ["Apple Pay", "Google Pay"],
      },
      card: {
        label: "Credit or Debit Card",
        blurb: "Visa, Mastercard, American Express and Discover. Apple Pay & Google Pay supported.",
        badges: ["Apple Pay", "Google Pay", "Visa", "Mastercard", "Amex"],
      },
      "direct-debit": {
        label: "ACH Direct Debit",
        blurb: "Pay directly from your US checking or savings account via Instant ACH / FedNow.",
        badges: ["ACH", "FedNow"],
      },
      "bank-transfer": {
        label: "Instant Bank Transfer (FedNow / RTP)",
        blurb: "Real-time US bank transfer.",
        badges: ["RTP", "FedNow"],
      },
    },
  },
  CA: {
    country: "CA",
    region: "NA",
    defaultCurrency: "CAD",
    locale: "en-CA",
    priorityOrder: ["digital-wallet", "card", "bank-transfer", "direct-debit", "bnpl"],
    methodOverrides: {
      "digital-wallet": {
        label: "Apple Pay & Google Pay",
        blurb: "Fast checkout with Apple Pay or Google Pay.",
        badges: ["Apple Pay", "Google Pay"],
      },
      card: {
        label: "Credit or Interac Debit Card",
        blurb: "Visa, Mastercard, Amex and Interac.",
        badges: ["Interac", "Visa", "Mastercard"],
      },
      "bank-transfer": {
        label: "Interac e-Transfer",
        blurb: "Instant transfer from your Canadian bank account.",
        badges: ["Interac"],
      },
    },
  },
  GB: {
    country: "GB",
    region: "UK",
    defaultCurrency: "GBP",
    locale: "en-GB",
    priorityOrder: ["digital-wallet", "card", "bank-transfer", "direct-debit", "bnpl"],
    methodOverrides: {
      "digital-wallet": {
        label: "Apple Pay & Google Pay",
        blurb: "Instant payment with Apple Pay or Google Pay.",
        badges: ["Apple Pay", "Google Pay"],
      },
      card: {
        label: "Debit or Credit Card",
        blurb: "Visa, Mastercard and American Express.",
        badges: ["Visa", "Mastercard", "Amex"],
      },
      "bank-transfer": {
        label: "Pay by Bank (Faster Payments)",
        blurb: "Approve instantly in your UK banking app via Open Banking.",
        badges: ["Faster Payments", "Open Banking"],
      },
      "direct-debit": {
        label: "Bacs Direct Debit",
        blurb: "Protected by the Direct Debit Guarantee.",
        badges: ["Bacs"],
      },
    },
  },
  NG: {
    country: "NG",
    region: "AFRICA",
    defaultCurrency: "NGN",
    locale: "en-NG",
    priorityOrder: ["bank-transfer", "ussd", "card", "mobile-money", "bnpl"],
    methodOverrides: {
      "bank-transfer": {
        label: "NIBSS Instant Bank Transfer",
        blurb: "Transfer to a dedicated 10-digit NGN virtual account. Confirms in seconds.",
        badges: ["NIBSS NIP", "Virtual Account"],
      },
      ussd: {
        label: "USSD Bank Code",
        blurb: "Dial a short code from GTBank, Zenith, Access, UBA or FirstBank. No internet needed.",
        badges: ["*737#", "*901#", "*919#"],
      },
      card: {
        label: "Card (Verve, Mastercard, Visa)",
        blurb: "Pay with your Nigerian Naira or Dollar card.",
        badges: ["Verve", "Mastercard", "Visa"],
      },
    },
  },
  KE: {
    country: "KE",
    region: "AFRICA",
    defaultCurrency: "KES",
    locale: "en-KE",
    priorityOrder: ["mobile-money", "card", "bank-transfer"],
    methodOverrides: {
      "mobile-money": {
        label: "M-Pesa & Airtel Money",
        blurb: "Enter your phone number for an instant M-Pesa STK Push prompt.",
        badges: ["M-Pesa", "Airtel Money"],
      },
      "bank-transfer": {
        label: "PesaLink Bank Transfer",
        blurb: "Instant transfer from any Kenyan bank account.",
        badges: ["PesaLink"],
      },
    },
  },
  GH: {
    country: "GH",
    region: "AFRICA",
    defaultCurrency: "GHS",
    locale: "en-GH",
    priorityOrder: ["mobile-money", "card", "bank-transfer", "ussd"],
    methodOverrides: {
      "mobile-money": {
        label: "MTN MoMo, Telecel Cash & AirtelTigo",
        blurb: "Approve the prompt on your Ghanaian mobile money wallet.",
        badges: ["MTN MoMo", "Telecel", "AirtelTigo"],
      },
    },
  },
  ZA: {
    country: "ZA",
    region: "AFRICA",
    defaultCurrency: "ZAR",
    locale: "en-ZA",
    priorityOrder: ["bank-transfer", "card", "digital-wallet", "bnpl"],
    methodOverrides: {
      "bank-transfer": {
        label: "Instant EFT & PayShap",
        blurb: "Real-time South African bank transfer via PayShap or Ozow EFT.",
        badges: ["PayShap", "Instant EFT"],
      },
    },
  },
  BR: {
    country: "BR",
    region: "LATAM",
    defaultCurrency: "BRL",
    locale: "pt-BR",
    priorityOrder: ["bank-transfer", "card", "digital-wallet", "bnpl"],
    methodOverrides: {
      "bank-transfer": {
        label: "Pix (Pagamento Instantâneo)",
        blurb: "Scan the Pix QR code or copy Pix Copia e Cola. Confirms 24/7 in seconds.",
        badges: ["Pix", "Banco Central"],
      },
      card: {
        label: "Cartão de Crédito ou Débito",
        blurb: "Visa, Mastercard, Elo and Hipercard.",
        badges: ["Elo", "Visa", "Mastercard"],
      },
    },
  },
  MX: {
    country: "MX",
    region: "LATAM",
    defaultCurrency: "MXN",
    locale: "es-MX",
    priorityOrder: ["bank-transfer", "card", "digital-wallet"],
    methodOverrides: {
      "bank-transfer": {
        label: "SPEI Transferencia Instantánea",
        blurb: "Real-time CLABE transfer via Banxico SPEI.",
        badges: ["SPEI", "CLABE"],
      },
    },
  },
  JP: {
    country: "JP",
    region: "APAC",
    defaultCurrency: "JPY",
    locale: "ja-JP",
    priorityOrder: ["digital-wallet", "card", "bank-transfer"],
    methodOverrides: {
      "digital-wallet": {
        label: "PayPay, Rakuten Pay & Apple Pay",
        blurb: "Pay instantly with PayPay, Rakuten Pay, LINE Pay or Apple Pay.",
        badges: ["PayPay", "Rakuten Pay", "Apple Pay"],
      },
      card: {
        label: "Credit Card (JCB, Visa, Mastercard)",
        blurb: "JCB, Visa, Mastercard, American Express and Diners Club.",
        badges: ["JCB", "Visa", "Mastercard"],
      },
      "bank-transfer": {
        label: "Furikomi & Pay-easy (銀行振込)",
        blurb: "Domestic Japanese bank transfer via Zengin / Pay-easy.",
        badges: ["Furikomi", "Pay-easy"],
      },
    },
  },
  IN: {
    country: "IN",
    region: "APAC",
    defaultCurrency: "INR",
    locale: "en-IN",
    priorityOrder: ["digital-wallet", "card", "bank-transfer"],
    methodOverrides: {
      "digital-wallet": {
        label: "UPI (Google Pay, PhonePe, Paytm)",
        blurb: "Instant payment via Unified Payments Interface (UPI QR or VPA).",
        badges: ["UPI", "GPay", "PhonePe"],
      },
      card: {
        label: "RuPay, Visa & Mastercard",
        blurb: "Indian debit and credit cards with RBI 2FA.",
        badges: ["RuPay", "Visa", "Mastercard"],
      },
      "bank-transfer": {
        label: "IMPS / NEFT / NetBanking",
        blurb: "Direct transfer from major Indian banks.",
        badges: ["IMPS", "NetBanking"],
      },
    },
  },
  SG: {
    country: "SG",
    region: "APAC",
    defaultCurrency: "SGD",
    locale: "en-SG",
    priorityOrder: ["bank-transfer", "digital-wallet", "card"],
    methodOverrides: {
      "bank-transfer": {
        label: "PayNow QR",
        blurb: "Scan PayNow QR with DBS, OCBC, UOB or any participating bank app.",
        badges: ["PayNow", "FAST"],
      },
      "digital-wallet": {
        label: "GrabPay, Apple Pay & Google Pay",
        blurb: "Express checkout with GrabPay or mobile wallet.",
        badges: ["GrabPay", "Apple Pay"],
      },
    },
  },
};

const CURRENCY_TO_DEFAULT_COUNTRY: Record<string, string> = {
  NGN: "NG",
  KES: "KE",
  GHS: "GH",
  ZAR: "ZA",
  IDR: "ID",
  BRL: "BR",
  MXN: "MX",
  JPY: "JP",
  INR: "IN",
  GBP: "GB",
  CAD: "CA",
  SGD: "SG",
};

export function resolveCountryProfile(
  payerCountry?: string | null,
  currency?: string | null,
): CountryCheckoutProfile {
  const countryCode = (
    payerCountry?.trim().toUpperCase() ||
    (currency ? CURRENCY_TO_DEFAULT_COUNTRY[currency.trim().toUpperCase()] : undefined) ||
    "US"
  );
  if (COUNTRY_PROFILES[countryCode]) {
    return COUNTRY_PROFILES[countryCode]!;
  }
  // European Eurozone fallback if currency is EUR or country is in EU
  const euFallbackCountries = new Set([
    "FR", "ES", "IT", "BE", "PT", "IE", "FI", "GR", "PL", "SE", "DK", "LU",
  ]);
  if (euFallbackCountries.has(countryCode) || (!payerCountry && currency?.toUpperCase() === "EUR")) {
    return {
      ...COUNTRY_PROFILES.DE!,
      country: countryCode,
      locale: `en-${countryCode}`,
      methodOverrides: {
        "direct-debit": {
          label: "SEPA Direct Debit",
          blurb: "Direct debit from any IBAN account across the SEPA zone.",
          badges: ["SEPA", "IBAN"],
        },
        "bank-transfer": {
          label: "SEPA Instant Bank Transfer",
          blurb: "Instant online transfer from your European bank account.",
          badges: ["SEPA Instant"],
        },
        "digital-wallet": {
          label: "Apple Pay & Google Pay",
          blurb: "Express checkout with your digital wallet.",
          badges: ["Apple Pay", "Google Pay"],
        },
      },
    };
  }
  return {
    country: countryCode,
    region: "GLOBAL",
    defaultCurrency: currency?.toUpperCase() || "USD",
    locale: "en-US",
    priorityOrder: ["card", "digital-wallet", "bank-transfer", "mobile-money", "direct-debit", "ussd", "bnpl"],
    methodOverrides: {},
  };
}

// Orders and enriches available payment methods based on the consumer's geographic
// and currency context. When `useLocalizedLabels` is false (default for generic UI tests),
// `localizedLabel` carries the region-specific rail name while `label` preserves
// the canonical method name.
export function localizeCheckoutMethods<T extends CheckoutMethodOption>(
  methods: readonly T[],
  context?: {
    payerCountry?: string | null;
    currency?: string | null;
  },
): (T & LocalizedMethodDescriptor)[] {
  const profile = resolveCountryProfile(context?.payerCountry, context?.currency);
  const rankOf = (method: string) => {
    const idx = profile.priorityOrder.indexOf(method);
    return idx === -1 ? 999 : idx;
  };

  const enriched = methods.map((m, originalIndex) => {
    const override = profile.methodOverrides[m.method];
    const priorityRank = rankOf(m.method);
    return {
      item: {
        ...m,
        localizedLabel: override?.label ?? m.label ?? DEFAULT_LABELS[m.method] ?? m.method,
        localizedBlurb: override?.blurb ?? DEFAULT_BLURBS[m.method] ?? m.explanation ?? "",
        badges: override?.badges ?? [],
        priorityRank,
        recommended: false,
      },
      originalIndex,
    };
  });

  enriched.sort((a, b) => {
    if (a.item.priorityRank !== b.item.priorityRank) return a.item.priorityRank - b.item.priorityRank;
    return a.originalIndex - b.originalIndex;
  });

  return enriched.map(({ item }, index) => ({
    ...item,
    recommended: index === 0 && item.status === "AVAILABLE",
  }));
}
