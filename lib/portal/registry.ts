import { assessEvidence } from "./evidence-policy";
import { createHash } from "node:crypto";
import { db } from "./db";
import { atomic, json } from "./service";
import { capabilitySchema, Draft, PortalError } from "./domain";
import { assertAdapterConfiguration } from "./provider-adapters";
import { localMode } from "./adapters";
import type { Prisma } from "../generated/prisma/client";

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
export type SubmissionSnapshot = {
  draft: Draft;
  integrations: {
    id: string;
    environment: string;
    version: number;
    config: { adapter: string };
  }[];
  requirements: { id: string }[];
  evidence: { id: string; requirementId: string }[];
};
export async function publicationEvidence(
  tx: Prisma.TransactionClient,
  orgId: string,
  environment: string,
  snapshot: SubmissionSnapshot,
  now: Date,
) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: orgId } });
  const evidence = await tx.evidence.findMany({
    where: {
      orgId,
      id: { in: snapshot.evidence.map((e) => e.id) },
      deletedAt: null,
    },
  });
  const fixture = environment === "sandbox" && localMode() && org.fictional;
  return {
    ...assessEvidence(snapshot.requirements, evidence, fixture, now),
    fictional: org.fictional,
  };
}
export async function publishActivation(
  activationId: string,
  key: string,
  now = new Date(),
) {
  return atomic(async (tx) => {
    const activation = await tx.activation.findUniqueOrThrow({
      where: { id: activationId },
      include: {
        submission: {
          include: { reviews: { orderBy: { createdAt: "desc" } } },
        },
      },
    });
    const { orgId, environment, sequence, action } = activation;
    if (key !== `registry:${activation.id}`)
      throw new PortalError("PUBLICATION_KEY_MISMATCH", 409);
    const snapshot = activation.submission
      .snapshot as unknown as SubmissionSnapshot;
    const hash = fingerprint({
      orgId,
      environment,
      sequence,
      action,
      submissionId: activation.submissionId,
      snapshot,
    });
    const existing = await tx.registrySnapshot.findUnique({ where: { key } });
    if (
      existing &&
      fingerprint({
        orgId: existing.orgId,
        environment: existing.environment,
        sequence: existing.sequence,
        action: existing.action,
        submissionId: activation.submissionId,
        snapshot: existing.snapshot,
      }) !== hash
    )
      throw new PortalError("PUBLICATION_CONFLICT", 409);
    const head = await tx.registryHead.findUnique({
      where: { orgId_environment: { orgId, environment } },
    });
    if (head && head.sequence === sequence && head.fingerprint !== hash)
      throw new PortalError("PUBLICATION_CONFLICT", 409);
    if (head && head.sequence >= sequence)
      return { stale: head.sequence > sequence, revision: head.sequence };
    if (action === "publish") {
      const reviews = activation.submission.reviews;
      if (
        ["application", "legal", "technical"].some(
          (kind) =>
            reviews.find((r) => r.kind === kind)?.decision !==
            (kind === "application" ? "Approved" : "Passed"),
        )
      )
        throw new PortalError("APPROVED_VERSION_REQUIRED", 409);
      const evidence = await publicationEvidence(
        tx,
        orgId,
        environment,
        snapshot,
        now,
      );
      if (
        !evidence.valid ||
        (environment === "production" && evidence.fictional)
      )
        throw new PortalError("PUBLICATION_EVIDENCE_INVALID", 409);
      // The deployment still needs real provider, vault and scanner integrations before production activation.
      const assigned = new Set(
        (snapshot.draft.capabilities || [])
          .filter((c) => c.environment === environment && c.fulfillment)
          .map((c) => c.fulfillment!.integrationId),
      );
      const integrations = snapshot.integrations.filter(
        (i) => i.environment === environment && assigned.has(i.id),
      );
      if (!assigned.size) {
        const legacy = snapshot.integrations.find(
          (i) => i.environment === environment,
        );
        if (!legacy) throw new PortalError("INTEGRATION_REQUIRED", 409);
        integrations.push(legacy);
      }
      for (const integration of integrations)
        assertAdapterConfiguration(
          integration.config.adapter,
          "1",
          environment,
          integration.config,
        );
    }
    if (!existing)
      await tx.registrySnapshot.create({
        data: {
          key,
          orgId,
          environment,
          sequence,
          action,
          snapshot: json(snapshot),
          acknowledgedAt: now,
        },
      });
    await tx.publishedProfile.updateMany({
      where: { orgId, environment, current: true },
      data: { current: false },
    });
    if (action === "publish") {
      for (const raw of snapshot.draft.capabilities || []) {
        if (raw.environment !== environment) continue;
        const c = capabilitySchema.parse(raw);
        // Free-text legacy capabilities retain their historical publication, never inferred eligibility.
        if (!c.fulfillment) continue;
        const f = c.fulfillment;
        const integration = snapshot.integrations.find(
          (i) => i.id === f.integrationId && i.environment === environment,
        );
        if (!integration)
          throw new PortalError("INTEGRATION_NOT_IN_APPROVED_SNAPSHOT", 409);
        const stored = await tx.integration.findFirst({
          where: { id: integration.id, orgId, environment },
        });
        if (
          !stored ||
          fingerprint(stored.config) !== fingerprint(integration.config)
        )
          throw new PortalError("INTEGRATION_VERSION_MISMATCH", 409);
        const adapter = assertAdapterConfiguration(
          integration.config.adapter,
          f.adapterVersion,
          environment,
          integration.config,
        );
        if (f.checks.some((check) => !adapter.operations.includes(check)))
          throw new PortalError("REQUIRED_ADAPTER_OPERATION_UNSUPPORTED", 409);
        await tx.publishedProfile.create({
          data: {
            id: `${key}:${c.capabilityId}`,
            orgId,
            integrationId: integration.id,
            environment,
            capabilityId: c.capabilityId,
            capabilityVersion: c.version,
            submissionId: activation.submissionId,
            publicationKey: key,
            revision: sequence,
            method: f.method,
            operation: c.operation,
            origin: c.origin,
            destination: c.destination,
            inputAsset: c.input.identifier,
            inputNetwork: c.input.network,
            definition: json(c),
          },
        });
      }
    }
    await tx.registryHead.upsert({
      where: { orgId_environment: { orgId, environment } },
      create: { orgId, environment, sequence, key, fingerprint: hash, action },
      update: { sequence, key, fingerprint: hash, action },
    });
    return { stale: false, revision: sequence };
  });
}
export async function reconcileRegistry(limit = 100, cursor?: string) {
  const activations = await db.activation.findMany({
    orderBy: { id: "asc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: Math.min(Math.max(limit, 1), 100),
  });
  let queued = 0;
  for (const a of activations) {
    const head = await db.registryHead.findUnique({
      where: {
        orgId_environment: { orgId: a.orgId, environment: a.environment },
      },
    });
    if (a.acknowledgedAt && head && head.sequence >= a.sequence) continue;
    await db.job.upsert({
      where: { key: `registry:${a.id}` },
      create: {
        orgId: a.orgId,
        kind: "registry",
        key: `registry:${a.id}`,
        payload: { activationId: a.id },
      },
      update: {},
    });
    // Recover missing projections or acknowledgment, leaving a currently claimed job alone.
    await db.job.updateMany({
      where: {
        key: `registry:${a.id}`,
        state: { in: ["Failed", "Succeeded"] },
      },
      data: { state: "Pending", availableAt: new Date(), error: null },
    });
    queued++;
  }
  return {
    inspected: activations.length,
    queued,
    nextCursor:
      activations.length === Math.min(Math.max(limit, 1), 100)
        ? activations.at(-1)!.id
        : null,
  };
}
export async function queryPublishedCandidates(query: {
  environment: "sandbox" | "production";
  orgId?: string;
  integrationId?: string;
  method?: string;
  operation?: string;
  inputAsset?: string;
  inputNetwork?: string;
  origin?: string;
  destination?: string;
  cursor?: string;
  current?: boolean;
  limit?: number;
}) {
  const { cursor, limit = 50, current = true, ...dimensions } = query;
  const count = Math.min(Math.max(limit, 1), 100);
  const rows = await db.publishedProfile.findMany({
    where: { ...dimensions, current },
    orderBy: { id: "asc" },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: count,
  });
  return { rows, nextCursor: rows.length === count ? rows.at(-1)!.id : null };
}

// Explicit rollback is a new revision of an already approved sandbox submission.
export async function republishApproved(
  orgId: string,
  submissionId: string,
  actorId: string,
  reason: string,
  now = new Date(),
) {
  return atomic(async (tx) => {
    const submission = await tx.submission.findFirst({
      where: { id: submissionId, application: { orgId } },
      include: { reviews: { orderBy: { createdAt: "desc" } } },
    });
    if (
      !submission ||
      ["application", "legal", "technical"].some(
        (kind) =>
          submission.reviews.find((r) => r.kind === kind)?.decision !==
          (kind === "application" ? "Approved" : "Passed"),
      )
    )
      throw new PortalError("APPROVED_VERSION_REQUIRED", 409);
    const snapshot = submission.snapshot as unknown as SubmissionSnapshot;
    const evidence = await publicationEvidence(
      tx,
      orgId,
      "sandbox",
      snapshot,
      now,
    );
    if (!localMode() || !evidence.fictional || !evidence.valid)
      throw new PortalError("SANDBOX_REPUBLICATION_ONLY", 409);
    const integration = snapshot.integrations.find(
      (i) => i.environment === "sandbox",
    );
    if (!integration) throw new PortalError("INTEGRATION_REQUIRED", 409);
    assertAdapterConfiguration(
      integration.config.adapter,
      "1",
      "sandbox",
      integration.config,
    );
    const run = await tx.sandboxRun.findFirst({
      where: {
        orgId,
        environment: "sandbox",
        adapter: "simulator",
        integrationVersion: integration.version,
        outcome: "Passed",
      },
    });
    if (!run) throw new PortalError("ACTIVATION_PREREQUISITES_REQUIRED", 409);
    const latest = await tx.activation.findFirst({
      where: { orgId, environment: "sandbox" },
      orderBy: { sequence: "desc" },
    });
    if (latest?.state === "Pending")
      throw new PortalError("PUBLICATION_PENDING", 409);
    const activation = await tx.activation.create({
      data: {
        orgId,
        submissionId,
        environment: "sandbox",
        sequence: (latest?.sequence || 0) + 1,
        actorId,
        reason,
        action: "publish",
        state: "Pending",
      },
    });
    await tx.job.create({
      data: {
        orgId,
        kind: "registry",
        key: `registry:${activation.id}`,
        payload: { activationId: activation.id },
      },
    });
    await tx.audit.create({
      data: {
        orgId,
        actorId,
        action: "Approved version republish requested",
        target: activation.id,
        metadata: { submissionId, reason },
        internal: true,
      },
    });
    return { activationId: activation.id, revision: activation.sequence };
  });
}
