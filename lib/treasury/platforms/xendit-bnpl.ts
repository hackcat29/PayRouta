// Asia-Pacific Self-Serve BNPL & Open Financial Network Switch
// (Xendit BNPL Switch + Setu India UPI Credit Line / Account Aggregator).
//
// Standardizes Southeast Asian & APAC consumer credit networks (Akulaku,
// Kredivo, ShopeePay Later, Atome) under Xendit's self-serve switch and connects
// to India's Setu Account Aggregator / UPI Credit Line rails.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../portal/domain";
import type { PartnerDeps, StatusSnapshot } from "../../partners/contract";
import { assertPaymentHost, parseJson, providerFailure } from "../../partners/contract";
import { toMinorUnits } from "../../partners/money";
import { instalmentOffer } from "../credit";
import type {
  CreditOffer,
  PlatformAdapter,
  PlatformManifest,
  PlatformModule,
} from "./contract";

export const apacBnplCountries = ["IN", "SG", "ID", "MY", "AU", "PH"] as const;

export const xenditBnplManifest: PlatformManifest = {
  id: "xendit-bnpl",
  name: "Xendit APAC BNPL & Setu India UPI Credit (Kredivo, Akulaku, Atome, ShopeePay Later)",
  custody: "partner-held",
  holdsFunds: true,
  merchantBearsProcessingFee: false,
  feeCollection: "withheld",
  merchantCountries: apacBnplCountries,
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
  paymentHosts: ["checkout.xendit.co", "pay.kredivo.com", "pay.atome.sg", "bridge.setu.co"],
  documentation: "https://www.xendit.co/",
  credit: {
    lender: "APAC BNPL & Setu UPI Credit Switch (Akulaku / Kredivo / ShopeePay Later / Atome / Setu UPI Credit)",
    termsUrl: "https://www.xendit.co/en/terms-and-conditions/",
    countries: apacBnplCountries,
  },
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.xendit.co").default("https://api.xendit.co"),
    secretKeyRef: z.string().max(100).optional(),
    callbackTokenRef: z.string().max(100).optional(),
    setuClientSecretRef: z.string().max(100).optional(),
  })
  .strict();

type Config = z.infer<typeof configSchema>;

export function apacBnplOffers(
  amountMinor: bigint,
  payerCountry: string | undefined,
): CreditOffer[] {
  if (payerCountry && !apacBnplCountries.includes(payerCountry as (typeof apacBnplCountries)[number])) {
    return [];
  }
  if (amountMinor < 500n || amountMinor > 1_000_000_000n) return [];
  const termsUrl = xenditBnplManifest.credit!.termsUrl;

  if (payerCountry === "IN") {
    return [
      instalmentOffer({
        id: "apac-setu-upi-credit-30d",
        lender: "Setu Open Financial Network (UPI Credit Line / RuPay Credit)",
        termsUrl: "https://setu.co/terms/",
        amountMinor,
        instalments: 1,
        interval: "month",
        costBps: 0,
        aprBasisPoints: 0,
        firstDueToday: false,
      }),
      instalmentOffer({
        id: "apac-setu-emi-3m",
        lender: "Setu Account Aggregator 3-Month No-Cost EMI",
        termsUrl: "https://setu.co/terms/",
        amountMinor,
        instalments: 3,
        interval: "month",
        costBps: 0,
        aprBasisPoints: 0,
        firstDueToday: true,
      }),
    ];
  }

  return [
    instalmentOffer({
      id: "apac-atome-3",
      lender: "Atome 3-Part 0% Split (via Xendit)",
      termsUrl,
      amountMinor,
      instalments: 3,
      interval: "month",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: true,
    }),
    instalmentOffer({
      id: "apac-kredivo-akulaku-30d",
      lender: "Kredivo & Akulaku Pay in 30 Days (via Xendit)",
      termsUrl,
      amountMinor,
      instalments: 1,
      interval: "month",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: false,
    }),
    instalmentOffer({
      id: "apac-shopeepay-later-6m",
      lender: "ShopeePay Later & Kredivo 6-Month Installments",
      termsUrl,
      amountMinor,
      instalments: 6,
      interval: "month",
      costBps: 600,
      aprBasisPoints: 1200,
      firstDueToday: false,
    }),
  ];
}

function create(config: Config, deps: PartnerDeps): PlatformAdapter {
  const basicAuth = async () => {
    const k = config.secretKeyRef ? await deps.credentials.get(config.secretKeyRef) : null;
    if (!k) throw new PortalError("PLATFORM_CREDENTIALS_MISSING", 503);
    return `Basic ${Buffer.from(`${k}:`).toString("base64")}`;
  };

  const call = async (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    forUserId?: string,
  ) => {
    const auth = await basicAuth();
    const res = await deps.http(config.baseUrl, {
      method,
      path,
      headers: {
        authorization: auth,
        "content-type": "application/json",
        ...(forUserId ? { "for-user-id": forUserId } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status >= 400) providerFailure("xendit-bnpl", res.status);
    return parseJson(res.body);
  };

  return {
    async createAccount(input): Promise<{ providerAccountId: string; snapshot: StatusSnapshot }> {
      const created = await call("POST", "/v2/accounts", {
        email: input.profile.supportEmail,
        type: "MANAGED",
        public_profile: { business_name: input.profile.tradingName ?? input.profile.legalName },
        country: input.profile.country ?? input.details.payoutAccount.country,
      });
      const id = String(created.id ?? "");
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
      const a = await call("GET", `/v2/accounts/${encodeURIComponent(providerAccountId)}`);
      const status = String(a.status ?? "LIVE").toUpperCase();
      const active = status === "LIVE" || status === "REGISTERED";
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
      return apacBnplOffers(minor, input.payerCountry);
    },

    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      if (minor === null || input.method !== "bnpl" || input.feeMinor >= minor) {
        return { state: "Rejected", reference: "" };
      }
      const offers = apacBnplOffers(minor, input.payerCountry);
      if (!input.credit || !offers.some((o) => o.id === input.credit!.offerId)) {
        return { state: "Rejected", reference: "" };
      }
      const plan = await call(
        "POST",
        "/paylater/plans",
        {
          reference_id: input.reference,
          channel_code:
            input.credit.offerId === "apac-atome-3"
              ? "ATOME"
              : input.credit.offerId.startsWith("apac-setu")
                ? "UPI_CREDIT_LINE"
                : "KREDIVO",
          currency: input.currency.toUpperCase(),
          amount: Number(input.amount),
          platform_fee_minor: input.feeMinor.toString(),
          success_redirect_url: input.returnUrl,
          failure_redirect_url: input.cancelUrl,
        },
        input.providerAccountId,
      );
      const id = String(plan.id ?? "");
      const actions = (plan.actions as { desktop_web_checkout_url?: string } | undefined) ?? {};
      const url = String(actions.desktop_web_checkout_url ?? plan.checkout_url ?? `https://checkout.xendit.co/paylater/${id}`);
      if (!id) throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
      return {
        state: "Requires action",
        reference: id,
        actionUrl: assertPaymentHost(xenditBnplManifest.paymentHosts, url),
      };
    },

    async paymentStatus(input) {
      const ch = await call(
        "GET",
        `/paylater/charges/${encodeURIComponent(input.reference)}`,
        undefined,
        input.providerAccountId,
      );
      const userId = String(ch.business_id ?? input.providerAccountId);
      if (userId !== input.providerAccountId) {
        throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
      }
      const currency = String(ch.currency ?? "IDR").toUpperCase();
      const amount = String(ch.amount ?? "0.00");
      const status = String(ch.status ?? "").toUpperCase();
      const state =
        status === "SUCCEEDED"
          ? "Confirmed"
          : status === "FAILED" || status === "VOIDED"
            ? "Rejected"
            : status === "PENDING"
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },

    async fundsAvailability(input) {
      const ch = await call(
        "GET",
        `/paylater/charges/${encodeURIComponent(input.reference)}`,
        undefined,
        input.providerAccountId,
      );
      if (String(ch.status ?? "").toUpperCase() !== "SUCCEEDED") return null;
      const currency = String(ch.currency ?? "IDR").toUpperCase();
      const total = toMinorUnits(String(ch.amount ?? "0.00"), 2, currency) ?? 0n;
      return {
        paymentRef: String(ch.id ?? input.reference),
        netMinor: total > input.feeMinor ? total - input.feeMinor : 0n,
        availableAt: (deps.now ?? (() => new Date()))(),
      };
    },

    async verifyEvent({ rawBody, headers }) {
      const token = config.callbackTokenRef ? await deps.credentials.get(config.callbackTokenRef) : null;
      const headerToken = headers.get("x-callback-token");
      if (!token || !headerToken) return null;
      const a = Buffer.from(token);
      const b = Buffer.from(headerToken);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const body = parseJson(rawBody) as { event?: string; data?: { id?: string } };
      if (!body.event || !body.data?.id) return null;
      return {
        eventId: `${body.event}:${body.data.id}`,
        type: body.event,
        kind: "payment",
        objectRef: body.data.id,
      };
    },
  };
}

export const xenditBnplPlatform: PlatformModule = {
  manifest: xenditBnplManifest,
  configSchema,
  create,
};
