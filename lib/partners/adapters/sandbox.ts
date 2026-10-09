// Fictional sandbox partner for local end-to-end runs and tests. It never
// contacts a network and is refused outside local mode by the registry.
//
// Progression is deterministic from the account reference, which encodes the
// creation time: action required (hosted onboarding) → under review →
// approved. A legal name containing "[reject]" ends in Rejected.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { verify } from "../../payments/contracts";
import { db } from "../../portal/db";
import { json } from "../../portal/service";
import { toMinorUnits } from "../money";
import { PortalError } from "../../portal/domain";
import type {
  PartnerAdapter,
  PartnerDeps,
  PartnerManifest,
  PartnerModule,
  StatusSnapshot,
} from "../contract";
import { assertLinkHost } from "../contract";

export const sandboxManifest: PartnerManifest = {
  id: "sandbox",
  name: "Sandbox partner",
  contractVersion: 1,
  paymentMethods: ["card", "bank-transfer"],
  ownership: {
    merchantContractsDirectly: true,
    merchantHasOwnLogin: true,
    lossesBorneBy: "merchant",
    settlesToMerchant: true,
    portableOnExit: true,
  },
  onboarding: "api-prefill",
  methods: ["card", "bank-transfer"],
  merchantCountries: null,
  sharedFields: [
    "legalName",
    "businessType",
    "country",
    "website",
    "supportEmail",
    "representative",
  ],
  linkHosts: ["127.0.0.1:3000"],
  requiresPartnerApproval: false,
  documentation: "docs/PARTNER-PROGRAM.md",
  sandboxOnly: true,
};

const configSchema = z
  .object({
    environment: z.literal("sandbox").default("sandbox"),
    // Defaults to the portal's own origin (local or hosted sandbox).
    origin: z.url().optional(),
    webhookSecretRef: z.string().max(100).optional(),
    reviewSeconds: z.number().int().min(0).max(3600).default(30),
  })
  .strict();

export function sandboxSnapshot(
  accountRef: string,
  now: Date,
  reviewSeconds: number,
): StatusSnapshot {
  const m = accountRef.match(/^sbx_(ok|rej)_(\d{13})_[a-f0-9]{8}$/);
  if (!m) throw new PortalError("PARTNER_ACCOUNT_UNKNOWN", 404);
  const age = (now.getTime() - Number(m[2])) / 1000;
  if (age < reviewSeconds)
    return {
      state: "Action required",
      requirementsDue: ["complete-hosted-onboarding"],
      paymentsEnabled: false,
      payoutsEnabled: false,
    };
  if (age < reviewSeconds * 2)
    return {
      state: "Under review",
      requirementsDue: [],
      paymentsEnabled: false,
      payoutsEnabled: false,
    };
  return m[1] === "rej"
    ? {
        state: "Rejected",
        requirementsDue: [],
        paymentsEnabled: false,
        payoutsEnabled: false,
        reason: "fictional-rejection",
      }
    : {
        state: "Approved",
        providerAccountId: `acct_sbx_${accountRef.slice(-8)}`,
        requirementsDue: [],
        paymentsEnabled: true,
        payoutsEnabled: true,
      };
}

function create(raw: unknown, deps: PartnerDeps): PartnerAdapter {
  const c = configSchema.parse(raw ?? {});
  const now = () => deps.now?.() ?? new Date();
  return {
    manifest: sandboxManifest,
    // Fictional payments reuse the simulator's durable records keyed by the
    // attempt, so the sandbox checkout's "complete" action confirms them.
    payments: {
      methods: sandboxManifest.paymentMethods!,
      paymentHosts: [],
      async create(input) {
        if (toMinorUnits(input.amount, input.precision, input.currency) === null)
          return { state: "Rejected", reference: "" };
        const record = await db.simulatorPayment.upsert({
          where: { key: input.attemptKey },
          create: {
            key: input.attemptKey,
            reference: `sbxpay-${randomBytes(8).toString("hex")}`,
            state: "Requires action",
            amount: input.amount,
            asset: json({ kind: "fiat", identifier: input.currency, network: "" }),
          },
          update: {},
        });
        return { state: "Requires action", reference: record.reference };
      },
      async status(input) {
        const record = await db.simulatorPayment.findUnique({
          where: { reference: input.reference },
        });
        if (!record) return null;
        return {
          state: record.state as "Requires action" | "Confirmed",
          reference: record.reference,
          amount: record.amount,
          currency: (record.asset as { identifier: string }).identifier,
        };
      },
    },
    async createAccount(input) {
      if (input.environment !== "sandbox")
        throw new PortalError("SANDBOX_PARTNER_ONLY", 409);
      const outcome = String(input.profile.legalName ?? "").includes("[reject]")
        ? "rej"
        : "ok";
      const accountRef = `sbx_${outcome}_${now().getTime()}_${randomBytes(4).toString("hex")}`;
      return {
        accountRef,
        snapshot: sandboxSnapshot(accountRef, now(), c.reviewSeconds),
      };
    },
    async onboardingLink(input) {
      const origin = c.origin ?? process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3000";
      const url = new URL("/merchant/providers", origin);
      url.searchParams.set("sandboxAccount", input.accountRef);
      return {
        url: assertLinkHost(sandboxManifest, url.toString()),
        expiresAt: new Date(now().getTime() + 5 * 60000),
      };
    },
    async status(input) {
      return sandboxSnapshot(input.accountRef, now(), c.reviewSeconds);
    },
    // Same signed-event scheme PayRouta uses for its own simulator.
    async verifyEvent({ rawBody, headers }) {
      if (!c.webhookSecretRef) return null;
      const secret = await deps.credentials.get(c.webhookSecretRef);
      const eventId = headers.get("payrouta-event-id") || "";
      if (
        !secret ||
        !/^[\w-]{1,100}$/.test(eventId) ||
        !verify(
          secret,
          headers.get("payrouta-timestamp") || "",
          eventId,
          rawBody,
          headers.get("payrouta-signature") || "",
          now(),
        )
      )
        return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return null;
      }
      const body = z
        .object({ type: z.string().max(100), accountRef: z.string().max(200) })
        .safeParse(parsed);
      return body.success
        ? { eventId, type: body.data.type, accountRef: body.data.accountRef }
        : null;
    },
  };
}

export const sandboxPartner: PartnerModule = {
  manifest: sandboxManifest,
  configSchema,
  create,
};
