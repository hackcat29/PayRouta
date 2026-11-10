import { randomUUID } from "node:crypto";
import { json } from "../portal/service";
import { db } from "../portal/db";
import { stablecoinDepositConfig as depositConfigSchema } from "../blockchain/deposit-config";
import {
  paymentAsset as tokenAsset,
  onchainMethod,
} from "../blockchain/crypto-assets";
import { fingerprint } from "../portal/registry";
import { PortalError } from "../portal/domain";
import { cryptoBlockers } from "../merchant/go-live";
import type { Tx } from "./service";
export const depositPrefix = "deposit:";
export const isDepositProfile = (id: string) => id.startsWith(depositPrefix);
export async function stablecoinCandidates(
  orgId: string,
  environment: string,
  asset?: unknown,
  client: Tx | typeof db = db,
  boundIntentId?: string,
) {
  const [integrations, config] = await Promise.all([
    client.integration.findMany({
      where: { orgId, environment },
      orderBy: [{ version: "desc" }, { id: "asc" }],
    }),
    client.merchantConfig.findUnique({ where: { orgId } }),
  ]);
  if (!config || config.environment !== environment) return [];
  if ((config?.riskPolicy as { paused?: boolean })?.paused) return [];
  // Live crypto settles into the merchant's own accounts and needs no
  // review: only its crypto requirements (lib/merchant/go-live.ts).
  if (environment === "production" && (await cryptoBlockers(client, orgId)).length) return [];
  const out = [];
  // While bank settlement is on it takes its token's checkouts, whichever
  // settlement was set up last.
  const toBank = new Set<string>(),
    toIntents = new Map<string, string>();
  for (const integration of integrations) {
    const parsed = depositConfigSchema.safeParse(integration.config);
    if (!parsed.success || parsed.data.environment !== environment) continue;
    const c = parsed.data;
    const method = onchainMethod(c.network, c.identifier);
    if (
      (
        config.riskPolicy as { blockedMethods?: string[] }
      )?.blockedMethods?.includes(method)
    )
      continue;
    const expected = {
      kind: "blockchain",
      identifier: c.identifier,
      network: c.network,
    };
    if (asset && fingerprint(asset) !== fingerprint(expected)) continue;
    // A NEAR Intents account has no pool to run out of; it stays eligible
    // while the merchant keeps it connected.
    if (c.adapter === "near-intents-deposit") {
      const account = await client.intentsAccount.findUnique({
        where: { id: c.intentsAccountId },
      });
      if (
        !account ||
        account.revokedAt ||
        account.orgId !== orgId ||
        account.environment !== environment ||
        account.accountId !== c.account
      )
        continue;
    } else if (c.adapter === "near-intents-offramp") {
      // Straight to the bank: eligible while the cash-out account is ready
      // and still funded at this address.
      const account = await client.fiatPayoutAccount.findUnique({ where: { id: c.fiatAccountId } });
      if (!account || account.orgId !== orgId || account.environment !== environment || account.status !== "Ready" || !account.settleCheckouts) continue;
      const funding = account.partner === "bridge" ? account.liquidationAddress : process.env.YELLOWCARD_TOPUP_ADDRESS;
      if (funding?.toLowerCase() !== c.address) continue;
      toBank.add(`${c.network}|${c.identifier}`);
    } else if (
      (await client.depositBinding.count({
        where: { network: c.network, address: { in: c.addresses } },
      })) === c.addresses.length
    ) {
      if (!boundIntentId) continue;
      const own = await client.paymentAttempt.findFirst({
        where: {
          intentId: boundIntentId,
          integrationId: integration.id,
          providerOrgId: orgId,
          state: {
            in: ["Dispatching", "Unknown", "Requires action", "Pending"],
          },
        },
      });
      if (
        !own ||
        !(await client.depositBinding.findUnique({
          where: { attemptId: own.id },
        }))
      )
        continue;
    }
    if (c.adapter === "near-intents-deposit") toIntents.set(integration.id, `${c.network}|${c.identifier}`);
    out.push({
      profileId: `${depositPrefix}${integration.id}`,
      integrationId: integration.id,
      method,
      name: `${tokenAsset(c.network, c.identifier)!.symbol} on ${c.network}`,
      intents: c.adapter === "near-intents-deposit" || c.adapter === "near-intents-offramp",
      asset: expected,
    });
  }
  return out.filter((o) => !toBank.has(toIntents.get(o.integrationId) ?? ""));
}
export async function revalidateDepositEvaluation(
  intent: {
    orgId: string;
    contextId: string;
    environment: string;
    asset?: unknown;
    id?: string;
  },
  evaluationId: string,
  now: Date,
) {
  const [e, c] = await Promise.all([
    db.availabilityEvaluation.findFirst({
      where: {
        id: evaluationId,
        orgId: intent.orgId,
        contextId: intent.contextId,
        environment: intent.environment,
      },
    }),
    db.availabilityContext.findFirst({
      where: { id: intent.contextId, orgId: intent.orgId },
    }),
  ]);
  if (
    !e ||
    !c ||
    e.expiresAt <= now ||
    c.expiresAt <= now ||
    e.contextFingerprint !== fingerprint(c.context)
  )
    throw new PortalError("EVALUATION_EXPIRED_OR_MISMATCHED", 409);
  return stablecoinCandidates(
    intent.orgId,
    intent.environment,
    intent.asset,
    db,
    intent.id,
  );
}

// Native receive pools have their own short-lived eligibility snapshot. Unrelated
// registry-provider observations must not expire a direct stablecoin checkout.
export async function evaluateDepositContext(
  intent: {
    id: string;
    orgId: string;
    contextId: string;
    environment: string;
    asset: unknown;
  },
  now = new Date(),
) {
  const context = await db.availabilityContext.findFirst({
    where: {
      id: intent.contextId,
      orgId: intent.orgId,
      environment: intent.environment,
    },
  });
  if (!context || context.expiresAt <= now)
    throw new PortalError("CONTEXT_EXPIRED", 409);
  const candidates = await stablecoinCandidates(
    intent.orgId,
    intent.environment,
    intent.asset,
  );
  const evaluationId = randomUUID();
  const expiresAt = new Date(
    Math.min(context.expiresAt.getTime(), now.getTime() + 60000),
  );
  const asset = intent.asset as { network: string; identifier: string };
  const method = onchainMethod(asset.network, asset.identifier);
  const safe = {
    evaluationId,
    evaluatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    methods: [
      {
        method,
        label: method === "crypto-app" ? "Crypto wallet" : "Stablecoins",
        status: candidates.length ? "AVAILABLE" : "UNAVAILABLE",
        explanation: candidates[0]?.intents
          ? "Pay from any token on any chain; the merchant receives this stablecoin through NEAR Intents"
          : candidates.length
          ? "Pay directly to the merchant's stablecoin receive address"
          : "This merchant has not configured this token and network yet.",
      },
    ],
  };
  await db.availabilityEvaluation.create({
    data: {
      id: evaluationId,
      contextId: context.id,
      orgId: intent.orgId,
      environment: intent.environment,
      policyVersion: context.policyVersion,
      contextFingerprint: fingerprint(context.context),
      safe: json(safe),
      trace: json({
        source: "merchant-deposit-pools",
        candidateIds: candidates.map((c) => c.profileId),
      }),
      expiresAt,
      retentionUntil: new Date(now.getTime() + 7 * 86400000),
      createdAt: now,
    },
  });
  return safe;
}
