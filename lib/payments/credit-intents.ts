// Global Asynchronous Credit Intent & Continental BNPL Backdoor Switch Engine.
//
// 1. Universal BNPL Backdoor Partner Map by Continent:
//    - Europe (UK, EU): Adyen Automated Signup (Klarna, Clearpay, PayPal Credit, Alma)
//      + Tink PSD2 Open Banking overdraft-line direct debit mandates
//    - Latin America (BR, MX, CO, AR, CL, PE): Mercado Pago Developers
//      (Mercado Crédito, Kueski Pay, Addi, NuPay) + Belvo Open Finance credit-line draw
//    - Africa (NG, KE, GH, ZA): Migo Cloud Lending API (Migo Credit, Carbon POS,
//      CredPal, CDL Rails) + Mono Open Banking Wallet Relay (OPay/EaseMoni, FairMoney, Kuda)
//    - Asia-Pacific (IN, SG, ID, MY, AU, PH): Xendit BNPL Switch
//      (Akulaku, Kredivo, ShopeePay Later, Atome) + Setu Open Financial Network (UPI Credit Line)
//
// 2. Internal Ledger & Fulfillment State Machine:
//    [ checkout.initiated ] -> [ credit.pending_approval ] -> [ credit.disbursed ] -> [ payment.succeeded ]
//    Guarantees a merchant never ships a product before the lender disburses 100% of fiat principal.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { currencyExponent, fromMinorUnits } from "../partners/money";
import { PortalError } from "../portal/domain";
import type { CreditOffer } from "../treasury/platforms/contract";
import {
  europeBnplCountries,
  europeBnplOffers,
} from "../treasury/platforms/adyen-klarna-bnpl";
import {
  latamBnplCountries,
  latamBnplOffers,
} from "../treasury/platforms/mercadopago-bnpl";
import {
  africaBnplCountries,
  africaBnplOffers,
} from "../treasury/platforms/migo-bnpl";
import {
  apacBnplCountries,
  apacBnplOffers,
} from "../treasury/platforms/xendit-bnpl";
import { post, validatePostings, type Posting } from "./journal";
import type { Tx } from "./service";

export type ContinentCode =
  | "EUROPE"
  | "LATIN_AMERICA"
  | "AFRICA"
  | "ASIA_PACIFIC";

export type CreditType = "bnpl" | "open_banking_overdraft" | "card_installments";

export type CreditLifecycleState =
  | "checkout.initiated"
  | "credit.pending_approval"
  | "credit.disbursed"
  | "payment.succeeded"
  | "credit.declined";

export type ContinentalCreditSwitchRoute = {
  continent: ContinentCode;
  country: string;
  platformModuleId:
    | "adyen-klarna-bnpl"
    | "mercadopago-bnpl"
    | "migo-bnpl"
    | "xendit-bnpl";
  primaryBnplSwitch: string;
  coreNetworks: readonly string[];
  openBankingOrCardBackdoor: string;
  openBankingNetworks: readonly string[];
};

export const creditIntentInputSchema = z.object({
  // Accepts minor-unit integer or major-unit numeric/string depending on `amountInMinorUnits`
  // Defaults to major units when integer is passed in `/v1/credit_intents` (e.g. 250000 NGN -> 25,000,000 kobo)
  // unless `amountUnit: "minor"` is set.
  amount: z.union([z.number().positive(), z.string().min(1), z.bigint()]),
  amountUnit: z.enum(["major", "minor"]).default("major"),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  customer: z.object({
    phone: z.string().min(7).max(24),
    bvn_hash: z.string().min(6).max(128).optional(),
    national_id_hash: z.string().min(4).max(128).optional(),
    country: z.string().regex(/^[A-Za-z]{2}$/),
    email: z.string().email().optional(),
  }),
  credit_type: z
    .enum(["bnpl", "open_banking_overdraft", "card_installments"])
    .default("bnpl"),
  reference: z.string().min(1).max(100).optional(),
  platformFeeBps: z.number().int().min(0).max(2000).default(100),
  lenderMerchantFeeBps: z.number().int().min(0).max(3000).default(250),
});

export type CreditIntentInput = z.input<typeof creditIntentInputSchema>;

export type CreditStateTransitionLog = {
  from: CreditLifecycleState | null;
  to: CreditLifecycleState;
  at: string;
  actor: string;
  note: string;
};

export type GlobalCreditIntent = {
  id: string;
  reference: string;
  state: CreditLifecycleState;
  creditType: CreditType;
  currency: string;
  exponent: number;
  principalAmountMinor: string;
  formattedPrincipal: string;
  platformFeeMinor: string;
  lenderMerchantFeeMinor: string;
  expectedMerchantNetMinor: string;
  customer: {
    phoneMasked: string;
    country: string;
    identityVerified: boolean;
    identityScheme: "BVN_HASH" | "NATIONAL_ID_HASH" | "PHONE_OTP_ONLY";
  };
  route: ContinentalCreditSwitchRoute;
  offers: CreditOffer[];
  selectedOfferId: string | null;
  selectedLender: string | null;
  lenderApplicationRef: string | null;
  lenderDisbursementRef: string | null;
  disbursedAmountMinor: string | null;
  fulfillmentAllowed: boolean;
  fulfillmentGateReason: string;
  fallbackCheckoutOpen: boolean;
  ledgerPostings: Posting[] | null;
  timeline: CreditStateTransitionLog[];
  createdAt: string;
  updatedAt: string;
};

export function resolveContinentalCreditRoute(
  rawCountry: string,
): ContinentalCreditSwitchRoute {
  const country = rawCountry.trim().toUpperCase();

  if ((europeBnplCountries as readonly string[]).includes(country)) {
    return {
      continent: "EUROPE",
      country,
      platformModuleId: "adyen-klarna-bnpl",
      primaryBnplSwitch: "Adyen (Automated Merchant Signup)",
      coreNetworks: ["Klarna (Pay in 3 / Financing)", "Clearpay", "PayPal Credit", "Alma"],
      openBankingOrCardBackdoor: "Tink (Visa Company) Open Banking PSD2 Mandate",
      openBankingNetworks: ["Tink PSD2 Overdraft Line", "SEPA Instant Mandate", "UK Faster Payments Overdraft"],
    };
  }

  if ((latamBnplCountries as readonly string[]).includes(country)) {
    return {
      continent: "LATIN_AMERICA",
      country,
      platformModuleId: "mercadopago-bnpl",
      primaryBnplSwitch: "Mercado Pago Developers",
      coreNetworks: ["Mercado Crédito", "Kueski Pay", "Addi", "NuPay (Nubank Installments)"],
      openBankingOrCardBackdoor: "Belvo Open Finance Engine",
      openBankingNetworks: ["Nubank Open Finance Credit Draw", "Itaú / Bradesco Pix Parcelado", "BBVA MX Credit Line"],
    };
  }

  if ((africaBnplCountries as readonly string[]).includes(country)) {
    return {
      continent: "AFRICA",
      country,
      platformModuleId: "migo-bnpl",
      primaryBnplSwitch: "Migo Cloud Lending API",
      coreNetworks: ["Migo Credit", "Carbon Point-of-Sale", "CredPal", "CDL Rails"],
      openBankingOrCardBackdoor: "Mono Open Banking / Wallet Relay",
      openBankingNetworks: ["OPay / EaseMoni", "FairMoney Credit Line", "Kuda Overdraft", "PalmPay Flexi"],
    };
  }

  if ((apacBnplCountries as readonly string[]).includes(country)) {
    return {
      continent: "ASIA_PACIFIC",
      country,
      platformModuleId: "xendit-bnpl",
      primaryBnplSwitch: "Xendit BNPL Switch",
      coreNetworks: ["Akulaku", "Kredivo", "ShopeePay Later", "Atome"],
      openBankingOrCardBackdoor: "Setu Open Financial Network (India Account Aggregator / UPI Credit)",
      openBankingNetworks: ["NPCI UPI Credit Line", "Setu Account Aggregator", "RuPay Credit on UPI"],
    };
  }

  throw new PortalError(`UNSUPPORTED_CREDIT_COUNTRY:${country}`, 409);
}

function normalizeToMinorUnits(
  amount: number | string | bigint,
  amountUnit: "major" | "minor",
  currency: string,
): bigint {
  const exp = currencyExponent(currency) ?? 2;
  if (amountUnit === "minor") {
    const v = BigInt(amount);
    if (v <= 0n) throw new PortalError("INVALID_CREDIT_AMOUNT", 400);
    return v;
  }
  if (typeof amount === "bigint") {
    if (amount <= 0n) throw new PortalError("INVALID_CREDIT_AMOUNT", 400);
    return amount * 10n ** BigInt(exp);
  }
  const str = String(amount).trim();
  const match = str.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new PortalError("INVALID_CREDIT_AMOUNT", 400);
  const whole = BigInt(match[1]!);
  const fracStr = (match[2] ?? "").slice(0, exp).padEnd(exp, "0");
  const frac = BigInt(fracStr || "0");
  const total = whole * 10n ** BigInt(exp) + frac;
  if (total <= 0n) throw new PortalError("INVALID_CREDIT_AMOUNT", 400);
  return total;
}

function maskPhone(phone: string): string {
  const cleaned = phone.trim();
  if (cleaned.length <= 6) return "***";
  return `${cleaned.slice(0, 4)}****${cleaned.slice(-3)}`;
}

function offersForContinentalRoute(
  route: ContinentalCreditSwitchRoute,
  amountMinor: bigint,
): CreditOffer[] {
  switch (route.platformModuleId) {
    case "adyen-klarna-bnpl":
      return europeBnplOffers(amountMinor, route.country);
    case "mercadopago-bnpl":
      return latamBnplOffers(amountMinor, route.country);
    case "migo-bnpl":
      return africaBnplOffers(amountMinor, route.country);
    case "xendit-bnpl":
      return apacBnplOffers(amountMinor, route.country);
  }
}

// Stage 1: [ checkout.initiated ]
// Captures buyer's billing/identity details, resolves the continental self-serve
// BNPL / Open Banking switch, prices eligible installment plans, and initializes
// the credit state machine with `fulfillmentAllowed: false`.
export function createCreditIntent(
  rawInput: CreditIntentInput,
  now = new Date(),
): GlobalCreditIntent {
  const parsed = creditIntentInputSchema.parse(rawInput);
  const currency = parsed.currency.toUpperCase();
  const exponent = currencyExponent(currency) ?? 2;
  const principalMinor = normalizeToMinorUnits(parsed.amount, parsed.amountUnit, currency);
  const route = resolveContinentalCreditRoute(parsed.customer.country);

  // Africa Migo underwriting requires phone + BVN hash in NG when amount > 50,000 NGN
  if (
    route.country === "NG" &&
    parsed.credit_type === "bnpl" &&
    !parsed.customer.bvn_hash &&
    !parsed.customer.national_id_hash
  ) {
    throw new PortalError("AFRICA_BNPL_REQUIRES_BVN_OR_NIN_HASH", 400);
  }

  const offers = offersForContinentalRoute(route, principalMinor);
  if (!offers.length) {
    throw new PortalError("NO_CREDIT_OFFERS_FOR_AMOUNT_AND_COUNTRY", 409);
  }

  // Pick default recommended offer matching credit_type
  const defaultOffer =
    parsed.credit_type === "open_banking_overdraft"
      ? offers.find((o) => o.id.includes("overdraft") || o.id.includes("openfinance") || o.id.includes("mono") || o.id.includes("setu")) ?? offers[0]!
      : parsed.credit_type === "card_installments"
        ? offers.find((o) => o.id.includes("vis-mc")) ?? offers[0]!
        : offers[0]!;

  const platformFeeMinor = (principalMinor * BigInt(parsed.platformFeeBps)) / 10_000n;
  const lenderMerchantFeeMinor = (principalMinor * BigInt(parsed.lenderMerchantFeeBps)) / 10_000n;
  const expectedMerchantNetMinor = principalMinor - platformFeeMinor - lenderMerchantFeeMinor;

  const identityScheme: GlobalCreditIntent["customer"]["identityScheme"] = parsed.customer.bvn_hash
    ? "BVN_HASH"
    : parsed.customer.national_id_hash
      ? "NATIONAL_ID_HASH"
      : "PHONE_OTP_ONLY";

  const nowIso = now.toISOString();
  const id = `ci_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

  return {
    id,
    reference: parsed.reference ?? `cred_${id.slice(3, 13)}`,
    state: "checkout.initiated",
    creditType: parsed.credit_type,
    currency,
    exponent,
    principalAmountMinor: principalMinor.toString(),
    formattedPrincipal: fromMinorUnits(principalMinor, currency) ?? principalMinor.toString(),
    platformFeeMinor: platformFeeMinor.toString(),
    lenderMerchantFeeMinor: lenderMerchantFeeMinor.toString(),
    expectedMerchantNetMinor: expectedMerchantNetMinor.toString(),
    customer: {
      phoneMasked: maskPhone(parsed.customer.phone),
      country: route.country,
      identityVerified: Boolean(parsed.customer.bvn_hash || parsed.customer.national_id_hash),
      identityScheme,
    },
    route,
    offers,
    selectedOfferId: defaultOffer.id,
    selectedLender: defaultOffer.lender,
    lenderApplicationRef: null,
    lenderDisbursementRef: null,
    disbursedAmountMinor: null,
    fulfillmentAllowed: false,
    fulfillmentGateReason: "AWAITING_CREDIT_APPROVAL_AND_LENDER_DISBURSAL",
    fallbackCheckoutOpen: true,
    ledgerPostings: null,
    timeline: [
      {
        from: null,
        to: "checkout.initiated",
        at: nowIso,
        actor: "buyer",
        note: `Buyer selected ${parsed.credit_type} via ${route.primaryBnplSwitch} (${defaultOffer.lender}).`,
      },
    ],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// Stage 2: [ checkout.initiated ] -> [ credit.pending_approval ]
// Dispatches the credit check / OTP verification / Open Banking mandate to the lender.
export function submitCreditForApproval(
  intent: GlobalCreditIntent,
  input: {
    offerId?: string;
    lenderApplicationRef: string;
    now?: Date;
  },
): GlobalCreditIntent {
  if (intent.state !== "checkout.initiated") {
    throw new PortalError(`INVALID_CREDIT_TRANSITION:${intent.state}->credit.pending_approval`, 409);
  }
  const offerId = input.offerId ?? intent.selectedOfferId;
  const chosen = intent.offers.find((o) => o.id === offerId);
  if (!chosen) {
    throw new PortalError("CREDIT_PLAN_NO_LONGER_OFFERED", 409);
  }
  const nowIso = (input.now ?? new Date()).toISOString();

  return {
    ...intent,
    state: "credit.pending_approval",
    selectedOfferId: chosen.id,
    selectedLender: chosen.lender,
    lenderApplicationRef: input.lenderApplicationRef,
    fulfillmentAllowed: false,
    fulfillmentGateReason: "CREDIT_CHECK_IN_PROGRESS_DO_NOT_SHIP",
    fallbackCheckoutOpen: false,
    timeline: [
      ...intent.timeline,
      {
        from: "checkout.initiated",
        to: "credit.pending_approval",
        at: nowIso,
        actor: chosen.lender,
        note: `Credit underwriting and OTP verification started (application ${input.lenderApplicationRef}).`,
      },
    ],
    updatedAt: nowIso,
  };
}

// Handles an asynchronous credit decline from the lender, reopening fallback payment methods.
export function recordCreditDecline(
  intent: GlobalCreditIntent,
  input: { reason: string; now?: Date },
): GlobalCreditIntent {
  if (intent.state !== "checkout.initiated" && intent.state !== "credit.pending_approval") {
    throw new PortalError(`INVALID_CREDIT_TRANSITION:${intent.state}->credit.declined`, 409);
  }
  const nowIso = (input.now ?? new Date()).toISOString();
  return {
    ...intent,
    state: "credit.declined",
    fulfillmentAllowed: false,
    fulfillmentGateReason: `CREDIT_DECLINED:${input.reason}`,
    fallbackCheckoutOpen: true,
    timeline: [
      ...intent.timeline,
      {
        from: intent.state,
        to: "credit.declined",
        at: nowIso,
        actor: intent.selectedLender ?? "lender",
        note: `Lender declined credit application (${input.reason}); checkout reopened for alternative payment methods.`,
      },
    ],
    updatedAt: nowIso,
  };
}

// Stage 3: [ credit.pending_approval ] -> [ credit.disbursed ]
// Recorded ONLY when the lender confirms loan approval AND disburses 100% of principal
// (or net of contractual lender merchant discount) into PayRouta/merchant clearing.
export function recordLenderDisbursal(
  intent: GlobalCreditIntent,
  input: {
    lenderDisbursementRef: string;
    disbursedPrincipalMinor: bigint | number | string;
    now?: Date;
  },
): GlobalCreditIntent {
  if (intent.state !== "credit.pending_approval") {
    throw new PortalError(`INVALID_CREDIT_TRANSITION:${intent.state}->credit.disbursed`, 409);
  }
  const expectedPrincipal = BigInt(intent.principalAmountMinor);
  const disbursedPrincipal = BigInt(input.disbursedPrincipalMinor);

  // Strict guard: never accept partial principal funding from a lender
  if (disbursedPrincipal !== expectedPrincipal) {
    throw new PortalError("LENDER_PARTIAL_DISBURSAL_REJECTED", 409);
  }

  const nowIso = (input.now ?? new Date()).toISOString();
  return {
    ...intent,
    state: "credit.disbursed",
    lenderDisbursementRef: input.lenderDisbursementRef,
    disbursedAmountMinor: disbursedPrincipal.toString(),
    // Still false until Stage 4 (`payment.succeeded`) books the internal ledger!
    fulfillmentAllowed: false,
    fulfillmentGateReason: "LENDER_FUNDS_RECEIVED_BOOKING_LEDGER",
    fallbackCheckoutOpen: false,
    timeline: [
      ...intent.timeline,
      {
        from: "credit.pending_approval",
        to: "credit.disbursed",
        at: nowIso,
        actor: intent.selectedLender ?? "lender",
        note: `Lender disbursed 100% of principal (${disbursedPrincipal.toString()} minor ${intent.currency}, ref ${input.lenderDisbursementRef}).`,
      },
    ],
    updatedAt: nowIso,
  };
}

// Stage 4: [ credit.disbursed ] -> [ payment.succeeded ]
// Books the balanced ledger postings (`provider-clearing` -> `merchant-payable` + `provider-fee`)
// and unlocks `fulfillmentAllowed: true` so the merchant can safely ship the order.
export function finalizeCreditPaymentSuccess(
  intent: GlobalCreditIntent,
  now = new Date(),
): GlobalCreditIntent {
  if (intent.state !== "credit.disbursed") {
    throw new PortalError(`INVALID_CREDIT_TRANSITION:${intent.state}->payment.succeeded`, 409);
  }
  const principal = BigInt(intent.principalAmountMinor);
  const platformFee = BigInt(intent.platformFeeMinor);
  const lenderFee = BigInt(intent.lenderMerchantFeeMinor);
  const totalFee = platformFee + lenderFee;
  const merchantNet = BigInt(intent.expectedMerchantNetMinor);

  const postings: Posting[] = [
    { account: "provider-clearing", debit: principal.toString(), credit: "0" },
    { account: "merchant-payable", debit: "0", credit: merchantNet.toString() },
  ];
  if (totalFee > 0n) {
    postings.push({ account: "provider-fee", debit: "0", credit: totalFee.toString() });
  }
  validatePostings(postings);

  const nowIso = now.toISOString();
  return {
    ...intent,
    state: "payment.succeeded",
    fulfillmentAllowed: true,
    fulfillmentGateReason: "CLEARED_FOR_MERCHANT_SHIPPING",
    fallbackCheckoutOpen: false,
    ledgerPostings: postings,
    timeline: [
      ...intent.timeline,
      {
        from: "credit.disbursed",
        to: "payment.succeeded",
        at: nowIso,
        actor: "payrouta-ledger",
        note: `Booked ${merchantNet.toString()} minor ${intent.currency} to merchant-payable; merchant fulfillment unlocked.`,
      },
    ],
    updatedAt: nowIso,
  };
}

// Guard called by merchant fulfillment webhooks / shipping pipelines.
// Refuses shipping unless the credit intent has reached `payment.succeeded`.
export function assertMerchantFulfillmentAllowed(intent: GlobalCreditIntent): {
  allowed: true;
  fulfillmentToken: string;
  lenderDisbursementRef: string;
  settledMerchantNetMinor: string;
} {
  if (intent.state !== "payment.succeeded" || !intent.fulfillmentAllowed || !intent.lenderDisbursementRef) {
    throw new PortalError(
      `FULFILLMENT_BLOCKED_AWAITING_LENDER_DISBURSAL:${intent.state}:${intent.fulfillmentGateReason}`,
      409,
    );
  }
  const fulfillmentToken = `ship_${createHash("sha256")
    .update(`${intent.id}:${intent.lenderDisbursementRef}:${intent.expectedMerchantNetMinor}`)
    .digest("hex")
    .slice(0, 20)}`;
  return {
    allowed: true,
    fulfillmentToken,
    lenderDisbursementRef: intent.lenderDisbursementRef,
    settledMerchantNetMinor: intent.expectedMerchantNetMinor,
  };
}

// Persists the finalized credit settlement to the PostgreSQL immutable JournalEntry table.
export async function postDisbursedCreditToLedger(
  tx: Tx,
  input: {
    orgId: string;
    environment: string;
    intent: GlobalCreditIntent;
    effectiveAt?: Date;
  },
) {
  if (input.intent.state !== "payment.succeeded" || !input.intent.ledgerPostings) {
    throw new PortalError("CANNOT_POST_UNFINALIZED_CREDIT_INTENT", 409);
  }
  const effectiveAt = input.effectiveAt ?? new Date();
  const operationalEntry = await post(
    tx,
    {
      orgId: input.orgId,
      environment: input.environment,
      source: `credit-intent:${input.intent.id}:settlement`,
      asset: input.intent.currency,
      purpose: `BNPL Disbursal (${input.intent.selectedLender ?? input.intent.route.primaryBnplSwitch}) ref ${input.intent.lenderDisbursementRef}`,
      effectiveAt,
      book: "provider-merchant-operational",
    },
    input.intent.ledgerPostings,
  );

  const platformFee = BigInt(input.intent.platformFeeMinor);
  let accrualEntry = null;
  if (platformFee > 0n) {
    accrualEntry = await post(
      tx,
      {
        orgId: input.orgId,
        environment: input.environment,
        source: `credit-intent:${input.intent.id}:platform-fee`,
        asset: input.intent.currency,
        purpose: `PayRouta BNPL platform fee accrual (${input.intent.id})`,
        effectiveAt,
        book: "payrouta-platform-accrual",
      },
      [
        { account: "platform-receivable", debit: platformFee.toString(), credit: "0" },
        { account: "platform-fee-revenue", debit: "0", credit: platformFee.toString() },
      ],
    );
  }

  return { operationalEntry, accrualEntry };
}
