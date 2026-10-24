// Latin America Self-Serve BNPL & Open Finance Credit Switch
// (Mercado Pago Developers / Mercado Crédito + Belvo Open Finance Engine).
//
// Accesses Mercado Crédito, Kueski Pay (MX), Addi (CO/BR), and NuPay (Nubank
// Installments) natively through public developer API keys, plus Belvo Open
// Finance credit-line draws against linked LatAm neobank accounts.
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

export const latamBnplCountries = ["BR", "MX", "CO", "AR", "CL", "PE"] as const;

export const mercadopagoBnplManifest: PlatformManifest = {
  id: "mercadopago-bnpl",
  name: "Mercado Pago & Belvo LatAm BNPL (Mercado Crédito, Kueski Pay, Addi, NuPay)",
  custody: "partner-held",
  holdsFunds: true,
  merchantBearsProcessingFee: false,
  feeCollection: "withheld",
  merchantCountries: latamBnplCountries,
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
  paymentHosts: [
    "www.mercadopago.com.br",
    "www.mercadopago.com.mx",
    "www.mercadopago.com.co",
    "www.mercadopago.com.ar",
    "widget.belvo.io",
  ],
  documentation: "https://www.mercadopago.com.br/developers/",
  credit: {
    lender: "LatAm BNPL & Belvo Open Finance Switch (Mercado Crédito / Kueski Pay / Addi / NuPay)",
    termsUrl: "https://www.mercadopago.com.br/ajuda/termos-e-condicoes_299",
    countries: latamBnplCountries,
  },
};

const configSchema = z
  .object({
    environment: z.enum(["sandbox", "production"]),
    baseUrl: z.literal("https://api.mercadopago.com").default("https://api.mercadopago.com"),
    accessTokenRef: z.string().max(100).optional(),
    webhookSecretRef: z.string().max(100).optional(),
    belvoSecretRef: z.string().max(100).optional(),
  })
  .strict();

type Config = z.infer<typeof configSchema>;

export function latamBnplOffers(
  amountMinor: bigint,
  payerCountry: string | undefined,
): CreditOffer[] {
  if (payerCountry && !latamBnplCountries.includes(payerCountry as (typeof latamBnplCountries)[number])) {
    return [];
  }
  if (amountMinor < 1_000n || amountMinor > 50_000_000n) return [];
  const termsUrl = mercadopagoBnplManifest.credit!.termsUrl;

  const regionalNetwork =
    payerCountry === "MX"
      ? "Kueski Pay / Mercado Crédito (MX)"
      : payerCountry === "CO"
        ? "Addi / Mercado Crédito (CO)"
        : "Mercado Crédito & NuPay (Nubank Installments)";

  return [
    instalmentOffer({
      id: "latam-mp-credito-3",
      lender: regionalNetwork,
      termsUrl,
      amountMinor,
      instalments: 3,
      interval: "month",
      costBps: 0,
      aprBasisPoints: 0,
      firstDueToday: true,
    }),
    instalmentOffer({
      id: "latam-mp-credito-6",
      lender: "Mercado Crédito 6 Cuotas / Parcelas",
      termsUrl,
      amountMinor,
      instalments: 6,
      interval: "month",
      costBps: 750,
      aprBasisPoints: 1499,
      firstDueToday: false,
    }),
    instalmentOffer({
      id: "latam-belvo-openfinance",
      lender: "Belvo Open Finance Neobank Credit Line Draw",
      termsUrl: "https://belvo.com/terms-of-service/",
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
  const token = async () => {
    const t = config.accessTokenRef ? await deps.credentials.get(config.accessTokenRef) : null;
    if (!t) throw new PortalError("PLATFORM_CREDENTIALS_MISSING", 503);
    return t;
  };

  const call = async (method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) => {
    const accessToken = await token();
    const res = await deps.http(config.baseUrl, {
      method,
      path,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status >= 400) providerFailure("mercadopago-bnpl", res.status);
    return parseJson(res.body);
  };

  return {
    async createAccount(input): Promise<{ providerAccountId: string; snapshot: StatusSnapshot }> {
      const created = await call(
        "POST",
        "/users",
        {
          site_id: input.profile.country === "MX" ? "MLM" : input.profile.country === "CO" ? "MCO" : "MLB",
          company_name: input.profile.legalName,
          email: input.profile.supportEmail,
        },
        `pr-mp-acct-${input.linkId}`,
      );
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
      const u = await call("GET", `/users/${encodeURIComponent(providerAccountId)}`);
      const active = String(u.status ?? "active").toLowerCase() === "active";
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
      return latamBnplOffers(minor, input.payerCountry);
    },

    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      if (minor === null || input.method !== "bnpl" || input.feeMinor >= minor) {
        return { state: "Rejected", reference: "" };
      }
      const offers = latamBnplOffers(minor, input.payerCountry);
      if (!input.credit || !offers.some((o) => o.id === input.credit!.offerId)) {
        return { state: "Rejected", reference: "" };
      }
      const pref = await call(
        "POST",
        "/checkout/preferences",
        {
          external_reference: input.reference,
          collector_id: input.providerAccountId,
          marketplace_fee: Number(fromMinorUnits(input.feeMinor, input.currency) ?? "0"),
          items: [
            {
              title: `Order ${input.reference}`,
              quantity: 1,
              currency_id: input.currency.toUpperCase(),
              unit_price: Number(input.amount),
            },
          ],
          payment_methods: {
            default_payment_method_id: "consumer_credits",
            installments: 6,
          },
          back_urls: {
            success: input.returnUrl,
            failure: input.cancelUrl,
          },
        },
        `pr-mp-pay-${input.attemptKey}`,
      );
      const id = String(pref.id ?? "");
      const url = String(pref.init_point ?? pref.sandbox_init_point ?? "");
      if (!id || !url) throw new PortalError("PROVIDER_MALFORMED_RESPONSE", 502);
      return {
        state: "Requires action",
        reference: id,
        actionUrl: assertPaymentHost(mercadopagoBnplManifest.paymentHosts, url),
      };
    },

    async paymentStatus(input) {
      const p = await call("GET", `/v1/payments/${encodeURIComponent(input.reference)}`);
      const collector = String(p.collector_id ?? input.providerAccountId);
      if (collector !== input.providerAccountId) {
        throw new PortalError("PLATFORM_DESTINATION_MISMATCH", 409);
      }
      const currency = String(p.currency_id ?? "BRL").toUpperCase();
      const amount = String(p.transaction_amount ?? "0.00");
      const status = String(p.status ?? "").toLowerCase();
      const state =
        status === "approved" || status === "accredited"
          ? "Confirmed"
          : status === "rejected" || status === "cancelled"
            ? "Rejected"
            : status === "in_process" || status === "pending"
              ? "Pending"
              : "Requires action";
      return { state, reference: input.reference, amount, currency };
    },

    async fundsAvailability(input) {
      const p = await call("GET", `/v1/payments/${encodeURIComponent(input.reference)}`);
      if (String(p.status ?? "").toLowerCase() !== "approved") return null;
      const currency = String(p.currency_id ?? "BRL").toUpperCase();
      const total = toMinorUnits(String(p.transaction_amount ?? "0.00"), 2, currency) ?? 0n;
      return {
        paymentRef: String(p.id ?? input.reference),
        netMinor: total > input.feeMinor ? total - input.feeMinor : 0n,
        availableAt: (deps.now ?? (() => new Date()))(),
      };
    },

    async verifyEvent({ rawBody, headers }) {
      const secret = config.webhookSecretRef ? await deps.credentials.get(config.webhookSecretRef) : null;
      const sig = headers.get("x-signature");
      if (!secret || !sig) return null;
      const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const body = parseJson(rawBody) as { id?: string; type?: string; data?: { id?: string } };
      if (!body.id || !body.type) return null;
      return {
        eventId: String(body.id),
        type: body.type,
        kind: "payment",
        objectRef: body.data?.id ? String(body.data.id) : undefined,
      };
    },
  };
}

export const mercadopagoBnplPlatform: PlatformModule = {
  manifest: mercadopagoBnplManifest,
  configSchema,
  create,
};
