import { invoicePaid, overdue, renew } from "../subscriptions/service";
import { screenStablecoinMerchant } from "../merchant/screening";
import { paymentJob } from "../payments/jobs";
import { webhookRetryLimit } from "../payments/delivery";
import { partnerJob } from "../partners/service";
import { treasuryJob } from "../treasury/jobs";
import { db } from "./db";
import { atomic, audit, json } from "./service";
import { simulator } from "./simulator";
import { scanner, localMode, sandboxSimulation, storage } from "./adapters";
import { checkEndpoint } from "./ssrf";
import { Draft, PortalError } from "./domain";
import { publishActivation } from "./registry";
import {
  certifyAndPersist,
  deriveCapabilitySummary,
  simulatorTarget,
} from "../providers/certification/service";

// How long a failed job keeps retrying. A merchant's webhook endpoint may be
// down for a while (a deploy, a restart), so deliveries back off to an hour
// and keep trying for about four hours; other jobs give up after about two
// minutes of backoff, capped at five.
const retryLimit = (kind: string) => (kind === "payment-delivery" ? webhookRetryLimit : 7);
const retryCapMs = (kind: string) => (kind === "payment-delivery" ? 3600000 : 300000);

export interface RegistryAdapter {
  publish(input: {
    key: string;
    orgId: string;
    environment: string;
    sequence: number;
    action: string;
    snapshot: unknown;
  }): Promise<void>;
}
export const registry: RegistryAdapter = {
  async publish(input) {
    await publishActivation(input.key.replace(/^registry:/, ""), input.key);
  },
};
export async function workOnce(jobKey?: string) {
  const now = new Date();
  await db.job.updateMany({
    where: { state: "Running", lockedAt: { lt: new Date(Date.now() - 60000) } },
    data: { state: "Pending", lockedAt: null },
  });
  const candidate = await db.job.findFirst({
    where: {
      state: "Pending",
      availableAt: { lte: now },
      ...(jobKey ? { key: jobKey } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return false;
  const claimed = await db.job.updateMany({
    where: { id: candidate.id, state: "Pending" },
    data: { state: "Running", lockedAt: now, attempts: { increment: 1 } },
  });
  if (!claimed.count) return true;
  try {
    const p = candidate.payload as Record<string, string>;
    if (candidate.kind.startsWith("payment-")) {
      await paymentJob(candidate.kind, p);
    } else if (candidate.kind === "subscription-renew") {
      await renew(p.subscriptionId, p.periodEnd);
    } else if (candidate.kind === "subscription-overdue") {
      await overdue(p.invoiceId);
    } else if (candidate.kind === "subscription-paid") {
      await invoicePaid(p.invoiceId, p.paymentId);
    } else if (candidate.kind === "merchant-screening") {
      await screenStablecoinMerchant(p.orgId,Number(p.version));
    } else if (candidate.kind.startsWith("partner-")) {
      await partnerJob(candidate.kind, p);
    } else if (candidate.kind.startsWith("treasury-")) {
      await treasuryJob(candidate.kind, p);
    } else if (candidate.kind === "certification") {
      const integration = await db.integration.findUniqueOrThrow({
        where: { id: p.integrationId },
      });
      const config = integration.config as { adapter?: string; mode?: string };
      // Only the sandbox simulator is certifiable without a live provider.
      if (
        config.adapter !== "simulator" ||
        p.environment !== "sandbox" ||
        !localMode()
      )
        throw new PortalError(
          "CERTIFICATION_TARGET_NOT_QUALIFIED: a live provider is required",
        );
      await certifyAndPersist({
        orgId: candidate.orgId,
        environment: p.environment,
        integrationId: p.integrationId,
        capabilityId: p.capabilityId ?? undefined,
        target: simulatorTarget(),
        capability: deriveCapabilitySummary(config),
      });
    } else if (candidate.kind === "sandbox") {
      const run = await db.sandboxRun.findUniqueOrThrow({
        where: { id: p.runId },
      });
      const result = await simulator.run(run.scenario);
      await db.sandboxRun.update({
        where: { id: run.id },
        data: {
          outcome: result.outcome,
          steps: json(result.steps),
          finishedAt: new Date(),
        },
      });
      if (
        [
          "Authentication succeeds",
          "Provider unavailable before execution",
        ].includes(run.scenario)
      ) {
        const capabilities = await db.capability.findMany({
          where: { orgId: run.orgId, environment: "sandbox" },
          distinct: ["capabilityId"],
        });
        for (const c of capabilities)
          await db.availability.create({
            data: {
              orgId: run.orgId,
              environment: "sandbox",
              capabilityId: c.capabilityId,
              status:
                run.scenario === "Authentication succeeds"
                  ? "Available"
                  : "Unavailable",
              source: "Simulator observed",
              expiresAt: new Date(Date.now() + 5 * 60000),
            },
          });
      }
    } else if (candidate.kind === "scan") {
      const result = await scanner.scan(p.objectKey);
      await db.evidence.update({
        where: { id: p.evidenceId },
        data: {
          scanStatus: result,
          reviewStatus: result === "Clean" ? "Pending review" : "Uploaded",
        },
      });
      if (result === "Pending scan")
        throw new PortalError(
          "Scanner unconfigured; document remains quarantined",
        );
    } else if (candidate.kind === "delete-document") {
      await storage.delete(p.objectKey);
    } else if (candidate.kind === "endpoint") {
      const config = await db.integration.findUniqueOrThrow({
        where: { id: p.integrationId },
      });
      const c = config.config as { baseUrl: string; healthPath: string };
      const url = new URL(c.healthPath, c.baseUrl).toString();
      const result = await checkEndpoint(url);
      await db.integrationEvent.create({
        data: {
          orgId: candidate.orgId,
          environment: p.environment,
          eventId: candidate.key,
          type: "Endpoint health check",
          state:
            result.status >= 200 && result.status < 300
              ? "Reachable"
              : "Rejected",
          summary: `Integration v${config.version}: HTTP ${result.status}; ${result.bytes} response bytes. Connectivity check only.`,
        },
      });
    } else if (candidate.kind === "registry") {
      const activation = await db.activation.findUniqueOrThrow({
        where: { id: p.activationId },
        include: { submission: true },
      });
      if (activation.action === "publish") {
        const snapshot = activation.submission.snapshot as {
          evidence: { id: string; requirementId: string }[];
          requirements: { id: string }[];
        };
        const org = await db.organization.findUniqueOrThrow({
          where: { id: activation.orgId },
        });
        const evidence = await db.evidence.findMany({
          where: {
            orgId: activation.orgId,
            id: { in: snapshot.evidence.map((e) => e.id) },
            deletedAt: null,
          },
        });
        const fictional =
          activation.environment === "sandbox" && sandboxSimulation() && org.fictional;
        if (
          !snapshot.requirements.every((r) =>
            evidence.some(
              (e) =>
                e.requirementId === r.id &&
                e.reviewStatus === "Accepted" &&
                (!e.expiresAt || e.expiresAt > new Date()) &&
                (e.scanStatus === "Clean" ||
                  (fictional && e.scanStatus === "Fixture only")),
            ),
          )
        )
          throw new PortalError(
            "Evidence eligibility changed before publication; review it before retrying",
          );
      }
      // Durable PostgreSQL projection applies ordered revisions before acknowledgment.
      const publicationStarted = performance.now();
      await registry.publish({
        key: candidate.key,
        orgId: candidate.orgId,
        environment: activation.environment,
        sequence: activation.sequence,
        action: activation.action,
        snapshot: activation.submission.snapshot,
      });
      console.info(
        JSON.stringify({
          event: "registry.published",
          environment: activation.environment,
          revision: activation.sequence,
          lagMs: Date.now() - activation.createdAt.getTime(),
          latencyMs: Math.round(performance.now() - publicationStarted),
        }),
      );
      await atomic(async (tx) => {
        const head = await tx.registryHead.findUnique({
          where: {
            orgId_environment: {
              orgId: activation.orgId,
              environment: activation.environment,
            },
          },
        });
        const superseded = !!head && head.sequence > activation.sequence;
        await tx.activation.update({
          where: { id: activation.id },
          data: {
            state: superseded
              ? "Superseded"
              : activation.action === "publish"
                ? "Active"
                : "Suspended",
            acknowledgedAt: new Date(),
          },
        });
        if (activation.action === "publish" && !superseded) {
          const snapshot = activation.submission.snapshot as { draft: Draft };
          for (const c of snapshot.draft.capabilities || [])
            if (c.environment === activation.environment)
              await tx.capability.updateMany({
                where: {
                  orgId: candidate.orgId,
                  capabilityId: c.capabilityId,
                  version: c.version,
                  environment: c.environment,
                },
                data: { status: "Published" },
              });
        }
        await tx.job.update({
          where: { id: candidate.id },
          data: { state: "Succeeded", lockedAt: null, error: null },
        });
        await audit(
          tx,
          candidate.orgId,
          "worker",
          "Registry acknowledged",
          activation.id,
          {
            sequence: activation.sequence,
            environment: activation.environment,
          },
        );
      });
      return true;
    }
    await db.job.update({
      where: { id: candidate.id },
      data: { state: "Succeeded", lockedAt: null, error: null },
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "worker.failed",
        kind: candidate.kind,
        correlationId: candidate.id,
      }),
    );
    const message =
      error instanceof PortalError
        ? error.message
        : "Worker task failed. Retry or inspect the adapter configuration.";
    await atomic(async (tx) => {
      await tx.job.update({
        where: { id: candidate.id },
        data: {
          state:
            (candidate.kind.startsWith("payment-") ||
              candidate.kind.startsWith("partner-") ||
              candidate.kind.startsWith("treasury-")) &&
            candidate.attempts < retryLimit(candidate.kind)
              ? "Pending"
              : "Failed",
          availableAt: new Date(
            Date.now() +
              Math.min(retryCapMs(candidate.kind), 1000 * 2 ** candidate.attempts) +
              Math.floor(Math.random() * 1000),
          ),
          lockedAt: null,
          error: message,
        },
      });
      if (candidate.kind === "registry")
        await tx.notification.create({
          data: {
            orgId: candidate.orgId,
            message: `Registry publication failed: ${message}`,
            href: "/provider/application",
          },
        });
    });
  }
  return true;
}
export async function retentionSweep() {
  await db.availabilityEvaluation.deleteMany({
    where: { retentionUntil: { lt: new Date() } },
  });
  await db.availabilityContext.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400000) } },
  });
  const expired = await db.evidence.findMany({
    where: { deletedAt: null, retentionUntil: { lt: new Date() } },
  });
  for (const evidence of expired)
    await atomic(async (tx) => {
      await tx.evidence.update({
        where: { id: evidence.id },
        data: { deletedAt: new Date() },
      });
      await tx.job.upsert({
        where: { key: `retention:${evidence.id}` },
        create: {
          orgId: evidence.orgId,
          kind: "delete-document",
          key: `retention:${evidence.id}`,
          payload: { objectKey: evidence.objectKey },
        },
        update: {},
      });
      await audit(
        tx,
        evidence.orgId,
        "worker",
        "Evidence retention expired",
        evidence.id,
      );
    });
  const expiring = await db.evidence.findMany({
    where: {
      deletedAt: null,
      expiresAt: { lte: new Date(Date.now() + 30 * 86400000) },
    },
  });
  for (const e of expiring) {
    if (
      !(await db.notification.findFirst({
        where: {
          orgId: e.orgId,
          message: `Evidence ${e.filename} expires ${e.expiresAt!.toISOString().slice(0, 10)}`,
        },
      }))
    )
      await db.notification.create({
        data: {
          orgId: e.orgId,
          message: `Evidence ${e.filename} expires ${e.expiresAt!.toISOString().slice(0, 10)}`,
          href: "/provider/onboarding/compliance",
        },
      });
  }
}
