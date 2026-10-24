// Europe Self-Serve BNPL & Open-Banking Overdraft Switch (Adyen / Klarna +
// Tink PSD2 Open Banking Mandate Relay).
//
// Activates European consumer credit networks (Klarna Pay in 3 / Pay in 30 /
// Financing, Clearpay, PayPal Credit, Alma) plus Tink PSD2 Open Banking
// direct-debit mandates that tap existing European bank account overdraft lines.
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

export const europeBnplCountries = [
  "GB", "DE", "FR", "NL", "ES", "IT", "SE", "AT", "BE", "DK", "FI", "IE", "NO", "PL", "PT", "CH", "EE", "LT",
] as const;

export const adyenKlarnaBnplManifest: PlatformManifest = {
  id: "adyen-klarna-bnpl",
  name: "Adyen Europe BNPL & Tink Open Banking (Klarna, Clearpay, Alma, PayPal Credit)",
  custody: "partner-held",
  holdsFunds: true,
  merchantBearsProcessingFee: false,
  feeCollection: "withheld",
  merchantCountries: europeBnplCountries,
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
  paymentHosts: ["checkoutshopper-live.adyen.com", "checkoutshopper-test.adyen.com", "pay.klarna.com", "link.tink.com"],
  documentation: "https://www.adyen.com/knowledge-hub/merchant-account",
  credit: {
    lender: "European BNPL & PSD2 Credit Switch (Klarna / Clearpay / Alma / PayPal Credit / Tink Overdraft)",
    termsUrl: "https://www.klarna.com/international/terms-and-conditions/",
    countries: europeBnplCountries,
  },
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z
      .enum(["https://checkout-test.adyen.com", "https://checkout-live.adyen.com"])
      .default("https://checkout-test.adyen.com"),
    merchantAccount: z.string().min(2).max(80).default("PayRoutaEU"),
    apiKeyRef: z.string().max(100).optional(),
    hmacKeyRef: z.string().max(100).optional(),
  })
  .strict();

type Config = z.infer<typeof configSchema>;

export function europeBnplOffers(
  amountMinor: bigint,
  payerCountry: string | undefined,
): CreditOffer[] {
  if (payerCountry && !europeBnplCountries.includes(payerCountry as (typeof europeBnplCountries)[number])) {
    return [];
  }
  if (amountMinor < 1_000n || amountMinor > 1_500_000n) return [];
  const termsUrl = adyenKlarnaBnplManifest.credit!.termsUrl;

  return [
    instalmentOffer({
      id: "eu-klarna-pay3",
      lender: "Klarna Pay in 3 (via Adyen)",
      termsUrl,
      amountMinor,
      instalments: 3,
      interval: "month",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: true,
    }),
    instalmentOffer({
      id: "eu-klarna-pay30",
      lender: "Klarna Pay in 30 Days (via Adyen)",
      termsUrl,
      amountMinor,
      instalments: 1,
      interval: "month",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: false,
    }),
    instalmentOffer({
      id: "eu-clearpay-alma-4",
      lender: payerCountry === "GB" ? "Clearpay 4-Part Split" : "Alma / PayPal Credit 4x",
      termsUrl,
      amountMinor,
      instalments: 4,
      interval: "two-weeks",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: true,
    }),
    instalmentOffer({
      id: "eu-tink-psd2-overdraft",
      lender: "Tink Open Banking PSD2 Overdraft Line",
      termsUrl: "https://tink.com/legal/terms/",
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
        "x-api-key": key,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status >= 400) providerFailure("adyen-klarna-bnpl", res.status);
    return parseJson(res.body);
  };

  return {
    async createAccount(input): Promise<{ providerAccountId: string; snapshot: StatusSnapshot }> {
      const created = await call("POST", "/v71/accountHolders", {
        accountHolderCode: `pr_eu_${input.linkId.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}`,
        legalBusinessName: input.profile.legalName,
        country: input.profile.country ?? input.details.payoutAccount.country,
        iban: input.details.payoutAccount.accountNumber,
      });
      const id = String(created.id ?? created.accountHolderCode ?? "");
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
      const holder = await call("GET", `/v71/accountHolders/${encodeURIComponent(providerAccountId)}`);
      const active = String(holder.status ?? "Active").toLowerCase() === "active";
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
      return europeBnplOffers(minor, input.payerCountry);
    },

    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      if (minor === null || input.method !== "bnpl" || input.feeMinor >= minor) {
        return { state: "Rejected", reference: "" };
      }
      const offers = europeBnplOffers(minor, input.payerCountry);
      if (!input.credit || !offers.some((o) => o.id === input.credit!.offerId)) {
        return { state: "Rejected", reference: "" };
      }
      const merchantShare = minor - input.feeMinor;
      const session = await call("POST", "/v71/sessions", {
        merchantAccount: config.merchantAccount,
        reference: input.reference,
        amount: { currency: input.currency.toUpperCase(), value: Number(minor) },
        countryCode: input.payerCountry ?? input.merchantCountry ?? "DE",
        allowedPaymentMethods: ["klarna", "klarna_paynow", "klarna_account", "clearpay", "alma", "paypal", "directdebit_GB", "sepadirectdebit"],
        splits: [
          {
            amount: { value: Number(merchantShare) },
            type: "BalanceAccount",
            account: input.providerAccountId,
            reference: `split-merchant-${input.reference}`,
          },
          {
            amount: { value: Number(input.feeMinor) },
            type: "Commission",
            reference: `split-fee-${input.reference}`,
          },
        ],
        returnUrl: input.returnUrl,
      });
      const id = String(session.id ?? "");
      const url = String(session.url ?? `https://checkoutshopper-test.adyen.com/checkoutshopper/sessions/${id}`);
      if (!id) throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
      return {
        state: "Requires action",
        reference: id,
        actionUrl: assertPaymentHost(adyenKlarnaBnplManifest.paymentHosts, url),
      };
    },

    async paymentStatus(input) {
      const s = await call("GET", `/v71/sessions/${encodeURIComponent(input.reference)}`);
      const account = String(s.accountHolderId ?? input.providerAccountId);
      if (account !== input.providerAccountId) {
        throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
      }
      const amountObj = (s.amount as { value?: number; currency?: string } | undefined) ?? {};
      const currency = String(amountObj.currency ?? "EUR").toUpperCase();
      const amount = fromMinorUnits(BigInt(amountObj.value ?? 0), currency) ?? "0.00";
      const status = String(s.status ?? "").toLowerCase();
      const state =
        status === "completed" || status === "authorised"
          ? "Confirmed"
          : status === "refused" || status === "expired" || status === "cancelled"
            ? "Rejected"
            : status === "pending"
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },

    async fundsAvailability(input) {
      const s = await call("GET", `/v71/sessions/${encodeURIComponent(input.reference)}`);
      const status = String(s.status ?? "").toLowerCase();
      if (status !== "completed" && status !== "authorised") return null;
      const amountObj = (s.amount as { value?: number } | undefined) ?? {};
      const total = BigInt(amountObj.value ?? 0);
      return {
        paymentRef: String(s.pspReference ?? input.reference),
        netMinor: total > input.feeMinor ? total - input.feeMinor : 0n,
        availableAt: (deps.now ?? (() => new Date()))(),
      };
    },

    async verifyEvent({ rawBody, headers }) {
      const secret = config.hmacKeyRef ? await deps.credentials.get(config.hmacKeyRef) : null;
      const sig = headers.get("x-adyen-hmac-signature");
      if (!secret || !sig) return null;
      const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const body = parseJson(rawBody) as { eventId?: string; eventCode?: string; pspReference?: string };
      if (!body.eventId || !body.eventCode) return null;
      return {
        eventId: body.eventId,
        type: body.eventCode,
        kind: "payment",
        objectRef: body.pspReference,
      };
    },
  };
}

export const adyenKlarnaBnplPlatform: PlatformModule = {
  manifest: adyenKlarnaBnplManifest,
  configSchema,
  create,
};
