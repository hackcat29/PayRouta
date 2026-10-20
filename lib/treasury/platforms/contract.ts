// Platform module contract (docs/AGGREGATOR.md). A platform module drives one
// provider's platform programme on PayRouta's own master account: it opens a
// sub-account for each merchant entirely by API from the details the merchant
// gave PayRouta (merchants never see or visit the provider), takes payments on
// the merchant's behalf with PayRouta's fee withheld at source, and reports
// when the merchant's share becomes available.
//
// Adding a platform means one module here and one line in ./registry.
import type { z } from "zod";
import type { KybField, KybProfile } from "../../partners/kyb";
import type {
  ExecutableMethod,
  PartnerDeps,
  StatusSnapshot,
} from "../../partners/contract";
import type { PlatformCustody } from "../custody";
import type { VerificationDetails } from "../verification";

export interface PlatformManifest {
  id: string;
  name: string;
  custody: PlatformCustody;
  // False for split settlement: the provider pays the merchant directly, so
  // PayRouta cannot hold a reserve or schedule payouts on this rail.
  holdsFunds: boolean;
  // The provider takes its processing fee from the merchant's share (true)
  // or charges it to PayRouta (false).
  merchantBearsProcessingFee: boolean;
  // "withheld": PayRouta's fee is taken from each payment at source.
  // "invoice": the provider pays the merchant in full (pay by bank), so the
  // fee goes on PayRouta's monthly statement instead.
  feeCollection: "withheld" | "invoice";
  // Payments name the merchant's bank account as the recipient (pay by bank).
  needsPayoutAccount?: boolean;
  // Merchant countries the provider's programme supports (null: any).
  merchantCountries: readonly string[] | null;
  methods: readonly ExecutableMethod[];
  // Exactly the KYB fields sent to the provider when creating a sub-account.
  sharedFields: readonly KybField[];
  // Hosts a customer's payment redirect may point to.
  paymentHosts: readonly string[];
  documentation: string;
  // Sandbox-only modules never run outside local mode.
  sandboxOnly?: boolean;
  // Set for credit partners (method "bnpl"): the licensed lender the
  // customer borrows from. Unlike other rails, the lender is named at
  // checkout, because the customer enters a credit agreement with it.
  credit?: CreditLender;
}

export interface CreditLender {
  // Legal name shown to the customer before they agree.
  lender: string;
  // Where the lender's credit terms and licence are published.
  termsUrl: string;
  // Payer countries the lender can lend to (null: any).
  countries: readonly string[] | null;
}

// One way to pay on credit, priced by the lender for this exact amount.
// Amounts are minor units of the payment currency, as strings.
export interface CreditOffer {
  // Stable for the same lender, amount and currency.
  id: string;
  lender: string;
  // "instalments": split into equal payments. "pay-later": one payment later.
  kind: "instalments" | "pay-later";
  instalments: number;
  interval: "week" | "two-weeks" | "month";
  dueTodayMinor: string;
  // The regular instalment. When the total doesn't divide evenly, the first
  // instalment is up to one minor unit per remaining payment larger, and is
  // given separately.
  instalmentMinor: string;
  firstInstalmentMinor?: string;
  // Everything the customer repays, and the part that is interest and fees.
  totalMinor: string;
  costMinor: string;
  // Annual percentage rate where the lender quotes one (1999 = 19.99%).
  aprBasisPoints: number | null;
  termsUrl: string;
}

export interface PlatformPaymentInput {
  // The merchant's sub-account that receives the funds.
  providerAccountId: string;
  attemptKey: string;
  amount: string;
  precision: number;
  currency: string;
  method: ExecutableMethod;
  // PayRouta's fee in minor units of `currency`, withheld at source.
  feeMinor: bigint;
  reference: string;
  // Some providers require the payer's email (Paystack, Flutterwave).
  payerEmail?: string;
  // ISO country of the payer and of the merchant (dLocal, Tink).
  payerCountry?: string;
  merchantCountry?: string;
  // The merchant's own bank account, for rails where the payer's bank pays
  // the merchant directly (manifest.needsPayoutAccount).
  recipient?: { name: string; accountNumber: string; routingNumber?: string; country: string };
  returnUrl: string;
  cancelUrl: string;
  // Credit partners only: the offer the customer chose at checkout. The
  // lender re-prices it and refuses the payment if the offer changed.
  credit?: { offerId: string };
}

export type PlatformPaymentState =
  | "Requires action"
  | "Pending"
  | "Confirmed"
  | "Rejected";

export interface FundsAvailability {
  // Provider identifiers of the payment and of the merchant's share.
  paymentRef: string;
  transferRef?: string;
  // What reached (or will reach) the merchant, in minor units, after
  // PayRouta's fee and any processing fee the merchant bears.
  netMinor: bigint;
  availableAt: Date;
}

export interface PlatformAdapter extends PlatformAdapterExtras {
  // Requirement codes in snapshots are PayRouta's own
  // (payrouteRequirementCodes), never the provider's field names.
  createAccount(input: {
    linkId: string;
    environment: "sandbox" | "production";
    // Already projected onto manifest.sharedFields.
    profile: Partial<KybProfile>;
    details: VerificationDetails;
    // The merchant's acceptance of PayRouta's terms, which incorporate the
    // provider's connected-account agreement.
    agreement: { acceptedAt: Date; ip: string; userAgent: string };
  }): Promise<{ providerAccountId: string; snapshot: StatusSnapshot }>;
  accountStatus(providerAccountId: string): Promise<StatusSnapshot>;
  createPayment(
    input: PlatformPaymentInput,
  ): Promise<{ state: PlatformPaymentState; reference: string; actionUrl?: string }>;
  paymentStatus(input: { reference: string; providerAccountId: string }): Promise<{
    state: PlatformPaymentState;
    reference: string;
    amount: string;
    currency: string;
  } | null>;
  // Null until the provider has moved the merchant's share; callers retry.
  fundsAvailability(input: {
    reference: string;
    providerAccountId: string;
    // PayRouta's fee as booked, for providers that do not report the
    // merchant's share themselves.
    feeMinor: bigint;
  }): Promise<FundsAvailability | null>;
}

export type PayoutState = "In transit" | "Paid" | "Failed";
export type RefundState = "Pending" | "Succeeded" | "Failed";

// A dispute (chargeback) as the provider reports it, in PayRouta's terms.
export interface DisputeSnapshot {
  reference: string;
  state: "Open" | "Won" | "Lost";
  amountMinor: bigint;
  currency: string;
  // Fee the provider charged for the dispute, passed on to the merchant.
  feeMinor: bigint;
  // Identifies the disputed payment: the provider's payment id (as stored
  // in PlatformPayment.providerPaymentRef) or the payment reference.
  paymentRef?: string;
  paymentReference?: string;
  reason?: string;
  evidenceDueBy?: Date;
}

// A verified provider event. Like partner events, it only prompts PayRouta to
// re-read state from the provider's authenticated API; its payload never
// changes state by itself.
export interface PlatformEvent {
  eventId: string;
  type: string;
  kind: "account" | "payment" | "payout" | "refund" | "dispute" | "other";
  // The merchant's sub-account, for account and payout events.
  accountRef?: string;
  // The payment reference (as returned by createPayment) or payout reference.
  objectRef?: string;
}

// Evidence a merchant gives for a dispute, in PayRouta's terms; each module
// maps it onto its provider's evidence fields.
export interface DisputeEvidence {
  productDescription: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  serviceDate?: string;
  shippingCarrier?: string;
  shippingTrackingNumber?: string;
  shippingDate?: string;
  deliveryAddress?: string;
  refundPolicy?: string;
  explanation?: string;
}

// Optional capabilities. Fund-holding rails need payouts to release money to
// merchants; every rail should verify its webhooks.
export interface PlatformAdapterExtras {
  // Credit partners: the plans the lender offers for this payment, before
  // any credit check. An empty list means no plan fits (amount, country).
  creditOffers?(input: {
    amount: string;
    precision: number;
    currency: string;
    payerCountry?: string;
  }): Promise<CreditOffer[]>;
  createPayout?(input: {
    providerAccountId: string;
    payoutId: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<{ reference: string; state: PayoutState; failureCode?: string }>;
  payoutStatus?(input: {
    providerAccountId: string;
    reference: string;
  }): Promise<{ state: PayoutState; failureCode?: string } | null>;
  verifyEvent?(input: { rawBody: string; headers: Headers }): Promise<PlatformEvent | null>;
  createRefund?(input: {
    providerAccountId: string;
    // The payment reference from createPayment, and the provider's payment
    // id once known (fundsAvailability's paymentRef).
    reference: string;
    paymentRef?: string;
    refundId: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<{ reference: string; state: RefundState; failureCode?: string }>;
  refundStatus?(input: { providerAccountId: string; reference: string }): Promise<{ state: RefundState; failureCode?: string } | null>;
  disputeStatus?(input: { reference: string }): Promise<DisputeSnapshot | null>;
  // Sends the merchant's evidence and submits it to the card network.
  submitDisputeEvidence?(input: { reference: string; disputeId: string; evidence: DisputeEvidence }): Promise<void>;
  // Fund-holding rails: move a disputed amount from the merchant's
  // sub-account to the platform while the dispute is open, and back if won.
  holdDisputeFunds?(input: { providerAccountId: string; transferRef: string; amountMinor: bigint; disputeId: string }): Promise<void>;
  releaseDisputeFunds?(input: { providerAccountId: string; amountMinor: bigint; currency: string; disputeId: string }): Promise<void>;
  // The merchant's total balance (available + pending) at the provider, by
  // currency, in minor units. Used for daily reconciliation.
  accountBalance?(providerAccountId: string): Promise<Record<string, bigint>>;
}

export interface PlatformModule {
  manifest: PlatformManifest;
  configSchema: z.ZodType;
  create(config: unknown, deps: PartnerDeps): PlatformAdapter;
}

// What the merchant has to do next, in PayRouta's words.
export const payrouteRequirementCodes = [
  "business-details",
  "business-document",
  "representative-details",
  "owner-details",
  "director-details",
  "identity-document",
  "payout-account",
  "terms-acceptance",
  "review",
] as const;
