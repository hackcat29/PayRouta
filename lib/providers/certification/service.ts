import { db } from "../../portal/db";
import { json } from "../../portal/service";
import {
  CapabilitySummary,
  CertificationTarget,
  buildCertificationPlan,
  humanizeFailure,
  runCertification,
  ScenarioOutcome,
} from "./suite";

// Deterministic sandbox target used to certify the fictional simulator. It
// exercises the same normalized contract a real provider would, without
// touching a network or moving money.
export function simulatorTarget(): CertificationTarget {
  const settled = new Map<string, { state: string; amount: string }>();
  return {
    async createPayment(input) {
      settled.set(input.reference, { state: "Confirmed", amount: input.amount });
      return { state: "Confirmed", reference: input.reference };
    },
    async getPayment(reference) {
      return settled.get(reference) ?? { state: "Confirmed", amount: "100.00" };
    },
    async cancelPayment() {
      return { state: "Rejected" };
    },
    async verifyWebhook(input) {
      return (input as { valid: boolean }).valid;
    },
  };
}

export function deriveCapabilitySummary(config: unknown): CapabilitySummary {
  const c = (config ?? {}) as {
    adapter?: string;
    mode?: string;
    events?: string;
  };
  const create = c.adapter === "simulator" || !!c.mode;
  const cancel =
    c.adapter === "simulator" || c.mode === "STANDARD";
  return {
    operations: [
      ...(create ? (["create-payment", "payment-status"] as const) : []),
      ...(cancel ? (["cancel-payment"] as const) : []),
    ],
    webhook: c.events === "webhook",
  };
}

export interface CertifyInput {
  orgId: string;
  environment: string;
  integrationId: string;
  capabilityId?: string;
  target: CertificationTarget;
  capability: CapabilitySummary;
  now?: Date;
}

export function summarize(results: ScenarioOutcome[]) {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  return {
    status: failed === 0 ? "Certified" : "Certification failed",
    passed,
    failed,
    humanFailures: results
      .filter((r) => !r.passed && r.diagnosticCode)
      .map((r) => humanizeFailure(r.diagnosticCode!)),
  };
}

export async function certifyAndPersist(input: CertifyInput) {
  const now = input.now ?? new Date();
  const plan = buildCertificationPlan(input.capability);
  const results = await runCertification(input.target, input.capability);
  const summary = summarize(results);
  const record = await db.providerCertification.create({
    data: {
      orgId: input.orgId,
      environment: input.environment,
      integrationId: input.integrationId,
      capabilityId: input.capabilityId ?? null,
      status: summary.status,
      scenarios: json(results),
      passed: summary.passed,
      failed: summary.failed,
      humanFailures: json(summary.humanFailures),
      createdAt: now,
    },
  });
  return { record, plan: plan.map((s) => s.id), results, summary };
}

export async function queueCertification(input: {
  orgId: string;
  environment: string;
  integrationId: string;
  capabilityId?: string;
}) {
  const key = `certify:${input.environment}:${input.integrationId}:${input.capabilityId ?? "integration"}`;
  return db.job.upsert({
    where: { key },
    create: {
      orgId: input.orgId,
      kind: "certification",
      key,
      payload: {
        environment: input.environment,
        integrationId: input.integrationId,
        capabilityId: input.capabilityId ?? null,
      },
    },
    update: {},
  });
}
