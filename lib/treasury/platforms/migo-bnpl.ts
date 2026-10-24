// Africa Self-Serve Cloud Lending & Open-Banking Credit Switch
// (Migo Cloud Lending API + Mono Open Banking / Neobank Wallet Relay).
//
// Underwrites African consumers instantly using phone number + BVN/NIN hash
// across Migo Credit, Carbon Point-of-Sale, CredPal, and CDL Rails, or initiates
// a Mono DirectPay mandate against credit-granting neobank wallets
// (OPay / EaseMoni, FairMoney, Kuda).
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps, StatusSnapshot } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { fromMinorUnits, toMinorUnits } from "../../partners/money";
import { instalmentOffer } from "../credit";
import type {
  CreditOffer,
  PlatformAdapter,
  PlatformManifest,
  PlatformModule,
} from "./contract";

export const africaBnplCountries = ["NG", "KE", "GH", "ZA"] as const;

export const migoBnplManifest: PlatformManifest = {
  id: "migo-bnpl",
  name: "Migo Cloud Lending & Mono Open Banking (Migo, Carbon, CredPal, OPay/FairMoney)",
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: true,
  feeCollection: "withheld",
  merchantCountries: africaBnplCountries,
  methods: ["bnpl"],
  sharedFields: [
    "legalName",
    "tradingName",
    "businessType",
    "country",
    "registrationNumber",
    "taxId",
    "website",
    "supportEmail",
    "address",
    "representative",
  ],
  paymentHosts: ["checkout.migo.money", "pay.withmono.com", "connect.withmono.com"],
  documentation: "https://migo.money/",
  credit: {
    lender: "Africa Cloud Lending & Mono Credit Switch (Migo / Carbon / CredPal / CDL / Mono Relay)",
    termsUrl: "https://migo.money/terms",
    countries: africaBnplCountries,
  },
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.migo.money").default("https://api.migo.money"),
    apiKeyRef: z.string().max(100).optional(),
    monoSecretRef: z.string().max(100).optional(),
    webhookSecretRef: z.string().max(100).optional(),
  })
  .strict();

type Config = z.infer<typeof configSchema>;

export function africaBnplOffers(
  amountMinor: bigint,
  payerCountry: string | undefined,
): CreditOffer[] {
  if (payerCountry && !africaBnplCountries.includes(payerCountry as (typeof africaBnplCountries)[number])) {
    return [];
  }
  if (amountMinor < 10_000n || amountMinor > 500_000_000n) return [];
  const termsUrl = migoBnplManifest.credit!.termsUrl;

  return [
    instalmentOffer({
      id: "af-migo-30d",
      lender: "Migo Instant Cloud Credit (30-Day Pay Later)",
      termsUrl,
      amountMinor,
      instalments: 1,
      interval: "month",
      costBps: 500,
      aprBasisPoints: null,
      firstDueToday: false,
    }),
    instalmentOffer({
      id: "af-carbon-credpal-4",
      lender: "Carbon POS & CredPal 4-Part Split",
      termsUrl,
      amountMinor,
      instalments: 4,
      interval: "two-weeks",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: true,
    }),
    instalmentOffer({
      id: "af-cdl-3m",
      lender: "CDL Payroll & Consumer Credit (3 Months)",
      termsUrl,
      amountMinor,
      instalments: 3,
      interval: "month",
      costBps: 900,
      aprBasisPoints: null,
      firstDueToday: false,
    }),
    instalmentOffer({
      id: "af-mono-wallet-relay",
      lender: "Mono Open Banking Credit Relay (OPay EaseMoni / FairMoney / Kuda Overdraft)",
      termsUrl: "https://mono.co/terms",
      amountMinor,
      instalments: 1,
      interval: "month",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: false,
    }),
  ];
}

function create(config: Config, deps: PartnerDeps): PlatformAdapter {
  const apiKey = async () => {
    const k = config.apiKeyRef ? await deps.credentials.get(config.apiKeyRef) : null;
    if (!k) throw new PortalError("PLATFORM_CREDENTIALS_MISSING", 503);
    return k;
  };

  const call = async (method: "GET" | "POST", path: string, body?: unknown) => {
    const key = await apiKey();
    const res = await deps.http(config.baseUrl, {
      method,
      path,
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status >= 400) providerFailure("migo-bnpl", res.status);
    return parseJson(res.body);
  };

  return {
    async createAccount(input): Promise<{ providerAccountId: string; snapshot: StatusSnapshot }> {
      const created = await call("POST", "/v1/merchants", {
        merchantCode: `pr_af_${input.linkId.replace(/[^A-Za-z0-9]/g, "").slice(0, 18)}`,
        legalName: input.profile.legalName,
        country: input.profile.country ?? input.details.payoutAccount.country,
        settlementAccountNumber: input.details.payoutAccount.accountNumber,
        settlementBankCode: input.details.payoutAccount.routingNumber ?? "058",
        currency: input.details.payoutAccount.currency,
      });
      const id = String(created.merchantId ?? created.id ?? "");
      if (!id) throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
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
      const m = await call("GET", `/v1/merchants/${encodeURIComponent(providerAccountId)}`);
      const active = String(m.status ?? "active").toLowerCase() === "active";
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
      return africaBnplOffers(minor, input.payerCountry);
    },

    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      if (minor === null || input.method !== "bnpl" || input.feeMinor >= minor) {
        return { state: "Rejected", reference: "" };
      }
      const offers = africaBnplOffers(minor, input.payerCountry);
      if (!input.credit || !offers.some((o) => o.id === input.credit!.offerId)) {
        return { state: "Rejected", reference: "" };
      }
      const loan = await call("POST", "/v1/credit/applications", {
        merchantId: input.providerAccountId,
        reference: input.reference,
        amountMinor: minor.toString(),
        platformFeeMinor: input.feeMinor.toString(),
        currency: input.currency.toUpperCase(),
        offerId: input.credit.offerId,
        rail: input.credit.offerId === "af-mono-wallet-relay" ? "mono-directpay" : "migo-cloud-lending",
        returnUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
      });
      const id = String(loan.applicationId ?? loan.id ?? "");
      const url = String(loan.approvalUrl ?? `https://checkout.migo.money/approve/${id}`);
      if (!id) throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
      return {
        state: "Requires action",
        reference: id,
        actionUrl: assertPaymentHost(migoBnplManifest.paymentHosts, url),
      };
    },

    async paymentStatus(input) {
      const app = await call("GET", `/v1/credit/applications/${encodeURIComponent(input.reference)}`);
      const merchantId = String(app.merchantId ?? input.providerAccountId);
      if (merchantId !== input.providerAccountId) {
        throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
      }
      const currency = String(app.currency ?? "NGN").toUpperCase();
      const amount = fromMinorUnits(BigInt(String(app.amountMinor ?? 0)), currency) ?? "0.00";
      const status = String(app.status ?? "").toLowerCase();
      // Only "disbursed" means the lender has funded the merchant; "approved_pending_disbursal"
      // stays Pending until funds move.
      const state =
        status === "disbursed" || status === "settled"
          ? "Confirmed"
          : status === "declined" || status === "rejected" || status === "expired"
            ? "Rejected"
            : status === "pending_approval" || status === "approved_pending_disbursal"
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },

    async fundsAvailability(input) {
      const app = await call("GET", `/v1/credit/applications/${encodeURIComponent(input.reference)}`);
      const status = String(app.status ?? "").toLowerCase();
      if (status !== "disbursed" && status !== "settled") return null;
      const total = BigInt(String(app.amountMinor ?? 0));
      const lenderFee = BigInt(String(app.lenderMerchantFeeMinor ?? 0));
      const netMinor = total > input.feeMinor + lenderFee ? total - input.feeMinor - lenderFee : 0n;
      return {
        paymentRef: String(app.disbursementRef ?? input.reference),
        netMinor,
        availableAt: (deps.now ?? (() => new Date()))(),
      };
    },

    async verifyEvent({ rawBody, headers }) {
      const secret = config.webhookSecretRef ? await deps.credentials.get(config.webhookSecretRef) : null;
      const sig = headers.get("x-migo-signature") ?? headers.get("mono-webhook-secret");
      if (!secret || !sig) return null;
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const body = parseJson(rawBody) as { eventId?: string; event?: string; applicationId?: string };
      if (!body.eventId || !body.event) return null;
      return {
        eventId: body.eventId,
        type: body.event,
        kind: "payment",
        objectRef: body.applicationId,
      };
    },
  };
}

export const migoBnplPlatform: PlatformModule = {
  manifest: migoBnplManifest,
  configSchema,
  create,
};
