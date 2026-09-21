import "dotenv/config";
import {
  storedLiveScope,
  scopeReviewCurrent,
  validateScopeEvidence,
} from "../lib/merchant/live-scope";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { db } from "../lib/portal/db";
const planSchema = z
  .object({
    merchantId: z.string(),
    operatorId: z.string(),
    participantConsentEvidence: z.array(z.string()).min(1),
    settlementDestinationEvidence: z.string(),
    approvalEvidence: z.string(),
    webhookEvidence: z.string(),
    retentionEvidence: z.string(),
    refundRunbook: z.string(),
    budgetMinor: z.string().regex(/^[1-9]\d*$/),
    feeBudgetMinor: z.string().regex(/^\d+$/),
    transactions: z
      .array(
        z
          .object({
            reference: z.string(),
            integrationId: z.string(),
            method: z.enum(["bank-transfer", "card"]),
            amountMinor: z.string().regex(/^[1-9]\d*$/),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
async function main() {
  if (!process.argv[2])
    throw new Error(
      "Usage: npx tsx scripts/pilot-preflight.ts /path/to/approved-plan.json",
    );
  const plan = planSchema.parse(
    JSON.parse(await readFile(process.argv[2], "utf8")),
  );
  const checks: { check: string; passed: boolean }[] = [];
  const add = (check: string, passed: boolean) =>
    checks.push({ check, passed });
  const merchant = await db.merchantConfig.findUnique({
    where: { orgId: plan.merchantId },
  });
  add(
    "merchant.production_configuration",
    merchant?.environment === "production",
  );
  const scope = storedLiveScope.safeParse(merchant?.liveScope);
  add(
    "merchant.approved_scope",
    merchant?.applicationState === "Approved" &&
      scopeReviewCurrent(merchant.liveScope),
  );
  let scopeEvidence = false;
  if (merchant && scope.success && scopeReviewCurrent(merchant.liveScope)) {
    try {
      await validateScopeEvidence(
        db,
        merchant.orgId,
        scope.data.input,
        merchant.application,
        new Date(),
      );
      scopeEvidence = true;
    } catch {
      scopeEvidence = false;
    }
  }
  add("merchant.current_account_profile_evidence", scopeEvidence);
  add(
    "transactions.within_reviewed_scope",
    scope.success &&
      scopeReviewCurrent(merchant?.liveScope) &&
      plan.transactions.every(
        (t) =>
          scope.data.input.accounts.some(
            (a) => a.integrationId === t.integrationId,
          ) &&
          scope.data.input.methods.includes(t.method) &&
          BigInt(t.amountMinor) <= BigInt(scope.data.input.maximumMinor),
      ) &&
      plan.transactions.reduce((n, t) => n + BigInt(t.amountMinor), 0n) <=
        BigInt(scope.data.input.dailyMaximumMinor),
  );
  add(
    "merchant.webhook_configured",
    !!merchant?.webhookUrl && !!merchant?.webhookSecretRef,
  );
  const operator = await db.user.findUnique({ where: { id: plan.operatorId } });
  add(
    "operator.privileged_mfa",
    operator?.internalRole === "Operations admin" &&
      !!operator.twoFactorEnabled,
  );
  const refs = [
    ...plan.participantConsentEvidence,
    plan.settlementDestinationEvidence,
    plan.approvalEvidence,
    plan.webhookEvidence,
    plan.retentionEvidence,
  ];
  const evidence = await db.evidence.findMany({
    where: {
      id: { in: refs },
      orgId: plan.merchantId,
      scanStatus: "Clean",
      reviewStatus: "Accepted",
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  add(
    "pilot.required_evidence",
    new Set(evidence.map((e) => e.id)).size === new Set(refs).size,
  );
  const total =
    plan.transactions.reduce((n, t) => n + BigInt(t.amountMinor), 0n) +
    BigInt(plan.feeBudgetMinor);
  add("budget.within_declared_cap", total <= BigInt(plan.budgetMinor));
  add(
    "references.unique",
    new Set(plan.transactions.map((t) => t.reference)).size ===
      plan.transactions.length,
  );
  const integrations = await db.integration.findMany({
    where: {
      id: { in: plan.transactions.map((t) => t.integrationId) },
      environment: "production",
    },
  });
  add(
    "provider.production_integrations",
    new Set(integrations.map((i) => i.id)).size ===
      new Set(plan.transactions.map((t) => t.integrationId)).size,
  );
  const exceptions = await db.paymentException.count({
    where: {
      intent: { orgId: plan.merchantId, environment: "production" },
      state: { not: "Resolved" },
    },
  });
  add("integrity.no_unresolved_exceptions", exceptions === 0);
  // Deliberate software gate, not an operator-editable claim of readiness.
  add("software.real_orchestrator_and_settlement_qualified", false);
  console.log(
    JSON.stringify(
      {
        status: "Blocked",
        checkedAt: new Date().toISOString(),
        currency: "NGN",
        plannedPayments: plan.transactions.length,
        proposedTotalMinor: total.toString(),
        checks,
        transactions: plan.transactions,
        financialActionsTaken: 0,
      },
      null,
      2,
    ),
  );
  process.exitCode = 2;
}
main()
  .catch(() => {
    console.error(
      "PREFLIGHT_INVALID_OR_UNAVAILABLE: check plan schema and database configuration; no financial action taken",
    );
    process.exitCode = 2;
  })
  .finally(() => db.$disconnect());
