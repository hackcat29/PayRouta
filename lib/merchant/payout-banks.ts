// What a payout bank account looks like in each country, so the activation
// form asks only for the fields that country's banks use: a bank picker and
// a 10-digit account number in Nigeria, a sort code in the UK, a routing
// number in the US, an IBAN alone in SEPA countries. The bank code is stored
// as the payout account's routingNumber (lib/treasury/verification.ts).

const sepa = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU", "IE", "IS", "IT", "LI", "LT",
  "LU", "LV", "MC", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK", "CH", "SM", "AD", "VA",
];
const euro = new Set(["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MC", "MT", "NL", "PT", "SI", "SK", "SM", "AD", "VA"]);

const currencies: Record<string, string> = {
  NG: "NGN", GH: "GHS", KE: "KES", ZA: "ZAR", UG: "UGX", TZ: "TZS", RW: "RWF", ZM: "ZMW", CM: "XAF", CI: "XOF",
  SN: "XOF", BJ: "XOF", TG: "XOF", ML: "XOF", BF: "XOF", NE: "XOF", EG: "EGP", MA: "MAD", ET: "ETB", MW: "MWK",
  BW: "BWP", MZ: "MZN", GB: "GBP", US: "USD", CA: "CAD", MX: "MXN", BR: "BRL", AR: "ARS", CO: "COP", CL: "CLP",
  PE: "PEN", IN: "INR", PK: "PKR", BD: "BDT", PH: "PHP", ID: "IDR", VN: "VND", MY: "MYR", SG: "SGD", TH: "THB",
  AE: "AED", SA: "SAR", TR: "TRY", AU: "AUD", NZ: "NZD", JP: "JPY", CH: "CHF", NO: "NOK", SE: "SEK", DK: "DKK",
  PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", IS: "ISK",
};

// The currency a bank account in this country is held in, when it's clear.
export function payoutCurrency(country: string): string | undefined {
  return euro.has(country) ? "EUR" : currencies[country];
}

export type BankFields = {
  // Label for the bank code, or null when the account number says it all.
  code: string | null;
  codePattern?: string;
  account: string;
  accountPattern?: string;
  banks?: readonly (readonly [code: string, name: string])[];
};

// Nigerian banks by their NIBSS/CBN code, as Paystack's bank list uses them.
export const nigerianBanks = [
  ["044", "Access Bank"],
  ["023", "Citibank Nigeria"],
  ["050", "Ecobank Nigeria"],
  ["070", "Fidelity Bank"],
  ["011", "First Bank of Nigeria"],
  ["214", "First City Monument Bank"],
  ["00103", "Globus Bank"],
  ["058", "Guaranty Trust Bank"],
  ["301", "Jaiz Bank"],
  ["082", "Keystone Bank"],
  ["50211", "Kuda Bank"],
  ["303", "Lotus Bank"],
  ["50515", "Moniepoint"],
  ["999992", "OPay"],
  ["107", "Optimus Bank"],
  ["999991", "PalmPay"],
  ["076", "Polaris Bank"],
  ["105", "PremiumTrust Bank"],
  ["101", "Providus Bank"],
  ["106", "Signature Bank"],
  ["221", "Stanbic IBTC Bank"],
  ["068", "Standard Chartered Bank"],
  ["232", "Sterling Bank"],
  ["100", "SunTrust Bank"],
  ["302", "TAJBank"],
  ["102", "Titan Trust Bank"],
  ["032", "Union Bank of Nigeria"],
  ["033", "United Bank for Africa"],
  ["215", "Unity Bank"],
  ["035", "Wema Bank"],
  ["057", "Zenith Bank"],
] as const;

export function bankFields(country: string): BankFields {
  if (country === "NG") return { code: "Bank", account: "Account number", accountPattern: "\\d{10}", banks: nigerianBanks };
  if (country === "GB") return { code: "Sort code", codePattern: "\\d{2}-?\\d{2}-?\\d{2}", account: "Account number", accountPattern: "\\d{8}" };
  if (country === "US") return { code: "Routing number", codePattern: "\\d{9}", account: "Account number", accountPattern: "\\d{4,17}" };
  if (country === "IN") return { code: "IFSC", codePattern: "[A-Za-z]{4}0[A-Za-z0-9]{6}", account: "Account number" };
  if (country === "ZA") return { code: "Branch code", codePattern: "\\d{6}", account: "Account number" };
  if (country === "CA") return { code: "Transit and institution number", account: "Account number" };
  if (country === "AU") return { code: "BSB", codePattern: "\\d{3}-?\\d{3}", account: "Account number" };
  if (sepa.includes(country)) return { code: null, account: "IBAN" };
  return { code: "Bank code", account: "Account number" };
}
