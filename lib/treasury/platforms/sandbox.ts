// Fictional platforms for local mode and tests. Sub-accounts are approved
// after `reviewSeconds`; payments reuse the simulator's durable records so the
// sandbox checkout's "complete" action confirms them; the merchant's share is
// available `availabilityDays` after confirmation. "sandbox-platform" holds
// funds like Stripe Connect; "sandbox-split" settles to the merchant directly
// and takes a 1.5% processing fee from the merchant's share, like Paystack
// subaccounts. Never runs outside local mode.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "../../portal/db";
import { PortalError } from "../../portal/domain";
import { json } from "../../portal/service";
import { platformBalance } from "../ledger";
import type { PartnerDeps, StatusSnapshot } from "../../partners/contract";
import { currencyExponent, toMinorUnits } from "../../partners/money";
import type { PlatformAdapter, PlatformManifest, PlatformModule } from "./contract";

export const sandboxPlatformManifest: PlatformManifest = {
  id: "sandbox-platform",
  name: "Sandbox Platform",
  custody: "partner-held",
  holdsFunds: true,
  merchantBearsProcessingFee: false,
  feeCollection: "withheld",
  merchantCountries: null,
  methods: ["card", "bank-transfer"],
  sharedFields: ["legalName", "businessType", "country", "website", "supportEmail"],
  paymentHosts: [],
  documentation: "docs/AGGREGATOR.md",
  sandboxOnly: true,
};

export const sandboxConfigSchema = z
  .object({
    environment: z.literal("sandbox").default("sandbox"),
    reviewSeconds: z.number().int().min(0).max(3600).default(0),
    availabilityDays: z.number().int().min(0).max(30).default(2),
    // How fictional payouts end: paid at once, in transit until re-read
    // (then paid), or refused by the fictional bank.
    payoutOutcome: z.enum(["paid", "in-transit", "failed"]).default("paid"),
    refundOutcome: z.enum(["succeeded", "pending", "failed"]).default("succeeded"),
    // Added to the balance this fictional provider reports, to rehearse a
    // reconciliation mismatch.
    balanceOffsetMinor: z.number().int().default(0),
  })
  .strict();

const account = /^acct_sbxp_(ok|rej)_(\d{13})_[a-f0-9]{8}$/;
const reference = /^sbxplat-[a-f0-9]{16}-f(\d{1,30})$/;

function snapshot(id: string, now: Date, reviewSeconds: number): StatusSnapshot {
  const m = id.match(account);
  if (!m) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
  const base = { providerAccountId: id, requirementsDue: [] };
  if ((now.getTime() - Number(m[2])) / 1000 < reviewSeconds)
    return {
      ...base,
      state: "Action required",
      requirementsDue: ["review"],
      paymentsEnabled: false,
      payoutsEnabled: false,
    };
  return m[1] === "rej"
    ? { ...base, state: "Rejected", paymentsEnabled: false, payoutsEnabled: false, reason: "fictional-rejection" }
    : { ...base, state: "Approved", paymentsEnabled: true, payoutsEnabled: true };
}

export const sandboxSplitManifest: PlatformManifest = {
  ...sandboxPlatformManifest,
  id: "sandbox-split",
  name: "Sandbox Split",
  custody: "split-settlement",
  holdsFunds: false,
  merchantBearsProcessingFee: true,
};

// Also the base of the fictional lender in ./sandbox-credit.
export const createSandboxAdapter = (manifest: PlatformManifest) => (raw: unknown, deps: PartnerDeps): PlatformAdapter => {
  const c = sandboxConfigSchema.parse(raw ?? {});
  const now = () => deps.now?.() ?? new Date();
  return {
    async createAccount(input) {
      if (input.environment !== "sandbox") throw new PortalError("SANDBOX_PLATFORM_ONLY", 409);
      const outcome = String(input.profile.legalName ?? "").includes("[reject]") ? "rej" : "ok";
      const id = `acct_sbxp_${outcome}_${now().getTime()}_${randomBytes(4).toString("hex")}`;
      return { providerAccountId: id, snapshot: snapshot(id, now(), c.reviewSeconds) };
    },
    async accountStatus(id) {
      return snapshot(id, now(), c.reviewSeconds);
    },
    async createPayment(input) {
      const minor = toMinorUnits(input.amount, input.precision, input.currency);
      if (minor === null || input.feeMinor >= minor) return { state: "Rejected", reference: "" };
      const record = await db.simulatorPayment.upsert({
        where: { key: input.attemptKey },
        create: {
          key: input.attemptKey,
          // The fictional provider remembers the withheld fee in its reference.
          reference: `sbxplat-${randomBytes(8).toString("hex")}-f${input.feeMinor}`,
          state: "Requires action",
          amount: input.amount,
          asset: json({ kind: "fiat", identifier: input.currency, network: "" }),
        },
        update: {},
      });
      return { state: "Requires action", reference: record.reference };
    },
    async paymentStatus(input) {
      const record = await db.simulatorPayment.findUnique({ where: { reference: input.reference } });
      if (!record) return null;
      return {
        state: record.state as "Requires action" | "Confirmed",
        reference: record.reference,
        amount: record.amount,
        currency: (record.asset as { identifier: string }).identifier,
      };
    },
    ...(manifest.holdsFunds
      ? {
          async createPayout(input: { payoutId: string }) {
            const reference = `sbxpo_${input.payoutId}`;
            if (c.payoutOutcome === "failed") return { reference, state: "Failed" as const, failureCode: "fictional-bank-refused" };
            return { reference, state: c.payoutOutcome === "paid" ? ("Paid" as const) : ("In transit" as const) };
          },
          async payoutStatus() {
            return c.payoutOutcome === "failed" ? { state: "Failed" as const } : { state: "Paid" as const };
          },
        }
      : {}),
    // The fictional card network accepts any evidence.
    async submitDisputeEvidence() {},
    async createRefund(input) {
      const reference = `sbxre_${input.refundId}`;
      if (c.refundOutcome === "failed") return { reference, state: "Failed" as const, failureCode: "fictional-refund-refused" };
      return { reference, state: c.refundOutcome === "succeeded" ? ("Succeeded" as const) : ("Pending" as const) };
    },
    async refundStatus() {
      return { state: c.refundOutcome === "failed" ? ("Failed" as const) : ("Succeeded" as const) };
    },
    // The fictional provider reports exactly what PayRouta's ledger says sits
    // in the sub-account, plus balanceOffsetMinor.
    async accountBalance(providerAccountId: string) {
      const link = await db.merchantPlatformLink.findFirst({ where: { providerAccountId } });
      if (!link) throw new PortalError("PLATFORM_ACCOUNT_UNKNOWN", 404);
      const out: Record<string, bigint> = {};
      const assets = await db.journalEntry.findMany({
        where: { orgId: link.orgId, book: "merchant-funds", platformAccountId: link.platformAccountId },
        distinct: ["asset"],
        select: { asset: true },
      });
      for (const { asset } of assets) {
        let total = 0n;
        for (const account of ["merchant-pending", "merchant-available", "merchant-reserve", "merchant-receivable"])
          total += await platformBalance(db, { orgId: link.orgId, environment: link.environment, platformAccountId: link.platformAccountId, asset, account });
        out[asset.slice(5, 8)] = total + BigInt(c.balanceOffsetMinor);
      }
      return out;
    },
    async fundsAvailability(input) {
      const fee = input.reference.match(reference)?.[1];
      const record = await db.simulatorPayment.findUnique({ where: { reference: input.reference } });
      if (!fee || record?.state !== "Confirmed") return null;
      const currency = (record.asset as { identifier: string }).identifier;
      const gross = toMinorUnits(record.amount, currencyExponent(currency) ?? -1, currency);
      if (gross === null) throw new PortalError("PLATFORM_RESPONSE_INVALID", 502);
      // 1.5% fictional processing fee, rounded down.
      const processing = manifest.merchantBearsProcessingFee ? (gross * 150n) / 10000n : 0n;
      return {
        paymentRef: input.reference,
        netMinor: gross - BigInt(fee) - processing,
        availableAt: new Date(record.createdAt.getTime() + c.availabilityDays * 86400000),
      };
    },
  };
};

export const sandboxPlatform: PlatformModule = {
  manifest: sandboxPlatformManifest,
  configSchema: sandboxConfigSchema,
  create: createSandboxAdapter(sandboxPlatformManifest),
};
export const sandboxSplitPlatform: PlatformModule = {
  manifest: sandboxSplitManifest,
  configSchema: sandboxConfigSchema,
  create: createSandboxAdapter(sandboxSplitManifest),
};
