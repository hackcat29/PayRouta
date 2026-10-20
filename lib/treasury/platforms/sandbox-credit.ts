// A fictional lender for local mode and tests: credit at checkout end to end
// without a real credit partner. It offers four plans, approves the customer
// at the sandbox checkout's "complete" step, pays the merchant the full price
// less a 1.5% fictional merchant fee, and collects nothing (no real customer
// owes anything). Never runs outside local mode.
//
// Plans for an amount between minMinor and maxMinor:
//   sbxc-p4    4 payments every two weeks, first one today, no interest
//   sbxc-pl30  pay in full in 30 days, no interest
//   sbxc-m3    3 monthly payments, 4.5% cost of credit
//   sbxc-m6    6 monthly payments, 12% cost of credit (from monthlyFromMinor)
// A payer country outside `countries` gets no plans, as a real lender's
// would. A reference containing "[decline]" is refused at payment creation,
// to rehearse a credit decline.
import { z } from "zod";
import { toMinorUnits } from "../../partners/money";
import type { PartnerDeps } from "../../partners/contract";
import { instalmentOffer } from "../credit";
import type { CreditOffer, PlatformAdapter, PlatformManifest, PlatformModule } from "./contract";
import { createSandboxAdapter, sandboxConfigSchema, sandboxPlatformManifest } from "./sandbox";

const lender = "Sandbox Credit (fictional lender)";
const termsUrl = "/docs/credit";

export const sandboxCreditManifest: PlatformManifest = {
  ...sandboxPlatformManifest,
  id: "sandbox-credit",
  name: "Sandbox Credit",
  // The lender pays the merchant directly, like split settlement.
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: true,
  methods: ["bnpl"],
  documentation: "docs/credit.md",
  credit: { lender, termsUrl, countries: null },
};

const creditConfig = z
  .object({
    minMinor: z.string().regex(/^\d{1,15}$/).default("1000"),
    maxMinor: z.string().regex(/^\d{1,15}$/).default("500000000"),
    monthlyFromMinor: z.string().regex(/^\d{1,15}$/).default("5000000"),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)).nullable().default(null),
  })
  .strict();
const configSchema = sandboxConfigSchema.extend(creditConfig.shape);

function split(raw: unknown) {
  const all = configSchema.parse(raw ?? {});
  const { minMinor, maxMinor, monthlyFromMinor, countries, ...base } = all;
  return { base, credit: { minMinor: BigInt(minMinor), maxMinor: BigInt(maxMinor), monthlyFromMinor: BigInt(monthlyFromMinor), countries } };
}

export function sandboxOffers(
  amountMinor: bigint,
  payerCountry: string | undefined,
  c: ReturnType<typeof split>["credit"],
): CreditOffer[] {
  if (amountMinor < c.minMinor || amountMinor > c.maxMinor) return [];
  if (c.countries && (!payerCountry || !c.countries.includes(payerCountry))) return [];
  const common = { lender, termsUrl, amountMinor };
  const offers = [
    instalmentOffer({ ...common, id: "sbxc-p4", instalments: 4, interval: "two-weeks", costBps: 0, aprBasisPoints: 0, firstDueToday: true }),
    instalmentOffer({ ...common, id: "sbxc-pl30", instalments: 1, interval: "month", costBps: 0, aprBasisPoints: 0, firstDueToday: false }),
    instalmentOffer({ ...common, id: "sbxc-m3", instalments: 3, interval: "month", costBps: 450, aprBasisPoints: null, firstDueToday: false }),
  ];
  if (amountMinor >= c.monthlyFromMinor)
    offers.push(instalmentOffer({ ...common, id: "sbxc-m6", instalments: 6, interval: "month", costBps: 1200, aprBasisPoints: null, firstDueToday: false }));
  return offers;
}

function create(raw: unknown, deps: PartnerDeps): PlatformAdapter {
  const { base, credit } = split(raw);
  const inner = createSandboxAdapter(sandboxCreditManifest)(base, deps);
  const amountMinor = (amount: string, precision: number, currency: string) => toMinorUnits(amount, precision, currency);
  return {
    ...inner,
    async creditOffers(input) {
      const minor = amountMinor(input.amount, input.precision, input.currency);
      return minor === null ? [] : sandboxOffers(minor, input.payerCountry, credit);
    },
    async createPayment(input) {
      const minor = amountMinor(input.amount, input.precision, input.currency);
      // A lender only lends on a plan it priced for exactly this payment.
      const offers = minor === null ? [] : sandboxOffers(minor, input.payerCountry, credit);
      if (!input.credit || !offers.some((o) => o.id === input.credit!.offerId) || input.reference.includes("[decline]"))
        return { state: "Rejected", reference: "" };
      return inner.createPayment(input);
    },
  };
}

export const sandboxCreditPlatform: PlatformModule = {
  manifest: sandboxCreditManifest,
  configSchema,
  create,
};
