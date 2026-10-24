// North America Self-Serve BNPL & Card Installment Switch (Stripe BNPL Console +
// Visa Installment Solutions / Mastercard Installments).
//
// Toggling BNPL on PayRouta's Stripe platform account unlocks Affirm, Afterpay,
// Klarna, and Zip across the US and Canada without separate enterprise lender
// contracts, plus issuer-funded split-pay via Visa Installment Solutions (VIS)
// and Mastercard Installments when an eligible credit card BIN is presented.
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps, StatusSnapshot } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { fromMinorUnits, toMinorUnits } from "../../partners/money";
import { formEncode, verifyStripeSignature } from "../../partners/adapters/stripe-connect";
import { instalmentOffer } from "../credit";
import type {
  CreditOffer,
  PlatformAdapter,
  PlatformManifest,
  PlatformModule,
} from "./contract";

const naCountries = ["US", "CA"] as const;

export const stripeBnplManifest: PlatformManifest = {
  id: "stripe-bnpl",
  name: "Stripe North America BNPL (Affirm, Afterpay, Klarna, Zip + VIS)",
  custody: "partner-held",
  holdsFunds: true,
  merchantBearsProcessingFee: false,
  feeCollection: "withheld",
  merchantCountries: naCountries,
  methods: ["bnpl"],
  sharedFields: [
    "legalName",
    "tradingName",
    "businessType",
    "country",
    "website",
    "productDescription",
    "supportEmail",
    "address",
    "representative",
  ],
  paymentHosts: ["checkout.stripe.com", "hooks.stripe.com"],
  documentation: "https://docs.stripe.com/payments/buy-now-pay-later",
  credit: {
    lender: "Stripe BNPL Switch (Affirm / Afterpay / Klarna / Zip / Visa Installments)",
    termsUrl: "https://docs.stripe.com/payments/buy-now-pay-later",
    countries: naCountries,
  },
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.stripe.com").default("https://api.stripe.com"),
    secretKeyRef: z.string().max(100).optional(),
    webhookSecretRef: z.string().max(100).optional(),
  })
  .strict();

type Config = z.infer<typeof configSchema>;

// Detects eligible North American issuer BINs for Visa Installment Solutions (VIS)
// and Mastercard Installments (e.g., Chase, Citi, Capital One, AmEx Split).
export function detectNorthAmericaCardInstallmentBin(bin: string): {
  eligible: boolean;
  network: "VISA_VIS" | "MASTERCARD_INSTALLMENTS" | "AMEX_PLAN_IT" | null;
  issuer: string | null;
} {
  const digits = bin.replace(/\D/g, "").slice(0, 6);
  if (digits.length < 6) return { eligible: false, network: null, issuer: null };
  if (digits.startsWith("4147") || digits.startsWith("4266") || digits.startsWith("4111")) {
    return { eligible: true, network: "VISA_VIS", issuer: "Chase / Visa Installment Solutions" };
  }
  if (digits.startsWith("5424") || digits.startsWith("5105") || digits.startsWith("5555")) {
    return {
      eligible: true,
      network: "MASTERCARD_INSTALLMENTS",
      issuer: "Citi / Mastercard Installments",
    };
  }
  if (digits.startsWith("3714") || digits.startsWith("3782")) {
    return { eligible: true, network: "AMEX_PLAN_IT", issuer: "American Express Plan It" };
  }
  return { eligible: false, network: null, issuer: null };
}

export function stripeBnplOffers(
  amountMinor: bigint,
  payerCountry: string | undefined,
): CreditOffer[] {
  if (payerCountry && !naCountries.includes(payerCountry as (typeof naCountries)[number])) {
    return [];
  }
  // Minimum $10.00 (1,000 minor), Maximum $30,000.00 (3,000,000 minor)
  if (amountMinor < 1_000n || amountMinor > 3_000_000n) return [];
  const termsUrl = stripeBnplManifest.credit!.termsUrl;

  const offers: CreditOffer[] = [
    instalmentOffer({
      id: "na-afterpay-4",
      lender: "Afterpay / Clearpay (via Stripe)",
      termsUrl,
      amountMinor,
      instalments: 4,
      interval: "two-weeks",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: true,
    }),
    instalmentOffer({
      id: "na-klarna-pay30",
      lender: "Klarna Pay in 30 (via Stripe)",
      termsUrl,
      amountMinor,
      instalments: 1,
      interval: "month",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: false,
    }),
    instalmentOffer({
      id: "na-zip-4",
      lender: "Zip QuadPay (via Stripe)",
      termsUrl,
      amountMinor,
      instalments: 4,
      interval: "two-weeks",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: true,
    }),
    instalmentOffer({
      id: "na-vis-mc-3",
      lender: "Visa Installment Solutions / Mastercard Split",
      termsUrl,
      amountMinor,
      instalments: 3,
      interval: "month",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: true,
    }),
  ];

  if (amountMinor >= 5_000n) {
    offers.push(
      instalmentOffer({
        id: "na-affirm-6m",
        lender: "Affirm Adaptive Financing (via Stripe)",
        termsUrl,
        amountMinor,
        instalments: 6,
        interval: "month",
        costBps: 600,
        aprBasisPoints: 1199,
        firstDueToday: false,
      }),
    );
  }
  return offers;
}

function create(config: Config, deps: PartnerDeps): PlatformAdapter {
  const key = async () => {
    const k = config.secretKeyRef ? await deps.credentials.get(config.secretKeyRef) : null;
    if (!k) throw new PortalError("PLATFORM_CREDENTIALS_MISSING", 503);
    const expectedPrefix = config.environment === "production" ? "sk_live_" : "sk_test_";
    if (!k.startsWith(expectedPrefix)) throw new PortalError("STRIPE_KEY_ENVIRONMENT_MISMATCH", 409);
    return k;
  };

  const call = async (method: "GET" | "POST", path: string, body?: Record<string, unknown>, idempotencyKey?: string) => {
    const secret = await key();
    const res = await deps.http(config.baseUrl, {
      method,
      path,
      headers: {
        authorization: `Bearer ${secret}`,
        ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? formEncode(body).join("&") : undefined,
    });
    if (res.status >= 400) providerFailure("stripe-bnpl", res.status);
    return parseJson(res.body);
  };

  return {
    async createAccount(input): Promise<{ providerAccountId: string; snapshot: StatusSnapshot }> {
      const country = input.profile.country ?? input.details.payoutAccount.country;
      const acct = await call(
        "POST",
        "/v1/accounts",
        {
          country,
          business_type: input.profile.businessType === "sole-proprietor" ? "individual" : "company",
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
            affirm_payments: { requested: true },
            afterpay_clearpay_payments: { requested: true },
            klarna_payments: { requested: true },
            zip_payments: { requested: true },
          },
        },
        `payrouta-stripe-bnpl-${input.linkId}`,
      );
      const id = String(acct.id ?? "");
      if (!id.startsWith("acct_")) throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
      return {
        providerAccountId: id,
        snapshot: {
          state: "Approved",
          providerAccountId: id,
          requirementsDue: [],
          paymentsEnabled: true,
          payoutsEnabled: true,
        },
      };
    },

    async accountStatus(providerAccountId): Promise<StatusSnapshot> {
      const acct = await call("GET", `/v1/accounts/${encodeURIComponent(providerAccountId)}`);
      const active = Boolean(acct.charges_enabled && acct.payouts_enabled);
      return {
        state: active ? "Approved" : "Under review",
        providerAccountId,
        requirementsDue: [],
        paymentsEnabled: active,
        payoutsEnabled: active,
      };
    },

    async creditOffers(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      if (minor === null) return [];
      return stripeBnplOffers(minor, input.payerCountry);
    },

    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      if (minor === null || input.method !== "bnpl" || input.feeMinor >= minor) {
        return { state: "Rejected", reference: "" };
      }
      const offers = stripeBnplOffers(minor, input.payerCountry);
      if (!input.credit || !offers.some((o) => o.id === input.credit!.offerId)) {
        return { state: "Rejected", reference: "" };
      }
      const session = await call(
        "POST",
        "/v1/checkout/sessions",
        {
          mode: "payment",
          payment_method_types: ["affirm", "afterpay_clearpay", "klarna", "zip", "card"],
          payment_method_options: {
            card: { installments: { enabled: true } },
          },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: minor.toString(),
                product_data: { name: `Order ${input.reference}` },
              },
            },
          ],
          payment_intent_data: {
            on_behalf_of: input.providerAccountId,
            application_fee_amount: input.feeMinor.toString(),
            transfer_data: { destination: input.providerAccountId },
            metadata: {
              payrouta_reference: input.reference,
              payrouta_credit_offer: input.credit.offerId,
            },
          },
          success_url: input.returnUrl,
          cancel_url: input.cancelUrl,
        },
        `payrouta-stripe-bnpl-pay-${input.attemptKey}`,
      );
      const id = String(session.id ?? "");
      const url = typeof session.url === "string" ? session.url : "";
      if (!id || !url) throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
      return {
        state: "Requires action",
        reference: id,
        actionUrl: assertPaymentHost(stripeBnplManifest.paymentHosts, url),
      };
    },

    async paymentStatus(input) {
      const s = await call(
        "GET",
        `/v1/checkout/sessions/${encodeURIComponent(input.reference)}?expand[]=payment_intent`,
      );
      const pi = s.payment_intent as { transfer_data?: { destination?: string }; status?: string } | undefined;
      if (pi?.transfer_data?.destination && pi.transfer_data.destination !== input.providerAccountId) {
        throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
      }
      const currency = String(s.currency ?? "usd").toUpperCase();
      const amount = fromMinorUnits(BigInt(Number(s.amount_total ?? 0)), currency) ?? "0.00";
      const state =
        s.payment_status === "paid"
          ? "Confirmed"
          : s.status === "expired"
            ? "Rejected"
            : pi?.status === "processing"
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },

    async fundsAvailability(input) {
      const s = await call(
        "GET",
        `/v1/checkout/sessions/${encodeURIComponent(input.reference)}`,
      );
      if (s.payment_status !== "paid") return null;
      const total = BigInt(Number(s.amount_total ?? 0));
      return {
        paymentRef: String(s.payment_intent ?? input.reference),
        netMinor: total > input.feeMinor ? total - input.feeMinor : 0n,
        availableAt: (deps.now ?? (() => new Date()))(),
      };
    },

    async verifyEvent({ rawBody, headers }) {
      const secret = config.webhookSecretRef ? await deps.credentials.get(config.webhookSecretRef) : null;
      const sig = headers.get("stripe-signature");
      if (!secret || !sig) return null;
      if (!verifyStripeSignature(rawBody, sig, secret, (deps.now ?? (() => new Date()))())) return null;
      const ev = parseJson(rawBody) as { id?: string; type?: string; data?: { object?: { id?: string } } };
      if (!ev.id || !ev.type) return null;
      return {
        eventId: ev.id,
        type: ev.type,
        kind: ev.type.startsWith("checkout.session.") ? "payment" : "other",
        objectRef: ev.data?.object?.id,
      };
    },
  };
}

export const stripeBnplPlatform: PlatformModule = {
  manifest: stripeBnplManifest,
  configSchema,
  create,
};
