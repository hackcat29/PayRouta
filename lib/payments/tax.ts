// Global Tax & Compliance Engine.
//
// Programmatically calculates, itemizes, and generates statutory reporting
// summaries for US State & Local Sales Tax, EU 27-State VAT (with B2B VIES
// Reverse-Charge validation and OSS digital rules), UK VAT, Canadian provincial
// GST/HST/QST/PST, African VAT (NG FIRS 7.5%, KE KRA 16%, GH 15%, ZA 15%),
// APAC GST/JCT/PPN (JP 10%, ID 11%, IN 18%, SG 9%, AU 10%), and LatAm IVA/ICMS.
import { currencyExponent, fromMinorUnits } from "../partners/money";
import { PortalError } from "../portal/domain";

function deterministicHexDigest(input: string, length: number): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex =
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0") +
    ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0");
  return hex.slice(0, length);
}

export type ProductTaxCategory = "saas" | "digital" | "physical" | "exempt";
export type TaxBehavior = "exclusive" | "inclusive";

export type BillingAddress = {
  country: string;
  stateOrProvince?: string;
  postalCode?: string;
  city?: string;
};

export type TaxLineItem = {
  name: string;
  jurisdiction: string;
  authority: string;
  rateBps: number;
  ratePercent: string;
  amountMinor: string;
  formattedAmount: string;
  taxType: "VAT" | "SALES_TAX" | "GST" | "HST" | "QST" | "PST" | "JCT" | "IVA" | "ICMS_ISS";
};

export type TaxCalculationInput = {
  amountMinor: bigint | number | string;
  currency: string;
  buyerAddress: BillingAddress;
  sellerCountry?: string;
  sellerStateOrProvince?: string;
  // Optional list of US states where the merchant has physical or economic nexus.
  // Defaults to all taxable US states when PayRouta acts as Merchant of Record / global tax engine.
  usNexusStates?: string[];
  productCategory?: ProductTaxCategory;
  taxBehavior?: TaxBehavior;
  buyerTaxId?: string;
  now?: Date;
};

export type TaxCalculationResult = {
  calculationId: string;
  currency: string;
  exponent: number;
  taxBehavior: TaxBehavior;
  productCategory: ProductTaxCategory;
  subtotalMinor: string;
  taxMinor: string;
  totalMinor: string;
  formattedSubtotal: string;
  formattedTax: string;
  formattedTotal: string;
  effectiveRateBps: number;
  effectiveRatePercent: string;
  reverseCharge: boolean;
  exemptionReason:
    | "NONE"
    | "PRODUCT_EXEMPT"
    | "B2B_REVERSE_CHARGE"
    | "US_NO_STATE_SALES_TAX"
    | "US_SAAS_STATE_EXEMPT"
    | "US_OUTSIDE_NEXUS"
    | "EXPORT_ZERO_RATED";
  statutoryNotice?: string;
  jurisdictionCode: string;
  filingRegime: string;
  lineItems: TaxLineItem[];
  calculatedAt: string;
};

// All 27 EU Member States with standard VAT rates in basis points (1% = 100 bps)
export const EU_VAT_RATES_BPS: Record<string, { name: string; rateBps: number }> = {
  AT: { name: "Austria MWSt", rateBps: 2000 },
  BE: { name: "Belgium TVA/BTW", rateBps: 2100 },
  BG: { name: "Bulgaria ДДС", rateBps: 2000 },
  HR: { name: "Croatia PDV", rateBps: 2500 },
  CY: { name: "Cyprus ΦΠΑ", rateBps: 1900 },
  CZ: { name: "Czechia DPH", rateBps: 2100 },
  DK: { name: "Denmark Moms", rateBps: 2500 },
  EE: { name: "Estonia KM", rateBps: 2200 },
  FI: { name: "Finland ALV", rateBps: 2550 },
  FR: { name: "France TVA", rateBps: 2000 },
  DE: { name: "Germany MwSt", rateBps: 1900 },
  GR: { name: "Greece ΦΠΑ", rateBps: 2400 },
  HU: { name: "Hungary ÁFA", rateBps: 2700 },
  IE: { name: "Ireland VAT", rateBps: 2300 },
  IT: { name: "Italy IVA", rateBps: 2200 },
  LV: { name: "Latvia PVN", rateBps: 2100 },
  LT: { name: "Lithuania PVM", rateBps: 2100 },
  LU: { name: "Luxembourg TVA", rateBps: 1700 },
  MT: { name: "Malta VAT", rateBps: 1800 },
  NL: { name: "Netherlands BTW", rateBps: 2100 },
  PL: { name: "Poland PTU/VAT", rateBps: 2300 },
  PT: { name: "Portugal IVA", rateBps: 2300 },
  RO: { name: "Romania TVA", rateBps: 1900 },
  SK: { name: "Slovakia DPH", rateBps: 2300 },
  SI: { name: "Slovenia DDV", rateBps: 2200 },
  ES: { name: "Spain IVA", rateBps: 2100 },
  SE: { name: "Sweden Moms", rateBps: 2500 },
};

// US State Sales Tax rules: state rate (bps), average local add-on (bps), and whether
// SaaS and Digital Goods are taxable under state statute.
type UsStateTaxRule = {
  name: string;
  stateRateBps: number;
  defaultLocalBps: number;
  saasTaxable: boolean;
  digitalTaxable: boolean;
};

const US_STATE_TAX_RULES: Record<string, UsStateTaxRule> = {
  AL: { name: "Alabama", stateRateBps: 400, defaultLocalBps: 522, saasTaxable: true, digitalTaxable: true },
  AK: { name: "Alaska", stateRateBps: 0, defaultLocalBps: 0, saasTaxable: false, digitalTaxable: false },
  AZ: { name: "Arizona", stateRateBps: 560, defaultLocalBps: 277, saasTaxable: true, digitalTaxable: true },
  CA: { name: "California", stateRateBps: 725, defaultLocalBps: 160, saasTaxable: false, digitalTaxable: false },
  CO: { name: "Colorado", stateRateBps: 290, defaultLocalBps: 487, saasTaxable: false, digitalTaxable: true },
  CT: { name: "Connecticut", stateRateBps: 635, defaultLocalBps: 0, saasTaxable: true, digitalTaxable: true },
  DE: { name: "Delaware", stateRateBps: 0, defaultLocalBps: 0, saasTaxable: false, digitalTaxable: false },
  DC: { name: "District of Columbia", stateRateBps: 600, defaultLocalBps: 0, saasTaxable: true, digitalTaxable: true },
  FL: { name: "Florida", stateRateBps: 600, defaultLocalBps: 102, saasTaxable: false, digitalTaxable: false },
  GA: { name: "Georgia", stateRateBps: 400, defaultLocalBps: 338, saasTaxable: false, digitalTaxable: true },
  HI: { name: "Hawaii", stateRateBps: 400, defaultLocalBps: 44, saasTaxable: true, digitalTaxable: true },
  IL: { name: "Illinois", stateRateBps: 625, defaultLocalBps: 259, saasTaxable: false, digitalTaxable: false },
  IN: { name: "Indiana", stateRateBps: 700, defaultLocalBps: 0, saasTaxable: false, digitalTaxable: true },
  MA: { name: "Massachusetts", stateRateBps: 625, defaultLocalBps: 0, saasTaxable: true, digitalTaxable: true },
  MD: { name: "Maryland", stateRateBps: 600, defaultLocalBps: 0, saasTaxable: true, digitalTaxable: true },
  MI: { name: "Michigan", stateRateBps: 600, defaultLocalBps: 0, saasTaxable: false, digitalTaxable: false },
  MN: { name: "Minnesota", stateRateBps: 688, defaultLocalBps: 116, saasTaxable: false, digitalTaxable: true },
  MT: { name: "Montana", stateRateBps: 0, defaultLocalBps: 0, saasTaxable: false, digitalTaxable: false },
  NC: { name: "North Carolina", stateRateBps: 475, defaultLocalBps: 225, saasTaxable: false, digitalTaxable: true },
  NH: { name: "New Hampshire", stateRateBps: 0, defaultLocalBps: 0, saasTaxable: false, digitalTaxable: false },
  NJ: { name: "New Jersey", stateRateBps: 663, defaultLocalBps: 0, saasTaxable: false, digitalTaxable: true },
  NM: { name: "New Mexico", stateRateBps: 488, defaultLocalBps: 274, saasTaxable: true, digitalTaxable: true },
  NY: { name: "New York", stateRateBps: 400, defaultLocalBps: 488, saasTaxable: true, digitalTaxable: true },
  OH: { name: "Ohio", stateRateBps: 575, defaultLocalBps: 149, saasTaxable: true, digitalTaxable: true },
  OR: { name: "Oregon", stateRateBps: 0, defaultLocalBps: 0, saasTaxable: false, digitalTaxable: false },
  PA: { name: "Pennsylvania", stateRateBps: 600, defaultLocalBps: 34, saasTaxable: true, digitalTaxable: true },
  SC: { name: "South Carolina", stateRateBps: 600, defaultLocalBps: 150, saasTaxable: true, digitalTaxable: true },
  TN: { name: "Tennessee", stateRateBps: 700, defaultLocalBps: 255, saasTaxable: true, digitalTaxable: true },
  TX: { name: "Texas", stateRateBps: 625, defaultLocalBps: 200, saasTaxable: true, digitalTaxable: true },
  UT: { name: "Utah", stateRateBps: 485, defaultLocalBps: 235, saasTaxable: true, digitalTaxable: true },
  VA: { name: "Virginia", stateRateBps: 430, defaultLocalBps: 147, saasTaxable: false, digitalTaxable: false },
  WA: { name: "Washington", stateRateBps: 650, defaultLocalBps: 375, saasTaxable: true, digitalTaxable: true },
  WI: { name: "Wisconsin", stateRateBps: 500, defaultLocalBps: 46, saasTaxable: false, digitalTaxable: true },
};

// Canadian Provincial GST / HST / QST / PST rules
type CanadaProvinceRule = {
  components: { name: string; taxType: TaxLineItem["taxType"]; rateBps: number; authority: string }[];
};

const CANADA_PROVINCE_RULES: Record<string, CanadaProvinceRule> = {
  ON: {
    components: [{ name: "Ontario HST", taxType: "HST", rateBps: 1300, authority: "CRA_CA" }],
  },
  BC: {
    components: [
      { name: "Canada Federal GST", taxType: "GST", rateBps: 500, authority: "CRA_CA" },
      { name: "British Columbia PST", taxType: "PST", rateBps: 700, authority: "BC_MOF" },
    ],
  },
  QC: {
    components: [
      { name: "Canada Federal GST", taxType: "GST", rateBps: 500, authority: "CRA_CA" },
      { name: "Québec QST (TVQ)", taxType: "QST", rateBps: 998, authority: "REVENU_QUEBEC" },
    ],
  },
  NS: {
    components: [{ name: "Nova Scotia HST", taxType: "HST", rateBps: 1500, authority: "CRA_CA" }],
  },
  NB: {
    components: [{ name: "New Brunswick HST", taxType: "HST", rateBps: 1500, authority: "CRA_CA" }],
  },
  NL: {
    components: [{ name: "Newfoundland & Labrador HST", taxType: "HST", rateBps: 1500, authority: "CRA_CA" }],
  },
  PE: {
    components: [{ name: "Prince Edward Island HST", taxType: "HST", rateBps: 1500, authority: "CRA_CA" }],
  },
  AB: {
    components: [{ name: "Canada Federal GST", taxType: "GST", rateBps: 500, authority: "CRA_CA" }],
  },
};

// Rest-of-world statutory VAT/GST rules
const GLOBAL_VAT_GST_RULES: Record<
  string,
  {
    name: string;
    authority: string;
    taxType: TaxLineItem["taxType"];
    rateBps: number;
    filingRegime: string;
    b2bReverseChargeSupported: boolean;
  }
> = {
  GB: {
    name: "UK Value Added Tax (VAT)",
    authority: "HMRC_GB",
    taxType: "VAT",
    rateBps: 2000,
    filingRegime: "UK_MTD_VAT",
    b2bReverseChargeSupported: true,
  },
  NG: {
    name: "Nigeria Value Added Tax (VAT)",
    authority: "FIRS_NG",
    taxType: "VAT",
    rateBps: 750,
    filingRegime: "NG_FIRS_TAXPRO_MAX",
    b2bReverseChargeSupported: false,
  },
  KE: {
    name: "Kenya Value Added Tax (VAT)",
    authority: "KRA_KE",
    taxType: "VAT",
    rateBps: 1600,
    filingRegime: "KE_KRA_ITAX_TIMS",
    b2bReverseChargeSupported: false,
  },
  GH: {
    name: "Ghana Value Added Tax (VAT)",
    authority: "GRA_GH",
    taxType: "VAT",
    rateBps: 1500,
    filingRegime: "GH_GRA_EVAT",
    b2bReverseChargeSupported: false,
  },
  ZA: {
    name: "South Africa Value-Added Tax (VAT)",
    authority: "SARS_ZA",
    taxType: "VAT",
    rateBps: 1500,
    filingRegime: "ZA_SARS_EFILING",
    b2bReverseChargeSupported: false,
  },
  JP: {
    name: "Japanese Consumption Tax (JCT / 消費税)",
    authority: "NTA_JP",
    taxType: "JCT",
    rateBps: 1000,
    filingRegime: "JP_QUALIFIED_INVOICE_JCT",
    b2bReverseChargeSupported: false,
  },
  ID: {
    name: "Indonesia PPN (Pajak Pertambahan Nilai)",
    authority: "DJP_ID",
    taxType: "VAT",
    rateBps: 1100,
    filingRegime: "ID_PMSE_PPN",
    b2bReverseChargeSupported: false,
  },
  IN: {
    name: "India Goods and Services Tax (IGST / OIDAR)",
    authority: "CBIC_IN",
    taxType: "GST",
    rateBps: 1800,
    filingRegime: "IN_GSTN_OIDAR",
    b2bReverseChargeSupported: true,
  },
  SG: {
    name: "Singapore Goods and Services Tax (GST)",
    authority: "IRAS_SG",
    taxType: "GST",
    rateBps: 900,
    filingRegime: "SG_IRAS_OVR_GST",
    b2bReverseChargeSupported: true,
  },
  AU: {
    name: "Australia Goods and Services Tax (GST)",
    authority: "ATO_AU",
    taxType: "GST",
    rateBps: 1000,
    filingRegime: "AU_ATO_SIMPLIFIED_GST",
    b2bReverseChargeSupported: true,
  },
  NZ: {
    name: "New Zealand Goods and Services Tax (GST)",
    authority: "IRD_NZ",
    taxType: "GST",
    rateBps: 1500,
    filingRegime: "NZ_IRD_REMOTE_SERVICES_GST",
    b2bReverseChargeSupported: true,
  },
  CH: {
    name: "Switzerland MWST / TVA",
    authority: "ESTV_CH",
    taxType: "VAT",
    rateBps: 810,
    filingRegime: "CH_ESTV_MWST",
    b2bReverseChargeSupported: true,
  },
  BR: {
    name: "Brazil ICMS / ISS Digital",
    authority: "RFB_SEFAZ_BR",
    taxType: "ICMS_ISS",
    rateBps: 1700,
    filingRegime: "BR_NFSE_IBS_CBS",
    b2bReverseChargeSupported: false,
  },
  MX: {
    name: "Mexico Impuesto al Valor Agregado (IVA)",
    authority: "SAT_MX",
    taxType: "IVA",
    rateBps: 1600,
    filingRegime: "MX_SAT_CFDI_IVA",
    b2bReverseChargeSupported: false,
  },
};

// Validates VIES EU VAT numbers and major international business tax IDs
export function validateBusinessTaxId(country: string, rawTaxId?: string): {
  valid: boolean;
  normalized: string;
  scheme: string;
} {
  if (!rawTaxId) return { valid: false, normalized: "", scheme: "NONE" };
  const cleaned = rawTaxId.replace(/[\s.-]/g, "").toUpperCase();
  const c = country.trim().toUpperCase();

  // EU VIES format: 2-letter prefix (or EL for Greece) + 8-12 alphanumeric characters
  if (c in EU_VAT_RATES_BPS) {
    const expectedPrefix = c === "GR" ? "(GR|EL)" : c;
    const regex = new RegExp(`^${expectedPrefix}[A-Z0-9]{8,12}$`);
    return {
      valid: regex.test(cleaned),
      normalized: cleaned,
      scheme: "EU_VIES_VAT",
    };
  }
  if (c === "GB") {
    return {
      valid: /^GB(\d{9}|\d{12}|GD\d{3}|HA\d{3})$/.test(cleaned),
      normalized: cleaned,
      scheme: "UK_HMRC_VAT",
    };
  }
  if (c === "AU") {
    return {
      valid: /^(AU)?\d{11}$/.test(cleaned),
      normalized: cleaned,
      scheme: "AU_ABN",
    };
  }
  if (c === "SG") {
    return {
      valid: /^[0-9A-Z]{9,10}$/.test(cleaned),
      normalized: cleaned,
      scheme: "SG_UEN_GST",
    };
  }
  if (c === "IN") {
    return {
      valid: /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(cleaned),
      normalized: cleaned,
      scheme: "IN_GSTIN",
    };
  }
  if (c === "CH") {
    return {
      valid: /^CHE\d{9}(MWST|TVA|IVA)$/.test(cleaned),
      normalized: cleaned,
      scheme: "CH_UID_MWST",
    };
  }
  return {
    valid: cleaned.length >= 8,
    normalized: cleaned,
    scheme: "GENERIC_TAX_ID",
  };
}

function formatMoney(minor: bigint, currency: string, exponent: number): string {
  const f = fromMinorUnits(minor, currency);
  if (f !== null) return f;
  if (exponent === 0) return minor.toString();
  const s = minor.toString().padStart(exponent + 1, "0");
  return `${s.slice(0, -exponent)}.${s.slice(-exponent)}`;
}

function bpsToPercentString(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  if (frac === 0) return `${whole}%`;
  if (frac % 10 === 0) return `${whole}.${frac / 10}%`;
  return `${whole}.${String(frac).padStart(2, "0")}%`;
}

function computeComponentAmounts(
  inputAmountMinor: bigint,
  behavior: TaxBehavior,
  components: {
    name: string;
    jurisdiction: string;
    authority: string;
    rateBps: number;
    taxType: TaxLineItem["taxType"];
  }[],
  currency: string,
  exponent: number,
): {
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  lineItems: TaxLineItem[];
} {
  const totalRateBps = components.reduce((acc, c) => acc + c.rateBps, 0);
  if (totalRateBps === 0 || inputAmountMinor === 0n) {
    return {
      subtotalMinor: inputAmountMinor,
      taxMinor: 0n,
      totalMinor: inputAmountMinor,
      lineItems: components.map((c) => ({
        name: c.name,
        jurisdiction: c.jurisdiction,
        authority: c.authority,
        rateBps: c.rateBps,
        ratePercent: bpsToPercentString(c.rateBps),
        amountMinor: "0",
        formattedAmount: formatMoney(0n, currency, exponent),
        taxType: c.taxType,
      })),
    };
  }

  let subtotalMinor: bigint;
  if (behavior === "exclusive") {
    subtotalMinor = inputAmountMinor;
  } else {
    // Inclusive: subtotal = round(total * 10000 / (10000 + totalRateBps))
    const num = inputAmountMinor * 10_000n;
    const den = BigInt(10_000 + totalRateBps);
    const q = num / den;
    const r = num % den;
    subtotalMinor = r * 2n >= den ? q + 1n : q;
  }

  const lineItems: TaxLineItem[] = [];
  let accumulatedTax = 0n;

  for (let i = 0; i < components.length; i++) {
    const c = components[i]!;
    let itemTax: bigint;
    if (behavior === "inclusive" && i === components.length - 1) {
      itemTax = inputAmountMinor - subtotalMinor - accumulatedTax;
    } else {
      const num = subtotalMinor * BigInt(c.rateBps);
      const q = num / 10_000n;
      const r = num % 10_000n;
      itemTax = r >= 5_000n ? q + 1n : q;
    }
    accumulatedTax += itemTax;
    lineItems.push({
      name: c.name,
      jurisdiction: c.jurisdiction,
      authority: c.authority,
      rateBps: c.rateBps,
      ratePercent: bpsToPercentString(c.rateBps),
      amountMinor: itemTax.toString(),
      formattedAmount: formatMoney(itemTax, currency, exponent),
      taxType: c.taxType,
    });
  }

  const taxMinor = accumulatedTax;
  const totalMinor = behavior === "exclusive" ? subtotalMinor + taxMinor : inputAmountMinor;
  return { subtotalMinor, taxMinor, totalMinor, lineItems };
}

export function calculateCheckoutTax(input: TaxCalculationInput): TaxCalculationResult {
  const now = input.now ?? new Date();
  const amountMinor = BigInt(input.amountMinor);
  if (amountMinor < 0n) throw new PortalError("NEGATIVE_TAX_BASE_AMOUNT", 400);

  const currency = input.currency.trim().toUpperCase();
  const exponent = currencyExponent(currency) ?? 2;
  const behavior: TaxBehavior = input.taxBehavior ?? "exclusive";
  const category: ProductTaxCategory = input.productCategory ?? "saas";
  const buyerCountry = input.buyerAddress.country.trim().toUpperCase();
  const buyerState = input.buyerAddress.stateOrProvince?.trim().toUpperCase();
  const sellerCountry = input.sellerCountry?.trim().toUpperCase() ?? "US";

  const makeResult = (params: {
    components: {
      name: string;
      jurisdiction: string;
      authority: string;
      rateBps: number;
      taxType: TaxLineItem["taxType"];
    }[];
    reverseCharge?: boolean;
    exemptionReason?: TaxCalculationResult["exemptionReason"];
    statutoryNotice?: string;
    jurisdictionCode: string;
    filingRegime: string;
  }): TaxCalculationResult => {
    const { subtotalMinor, taxMinor, totalMinor, lineItems } = computeComponentAmounts(
      amountMinor,
      behavior,
      params.components,
      currency,
      exponent,
    );
    const effectiveRateBps = params.components.reduce((acc, c) => acc + c.rateBps, 0);
    const idHash = deterministicHexDigest(
      `${buyerCountry}:${buyerState ?? ""}:${currency}:${amountMinor}:${effectiveRateBps}:${behavior}:${now.toISOString()}`,
      18,
    );

    return {
      calculationId: `tax_${idHash}`,
      currency,
      exponent,
      taxBehavior: behavior,
      productCategory: category,
      subtotalMinor: subtotalMinor.toString(),
      taxMinor: taxMinor.toString(),
      totalMinor: totalMinor.toString(),
      formattedSubtotal: formatMoney(subtotalMinor, currency, exponent),
      formattedTax: formatMoney(taxMinor, currency, exponent),
      formattedTotal: formatMoney(totalMinor, currency, exponent),
      effectiveRateBps,
      effectiveRatePercent: bpsToPercentString(effectiveRateBps),
      reverseCharge: params.reverseCharge ?? false,
      exemptionReason: params.exemptionReason ?? "NONE",
      ...(params.statutoryNotice ? { statutoryNotice: params.statutoryNotice } : {}),
      jurisdictionCode: params.jurisdictionCode,
      filingRegime: params.filingRegime,
      lineItems,
      calculatedAt: now.toISOString(),
    };
  };

  if (category === "exempt") {
    return makeResult({
      components: [],
      exemptionReason: "PRODUCT_EXEMPT",
      jurisdictionCode: buyerCountry,
      filingRegime: "EXEMPT_SUPPLY",
    });
  }

  // 1. European Union (27 Member States)
  if (buyerCountry in EU_VAT_RATES_BPS) {
    const euRule = EU_VAT_RATES_BPS[buyerCountry]!;
    const taxIdCheck = validateBusinessTaxId(buyerCountry, input.buyerTaxId);
    // Cross-border B2B Reverse Charge applies when buyer has a valid EU VAT ID
    // and seller is outside the buyer's EU member state.
    if (taxIdCheck.valid && sellerCountry !== buyerCountry) {
      return makeResult({
        components: [
          {
            name: `${euRule.name} (Reverse Charge 0%)`,
            jurisdiction: `EU-${buyerCountry}`,
            authority: `EU_VAT_${buyerCountry}`,
            rateBps: 0,
            taxType: "VAT",
          },
        ],
        reverseCharge: true,
        exemptionReason: "B2B_REVERSE_CHARGE",
        statutoryNotice:
          "Reverse charge — VAT to be accounted for by the recipient per Article 196 of Council Directive 2006/112/EC.",
        jurisdictionCode: `EU-${buyerCountry}`,
        filingRegime: sellerCountry in EU_VAT_RATES_BPS ? "EU_EC_SALES_LIST_B2B" : "NON_EU_B2B_REVERSE_CHARGE",
      });
    }

    return makeResult({
      components: [
        {
          name: euRule.name,
          jurisdiction: `EU-${buyerCountry}`,
          authority: `EU_VAT_${buyerCountry}`,
          rateBps: euRule.rateBps,
          taxType: "VAT",
        },
      ],
      jurisdictionCode: `EU-${buyerCountry}`,
      filingRegime: sellerCountry === buyerCountry ? `EU_DOMESTIC_VAT_${buyerCountry}` : "EU_OSS_VAT",
    });
  }

  // 2. United States State & Local Sales Tax
  if (buyerCountry === "US") {
    const state = buyerState || "NY";
    const rule = US_STATE_TAX_RULES[state];
    if (!rule || (rule.stateRateBps === 0 && rule.defaultLocalBps === 0)) {
      return makeResult({
        components: [],
        exemptionReason: "US_NO_STATE_SALES_TAX",
        jurisdictionCode: `US-${state}`,
        filingRegime: `US_STATE_${state}_EXEMPT`,
      });
    }

    if (input.usNexusStates && !input.usNexusStates.map((s) => s.toUpperCase()).includes(state)) {
      return makeResult({
        components: [],
        exemptionReason: "US_OUTSIDE_NEXUS",
        jurisdictionCode: `US-${state}`,
        filingRegime: `US_STATE_${state}_NO_NEXUS`,
      });
    }

    const isTaxableCategory =
      category === "physical" ||
      (category === "saas" && rule.saasTaxable) ||
      (category === "digital" && rule.digitalTaxable);

    if (!isTaxableCategory) {
      return makeResult({
        components: [
          {
            name: `${rule.name} State Sales Tax (Exempt ${category.toUpperCase()})`,
            jurisdiction: `US-${state}`,
            authority: `US_DOR_${state}`,
            rateBps: 0,
            taxType: "SALES_TAX",
          },
        ],
        exemptionReason: "US_SAAS_STATE_EXEMPT",
        jurisdictionCode: `US-${state}`,
        filingRegime: `US_STATE_SALES_TAX_${state}`,
      });
    }

    const components: {
      name: string;
      jurisdiction: string;
      authority: string;
      rateBps: number;
      taxType: TaxLineItem["taxType"];
    }[] = [
      {
        name: `${rule.name} State Sales Tax`,
        jurisdiction: `US-${state}`,
        authority: `US_DOR_${state}`,
        rateBps: rule.stateRateBps,
        taxType: "SALES_TAX",
      },
    ];
    if (rule.defaultLocalBps > 0) {
      components.push({
        name: `${rule.name} Local / County / Transit District Tax`,
        jurisdiction: `US-${state}-LOCAL`,
        authority: `US_DOR_${state}`,
        rateBps: rule.defaultLocalBps,
        taxType: "SALES_TAX",
      });
    }

    return makeResult({
      components,
      jurisdictionCode: `US-${state}`,
      filingRegime: `US_STATE_SALES_TAX_${state}`,
    });
  }

  // 3. Canada Federal & Provincial GST / HST / QST / PST
  if (buyerCountry === "CA") {
    const prov = buyerState && CANADA_PROVINCE_RULES[buyerState] ? buyerState : "ON";
    const provRule = CANADA_PROVINCE_RULES[prov]!;
    return makeResult({
      components: provRule.components.map((c) => ({
        name: c.name,
        jurisdiction: `CA-${prov}`,
        authority: c.authority,
        rateBps: c.rateBps,
        taxType: c.taxType,
      })),
      jurisdictionCode: `CA-${prov}`,
      filingRegime: `CA_GST_HST_${prov}`,
    });
  }

  // 4. Rest of World Statutory VAT / GST / JCT / IVA
  const globalRule = GLOBAL_VAT_GST_RULES[buyerCountry];
  if (globalRule) {
    const taxIdCheck = validateBusinessTaxId(buyerCountry, input.buyerTaxId);
    if (
      globalRule.b2bReverseChargeSupported &&
      taxIdCheck.valid &&
      sellerCountry !== buyerCountry
    ) {
      return makeResult({
        components: [
          {
            name: `${globalRule.name} (B2B Reverse Charge 0%)`,
            jurisdiction: buyerCountry,
            authority: globalRule.authority,
            rateBps: 0,
            taxType: globalRule.taxType,
          },
        ],
        reverseCharge: true,
        exemptionReason: "B2B_REVERSE_CHARGE",
        statutoryNotice: `B2B Cross-Border Reverse Charge applied for verified tax ID ${taxIdCheck.normalized}.`,
        jurisdictionCode: buyerCountry,
        filingRegime: `${globalRule.filingRegime}_B2B_REVERSE`,
      });
    }

    return makeResult({
      components: [
        {
          name: globalRule.name,
          jurisdiction: buyerCountry,
          authority: globalRule.authority,
          rateBps: globalRule.rateBps,
          taxType: globalRule.taxType,
        },
      ],
      jurisdictionCode: buyerCountry,
      filingRegime: globalRule.filingRegime,
    });
  }

  // Fallback for zero-rated international export jurisdictions
  return makeResult({
    components: [],
    exemptionReason: "EXPORT_ZERO_RATED",
    jurisdictionCode: buyerCountry,
    filingRegime: "INTERNATIONAL_ZERO_RATED",
  });
}

export type TaxRemittanceSummaryBucket = {
  jurisdictionCode: string;
  filingRegime: string;
  currency: string;
  transactionCount: number;
  reverseChargeCount: number;
  taxableSubtotalMinor: string;
  totalTaxCollectedMinor: string;
  grossTotalMinor: string;
};

export function buildTaxComplianceReport(
  calculations: readonly TaxCalculationResult[],
): TaxRemittanceSummaryBucket[] {
  const buckets = new Map<
    string,
    {
      jurisdictionCode: string;
      filingRegime: string;
      currency: string;
      transactionCount: number;
      reverseChargeCount: number;
      taxableSubtotalMinor: bigint;
      totalTaxCollectedMinor: bigint;
      grossTotalMinor: bigint;
    }
  >();

  for (const calc of calculations) {
    const key = `${calc.jurisdictionCode}:${calc.filingRegime}:${calc.currency}`;
    const existing = buckets.get(key) ?? {
      jurisdictionCode: calc.jurisdictionCode,
      filingRegime: calc.filingRegime,
      currency: calc.currency,
      transactionCount: 0,
      reverseChargeCount: 0,
      taxableSubtotalMinor: 0n,
      totalTaxCollectedMinor: 0n,
      grossTotalMinor: 0n,
    };
    existing.transactionCount += 1;
    if (calc.reverseCharge) existing.reverseChargeCount += 1;
    existing.taxableSubtotalMinor += BigInt(calc.subtotalMinor);
    existing.totalTaxCollectedMinor += BigInt(calc.taxMinor);
    existing.grossTotalMinor += BigInt(calc.totalMinor);
    buckets.set(key, existing);
  }

  return [...buckets.values()].map((b) => ({
    jurisdictionCode: b.jurisdictionCode,
    filingRegime: b.filingRegime,
    currency: b.currency,
    transactionCount: b.transactionCount,
    reverseChargeCount: b.reverseChargeCount,
    taxableSubtotalMinor: b.taxableSubtotalMinor.toString(),
    totalTaxCollectedMinor: b.totalTaxCollectedMinor.toString(),
    grossTotalMinor: b.grossTotalMinor.toString(),
  }));
}
