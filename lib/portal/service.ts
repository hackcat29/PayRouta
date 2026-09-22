import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/lib/generated/prisma/client";
import { db } from "./db";
import {
  assertSubmission,
  validateDraftSection,
  capabilitySchema,
  capabilityKey,
  Draft,
  integrationSchema,
  PortalError,
  roles,
  scenarios,
  transition,
} from "./domain";
import { identity, internal, member, rateLimit, stepUp } from "./access";
import { localMode, mail, secretManager, storage } from "./adapters";
import { validateEndpoint } from "./ssrf";
export const json = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
type Tx = Prisma.TransactionClient;
export async function atomic<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: "Serializable",
        timeout: 15000,
      });
    } catch (error) {
      if (
        ((error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034") ||
          (error instanceof Error &&
            error.name === "DriverAdapterError" &&
            (error as Error & { cause?: { originalCode?: string } }).cause
              ?.originalCode === "40001")) &&
        i < 2
      )
        continue;
      throw error;
    }
  }
  throw new PortalError("Concurrent update; reload and retry", 409);
}
export async function audit(
  tx: Tx,
  orgId: string | null,
  actorId: string,
  action: string,
  target: string,
  metadata: unknown = {},
  internalOnly = false,
) {
  return tx.audit.create({
    data: {
      orgId,
      actorId,
      action,
      target,
      metadata: json(metadata),
      internal: internalOnly,
    },
  });
}
async function notify(
  tx: Tx,
  orgId: string,
  message: string,
  href = "/provider/application",
) {
  return tx.notification.create({ data: { orgId, message, href } });
}
const str = z.string().trim().min(1).max(2000);
const id = z.string().min(1).max(100);
const env = z.enum(["sandbox", "production"]);
export async function command(raw: unknown, h: Headers) {
  const base = z.object({ action: str, orgId: id.optional() }).parse(raw);
  const data = raw as Record<string, unknown>;
  const who = await identity(h);
  await rateLimit(who.user.id, 50);
  if (base.action === "create-organization") {
    const { name } = z.object({ name: str.max(120) }).parse(data);
    return atomic(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name,
          fictional: localMode(),
          memberships: { create: { userId: who.user.id, role: "Owner" } },
          application: { create: {} },
        },
      });
      await audit(tx, org.id, who.user.id, "Organization created", org.id);
      return { orgId: org.id };
    });
  }
  if (base.action === "step-up") {
    const { code } = z
      .object({ code: z.string().regex(/^\d{6}$/) })
      .parse(data);
    await rateLimit(`mfa:${who.user.id}`, 5);
    const { auth } = await import("./auth");
    await auth.api.verifyTOTP({
      headers: h,
      body: { code, trustDevice: false },
    });
    await db.stepUp.upsert({
      where: { sessionId: who.session.id },
      create: {
        sessionId: who.session.id,
        expiresAt: new Date(Date.now() + 15 * 60000),
      },
      update: { expiresAt: new Date(Date.now() + 15 * 60000) },
    });
    await audit(
      db,
      null,
      who.user.id,
      "Sensitive action verification",
      who.session.id,
      {},
      true,
    );
    return { message: "Sensitive actions authorized for 15 minutes" };
  }
  if (base.action === "accept-invitation") {
    const { token } = z
      .object({ token: z.string().min(30).max(100) })
      .parse(data);
    return atomic(async (tx) => {
      const invite = await tx.invitation.findUnique({
        where: { tokenHash: createHash("sha256").update(token).digest("hex") },
      });
      if (
        !invite ||
        invite.acceptedAt ||
        invite.expiresAt < new Date() ||
        invite.email !== who.user.email.toLowerCase()
      )
        throw new PortalError(
          "Invitation expired, already used, or belongs to another email",
          403,
        );
      const existingMembership = await tx.membership.findUnique({
        where: { orgId_userId: { orgId: invite.orgId, userId: who.user.id } },
      });
      await tx.membership.upsert({
        where: { orgId_userId: { orgId: invite.orgId, userId: who.user.id } },
        create: {
          orgId: invite.orgId,
          userId: who.user.id,
          role: invite.participation === "merchant" ? "None" : invite.role,
          merchantRole:
            invite.participation === "merchant" ? invite.role : null,
        },
        update:
          invite.participation === "merchant"
            ? existingMembership?.merchantRole
              ? {}
              : { merchantRole: invite.role }
            : existingMembership?.role === "None"
              ? { role: invite.role }
              : {},
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });
      await audit(
        tx,
        invite.orgId,
        who.user.id,
        "Invitation accepted",
        invite.id,
      );
      return { orgId: invite.orgId };
    });
  }
  if (
    [
      "ops-availability-context",
      "ops-availability-explain",
      "ops-registry-reconcile",
      "ops-observation",
      "ops-republish-approved",
      "ops-registry-query",
    ].includes(base.action)
  ) {
    await internal(true, h);
    const targetOrg = id.parse(base.orgId);
    if (base.action === "ops-registry-query") {
      const { queryPublishedCandidates } = await import("./registry");
      const query = z
        .object({
          environment: env,
          method: id.optional(),
          operation: id.optional(),
          integrationId: id.optional(),
          inputAsset: id.optional(),
          inputNetwork: z.string().max(100).optional(),
          origin: z.string().length(2).optional(),
          destination: z.string().length(2).optional(),
          cursor: z.string().max(300).optional(),
          current: z.boolean().optional(),
          limit: z.number().int().min(1).max(100).optional(),
        })
        .strict()
        .parse(data.query);
      return queryPublishedCandidates({ ...query, orgId: targetOrg });
    }
    if (base.action === "ops-republish-approved") {
      const { republishApproved } = await import("./registry");
      return republishApproved(
        targetOrg,
        id.parse(data.submissionId),
        who.user.id,
        str.parse(data.reason),
      );
    }
    if (base.action === "ops-registry-reconcile") {
      const { reconcileRegistry } = await import("./registry");
      return reconcileRegistry(
        100,
        data.cursor === undefined ? undefined : id.parse(data.cursor),
      );
    }
    if (base.action === "ops-observation") {
      const { ingestObservation } = await import("./observations");
      const result = await ingestObservation(targetOrg, data.value, "operator");
      await audit(
        db,
        targetOrg,
        who.user.id,
        "Operator observation",
        result.id,
        {},
        true,
      );
      return result;
    }
    const { createTrustedContext, explainEvaluation } =
      await import("./availability-service");
    return base.action === "ops-availability-context"
      ? createTrustedContext(targetOrg, data.value, who.user.id)
      : explainEvaluation(targetOrg, id.parse(data.evaluationId), true);
  }
  if (base.action.startsWith("ops-")) return opsCommand(data, h);
  const orgId = id.parse(base.orgId);
  if (
    ["evaluate-availability", "availability-explanation"].includes(base.action)
  ) {
    await member(orgId, "read", h);
    const { evaluateContext, explainEvaluation } =
      await import("./availability-service");
    return base.action === "evaluate-availability"
      ? evaluateContext(orgId, id.parse(data.contextId))
      : explainEvaluation(orgId, id.parse(data.evaluationId));
  }
  if (base.action === "fixture-evidence") {
    await member(orgId, "compliance", h);
    const org = await db.organization.findUniqueOrThrow({
      where: { id: orgId },
    });
    if (!localMode() || !org.fictional)
      throw new PortalError("Fictional evidence is local-only", 403);
    const requirementId = id.parse(data.requirementId);
    const requirement = await db.requirement.findUnique({
      where: { id: requirementId },
    });
    if (!requirement?.illustrative)
      throw new PortalError(
        "Only illustrative requirements accept fixture evidence",
      );
    const objectKey = randomUUID();
    const bytes = Buffer.from(
      "%PDF-1.4\nFICTIONAL DEVELOPMENT FIXTURE ONLY\n%%EOF",
    );
    await storage.put(objectKey, bytes, "application/pdf");
    await atomic(async (tx) => {
      const e = await tx.evidence.create({
        data: {
          orgId,
          requirementId,
          objectKey,
          filename: "fictional-review-fixture.pdf",
          mime: "application/pdf",
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          metadata: { documentType: "Fictional fixture", jurisdiction: "NG" },
          scanStatus: "Fixture only",
          reviewStatus: "Pending review",
          expiresAt: new Date(Date.now() + 180 * 86400000),
          retentionUntil: new Date(Date.now() + 90 * 86400000),
        },
      });
      await audit(tx, orgId, who.user.id, "Fictional evidence attached", e.id);
    });
    return {
      message:
        "Fictional evidence added for sandbox review only. It cannot satisfy production gates.",
    };
  }
  if (base.action === "save-section") {
    const body = z
      .object({
        section: z.enum(["company", "coverage", "settlement", "integration"]),
        version: z.number().int().positive(),
        value: z.record(z.string(), z.unknown()),
        environment: env.default("sandbox"),
      })
      .parse(data);
    await member(
      orgId,
      body.section === "company"
        ? "company"
        : body.section === "integration"
          ? "integration"
          : "configure",
      h,
    );
    body.value = validateDraftSection(body.section, body.value);
    if (body.section === "integration") {
      const parsed = integrationSchema.parse(body.value);
      if (
        parsed.adapter === "provider" ||
        parsed.mode === "STANDARD" ||
        parsed.mode === "CONFIGURABLE"
      )
        await validateEndpoint(parsed.baseUrl);
      if (body.environment === "production" && parsed.adapter === "simulator")
        throw new PortalError("Simulator cannot be configured for production");
      body.value = parsed;
    }
    return atomic(async (tx) => {
      const app = await tx.application.findUniqueOrThrow({ where: { orgId } });
      if (app.version !== body.version)
        throw new PortalError(
          "Another member saved changes. Reload before saving.",
          409,
        );
      const draft = app.draft as Draft;
      const value = { ...draft, [body.section]: body.value };
      await tx.application.update({
        where: { id: app.id, version: body.version },
        data: { draft: json(value), version: { increment: 1 } },
      });
      if (body.section === "settlement")
        await tx.settlementConfig.create({
          data: {
            orgId,
            version: app.version + 1,
            definition: json(body.value),
          },
        });
      if (body.section === "integration") {
        const prev = await tx.integration.findFirst({
          where: { orgId, environment: body.environment },
          orderBy: { version: "desc" },
        });
        await tx.integration.create({
          data: {
            orgId,
            environment: body.environment,
            version: (prev?.version || 0) + 1,
            config: json(body.value),
          },
        });
      }
      await audit(tx, orgId, who.user.id, `Saved ${body.section}`, app.id, {
        version: app.version + 1,
      });
      return { version: app.version + 1, message: "Draft saved" };
    });
  }
  if (
    base.action === "save-capability" ||
    base.action === "remove-capability"
  ) {
    await member(orgId, "configure", h);
    const version = z.number().int().parse(data.version);
    return atomic(async (tx) => {
      const app = await tx.application.findUniqueOrThrow({ where: { orgId } });
      if (app.version !== version)
        throw new PortalError("Draft changed. Reload before saving.", 409);
      const draft = app.draft as Draft;
      let caps = draft.capabilities || [];
      if (base.action === "remove-capability")
        caps = caps.filter(
          (c) =>
            c.capabilityId !== id.parse(data.capabilityId) ||
            c.environment !== env.default("sandbox").parse(data.environment),
        );
      else {
        const cap = capabilitySchema.parse(data.value);
        const existing = caps.find(
          (c) =>
            c.capabilityId === cap.capabilityId &&
            c.environment === cap.environment,
        );
        const stored = await tx.capability.findFirst({
          where: {
            orgId,
            capabilityId: cap.capabilityId,
            environment: cap.environment,
          },
          orderBy: { version: "desc" },
        });
        cap.version =
          Math.max(existing?.version || 0, stored?.version || 0) + 1;
        const others = caps.filter(
          (c) =>
            c.capabilityId !== cap.capabilityId ||
            c.environment !== cap.environment,
        );
        if (others.some((c) => capabilityKey(c) === capabilityKey(cap)))
          throw new PortalError(
            "A capability already defines these conditions",
          );
        caps = [...others, cap];
        await tx.capability.create({
          data: {
            orgId,
            capabilityId: cap.capabilityId,
            version: cap.version,
            environment: cap.environment,
            definition: json(cap),
          },
        });
      }
      await tx.application.update({
        where: { id: app.id, version },
        data: {
          draft: json({ ...draft, capabilities: caps }),
          version: { increment: 1 },
        },
      });
      await audit(tx, orgId, who.user.id, "Capability proposal saved", app.id, {
        version: version + 1,
      });
      return {
        message:
          "Proposed capability saved. Published capabilities remain unchanged.",
      };
    });
  }
  if (base.action === "submit") {
    await member(orgId, "submit", h);
    const { version, key } = z
      .object({ version: z.number().int(), key: z.string().uuid() })
      .parse(data);
    return atomic(async (tx) => {
      const app = await tx.application.findUniqueOrThrow({ where: { orgId } });
      const duplicate = await tx.submission.findUnique({
        where: {
          applicationId_idempotencyKey: {
            applicationId: app.id,
            idempotencyKey: key,
          },
        },
      });
      if (duplicate) return { submissionId: duplicate.id };
      if (app.version !== version)
        throw new PortalError("Draft changed. Reload before submitting.", 409);
      const evidence = await tx.evidence.findMany({
        where: { orgId, deletedAt: null },
      });
      const requirements = await matchedRequirements(tx, app.draft as Draft);
      const covered = requirements.every((r) =>
        evidence.some((e) => e.requirementId === r.id),
      );
      assertSubmission(
        app.draft as Draft,
        requirements.length === 0
          ? 1
          : covered && evidence.length
            ? evidence.length
            : 0,
      );
      const state =
        app.state === "Changes requested" ? "Resubmitted" : "Submitted";
      transition(app.state, state);
      const integrations = await tx.integration.findMany({
        where: { orgId },
        orderBy: { version: "desc" },
      });
      const submission = await tx.submission.create({
        data: {
          applicationId: app.id,
          version: app.version,
          idempotencyKey: key,
          snapshot: json({
            draft: app.draft,
            requirements,
            evidence: evidence.map((e) => ({
              id: e.id,
              requirementId: e.requirementId,
              sha256: e.sha256,
              metadata: e.metadata,
              expiresAt: e.expiresAt,
            })),
            integrations,
          }),
        },
      });
      for (const capability of (app.draft as Draft).capabilities || [])
        await tx.capability.updateMany({
          where: {
            orgId,
            capabilityId: capability.capabilityId,
            version: capability.version,
            environment: capability.environment,
            status: "Draft",
          },
          data: { status: "In review" },
        });
      await tx.application.update({
        where: { id: app.id },
        data: { state, version: { increment: 1 } },
      });
      await audit(tx, orgId, who.user.id, state, submission.id, {
        submittedVersion: app.version,
      });
      return {
        submissionId: submission.id,
        message: "Immutable application submitted",
      };
    });
  }
  if (base.action === "respond") {
    await member(orgId, "compliance", h);
    const { changeId, response } = z
      .object({ changeId: id, response: str })
      .parse(data);
    return atomic(async (tx) => {
      const change = await tx.changeRequest.findFirst({
        where: { id: changeId, submission: { application: { orgId } } },
      });
      if (!change) throw new PortalError("Change request not found", 404);
      if (change.response)
        throw new PortalError("Response already recorded", 409);
      await tx.changeRequest.update({
        where: { id: changeId },
        data: { response, respondedAt: new Date() },
      });
      await audit(
        tx,
        orgId,
        who.user.id,
        "Change response recorded",
        changeId,
        { response },
      );
      return {
        message: "Response recorded. Save any draft edits and resubmit.",
      };
    });
  }
  if (base.action === "sandbox-run") {
    await member(orgId, "integration", h);
    const { scenario, key } = z
      .object({ scenario: z.enum(scenarios), key: z.string().uuid() })
      .parse(data);
    return atomic(async (tx) => {
      const existing = await tx.sandboxRun.findUnique({
        where: { orgId_idempotencyKey: { orgId, idempotencyKey: key } },
      });
      if (existing) return { runId: existing.id };
      const config = await tx.integration.findFirst({
        where: { orgId, environment: "sandbox" },
        orderBy: { version: "desc" },
      });
      if (!config) throw new PortalError("Save a sandbox integration first");
      if ((config.config as { adapter: string }).adapter !== "simulator")
        throw new PortalError(
          "This scenario requires the local simulator. Use endpoint health check for a configured provider.",
        );
      const run = await tx.sandboxRun.create({
        data: {
          orgId,
          adapter: "simulator",
          integrationVersion: config.version,
          scenario,
          outcome: "Queued",
          idempotencyKey: key,
          steps: [],
        },
      });
      await tx.job.create({
        data: {
          orgId,
          kind: "sandbox",
          key: `run:${run.id}`,
          payload: { runId: run.id },
        },
      });
      await audit(tx, orgId, who.user.id, "Sandbox run queued", run.id);
      return { runId: run.id, message: "Run queued. Refresh for results." };
    });
  }
  if (base.action === "check-endpoint") {
    await member(orgId, "integration", h);
    const environment = env.parse(data.environment);
    const config = await db.integration.findFirst({
      where: { orgId, environment },
      orderBy: { version: "desc" },
    });
    if (
      !config ||
      !["provider", "standard", "configurable"].includes(
        (config.config as { adapter: string }).adapter,
      )
    )
      throw new PortalError("Configure a provider endpoint first");
    const key = z.string().uuid().parse(data.key);
    await db.job.upsert({
      where: { key: `check:${orgId}:${key}` },
      create: {
        orgId,
        kind: "endpoint",
        key: `check:${orgId}:${key}`,
        payload: { integrationId: config.id, environment },
      },
      update: {},
    });
    return {
      message:
        "Constrained endpoint check queued; this is not production readiness approval",
    };
  }
  if (base.action === "save-credential") {
    await member(orgId, "integration", h);
    await stepUp(h);
    await rateLimit(`secret:${who.user.id}`, 5);
    const body = z
      .object({
        environment: env,
        kind: z.enum(["outbound", "inbound", "event"]),
        label: str.max(80),
        value: z.string().min(12).max(4096).optional(),
        replaceId: id.optional(),
      })
      .parse(data);
    if (body.environment === "production")
      throw new PortalError(
        "Managed production secret service is not configured",
        503,
      );
    const value =
      body.kind === "inbound"
        ? `pr_sbx_${randomBytes(32).toString("base64url")}`
        : body.value;
    if (!value) throw new PortalError("Provide the external secret");
    const ref =
      body.kind === "inbound" ? undefined : await secretManager.put(value);
    try {
      const result = await atomic(async (tx) => {
        if (body.replaceId) {
          const old = await tx.credential.findFirst({
            where: {
              id: body.replaceId,
              orgId,
              environment: body.environment,
              kind: body.kind,
              revokedAt: null,
            },
          });
          if (!old) throw new PortalError("Credential not found", 404);
          await tx.credential.update({
            where: { id: old.id },
            data: { revokedAt: new Date() },
          });
        }
        const credential = await tx.credential.create({
          data: {
            orgId,
            environment: body.environment,
            kind: body.kind,
            label: body.label,
            backend: "local-encrypted",
            secretRef: ref,
            verifier:
              body.kind === "inbound"
                ? createHash("sha256").update(value).digest("hex")
                : undefined,
          },
        });
        await audit(
          tx,
          orgId,
          who.user.id,
          body.replaceId ? "Credential rotated" : "Credential created",
          credential.id,
          { kind: body.kind },
        );
        return { id: credential.id };
      });
      return {
        ...result,
        oneTimeSecret: body.kind === "inbound" ? value : undefined,
        message: "Credential saved; external secrets cannot be read back",
      };
    } catch (e) {
      if (ref) await secretManager.revoke(ref);
      throw e;
    }
  }
  if (base.action === "revoke-credential") {
    await member(orgId, "integration", h);
    await stepUp(h);
    const credentialId = id.parse(data.credentialId);
    await atomic(async (tx) => {
      const credential = await tx.credential.findFirst({
        where: { id: credentialId, orgId },
      });
      if (!credential) throw new PortalError("Credential not found", 404);
      await tx.credential.update({
        where: { id: credential.id },
        data: { revokedAt: new Date() },
      });
      await audit(tx, orgId, who.user.id, "Credential revoked", credential.id);
    });
    return { message: "Credential revoked" };
  }
  if (base.action === "invite") {
    await member(orgId, "team", h);
    await stepUp(h);
    await rateLimit(`invite:${who.user.id}`, 5);
    const { email, role } = z
      .object({
        email: z.email().transform((s) => s.toLowerCase()),
        role: z.enum(roles),
      })
      .parse(data);
    if (role === "Owner") await member(orgId, "ownership", h);
    const token = randomBytes(32).toString("base64url");
    const invitation = await db.invitation.create({
      data: {
        orgId,
        email,
        role,
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: new Date(Date.now() + 48 * 3600000),
      },
    });
    await audit(db, orgId, who.user.id, "Invitation created", invitation.id, {
      role,
    });
    const delivery = await mail.send(
      email,
      "Join your PayRouta organization",
      `${process.env.BETTER_AUTH_URL}/provider/team?invitation=${token}`,
    );
    return {
      message:
        delivery === "captured"
          ? "Invitation captured in local mail. No email sent."
          : "Invitation delivered",
    };
  }
  if (base.action === "member-role" || base.action === "member-remove") {
    await member(orgId, "team", h);
    await stepUp(h);
    const target = id.parse(data.memberId);
    const role =
      base.action === "member-role" ? z.enum(roles).parse(data.role) : null;
    return atomic(async (tx) => {
      const m = await tx.membership.findFirst({ where: { id: target, orgId } });
      if (!m) throw new PortalError("Member not found", 404);
      if (m.role === "Owner" || role === "Owner")
        await member(orgId, "ownership", h);
      if (
        m.role === "Owner" &&
        role !== "Owner" &&
        (await tx.membership.count({ where: { orgId, role: "Owner" } })) <= 1
      )
        throw new PortalError(
          "Add another owner before removing or changing the last owner",
        );
      if (role)
        await tx.membership.update({ where: { id: m.id }, data: { role } });
      else if (m.merchantRole)
        await tx.membership.update({
          where: { id: m.id },
          data: { role: "None" },
        });
      else await tx.membership.delete({ where: { id: m.id } });
      await audit(
        tx,
        orgId,
        who.user.id,
        role ? "Member role changed" : "Member removed",
        m.id,
        { role },
      );
      return { message: "Membership updated" };
    });
  }
  if (base.action === "availability") {
    await member(orgId, "configure", h);
    const body = z
      .object({
        environment: env,
        capabilityId: id,
        status: z.enum([
          "Available",
          "Degraded",
          "Unavailable",
          "Maintenance",
          "Unknown",
        ]),
        minutes: z.number().int().min(5).max(1440),
      })
      .parse(data);
    const capability = await db.capability.findFirst({
      where: {
        orgId,
        capabilityId: body.capabilityId,
        environment: body.environment,
      },
    });
    if (!capability) throw new PortalError("Capability not found", 404);
    await atomic(async (tx) => {
      const profiles = await tx.publishedProfile.findMany({
        where: {
          orgId,
          environment: body.environment,
          capabilityId: body.capabilityId,
          current: true,
        },
        take: 100,
      });
      if (profiles.length) {
        const { applyObservation } = await import("./observations");
        for (const p of profiles) {
          const now = new Date();
          const prior = await tx.availability.findFirst({
            where: {
              integrationId: p.integrationId,
              capabilityId: p.capabilityId,
              capabilityVersion: p.capabilityVersion,
              environment: body.environment,
              trust: "authenticated-provider",
              observationType: "availability",
            },
            orderBy: { sequence: "desc" },
          });
          await applyObservation(
            tx,
            orgId,
            {
              integrationId: p.integrationId,
              capabilityId: p.capabilityId,
              capabilityVersion: p.capabilityVersion,
              environment: body.environment,
              type: "availability",
              eventId: randomUUID(),
              sequence: (prior?.sequence || 0) + 1,
              observedAt: now.toISOString(),
              expiresAt: new Date(
                now.getTime() + body.minutes * 60000,
              ).toISOString(),
              status: body.status,
            },
            "authenticated-provider",
            now,
          );
        }
      } else {
        await tx.availability.create({
          data: {
            orgId,
            environment: body.environment,
            capabilityId: body.capabilityId,
            status: body.status,
            source: "Provider reported",
            expiresAt: new Date(Date.now() + body.minutes * 60000),
          },
        });
      }
      await audit(
        tx,
        orgId,
        who.user.id,
        "Availability reported",
        body.capabilityId,
        { status: body.status, environment: body.environment },
      );
    });
    return {
      message:
        "Report saved. Effective eligibility still requires published approval and health checks.",
    };
  }
  if (base.action === "replay-event") {
    await member(orgId, "integration", h);
    const event = await db.integrationEvent.findFirst({
      where: { id: id.parse(data.eventId), orgId, environment: "sandbox" },
    });
    if (!event)
      throw new PortalError("Only sandbox events may be replayed", 403);
    await atomic(async (tx) => {
      await tx.integrationEvent.create({
        data: {
          orgId,
          environment: "sandbox",
          eventId: randomUUID(),
          type: "Simulator replay",
          state: "Processed",
          summary: `Safe replay of ${event.eventId}; no external request or payment`,
        },
      });
      await audit(tx, orgId, who.user.id, "Sandbox event replayed", event.id);
    });
    return { message: "Sandbox replay recorded" };
  }
  if (base.action === "retry-job") {
    await member(orgId, "integration", h);
    const job = await db.job.findFirst({
      where: {
        id: id.parse(data.jobId),
        orgId,
        state: "Failed",
        kind: { in: ["sandbox", "endpoint", "scan"] },
      },
    });
    if (!job) throw new PortalError("Retryable job not found", 404);
    await db.job.update({
      where: { id: job.id },
      data: { state: "Pending", availableAt: new Date(), error: null },
    });
    return { message: "Retry queued" };
  }
  throw new PortalError("Unknown action", 404);
}
export async function matchedRequirements(tx: Tx, draft: Draft) {
  const requirements = await tx.requirement.findMany({
    where: { active: true },
    orderBy: { version: "desc" },
  });
  return requirements.filter((r) => {
    const scope = r.scope as {
      audience?: string;
      providerTypes?: string[];
      countries?: string[];
      methods?: string[];
      operations?: string[];
    };
    return (
      scope.audience !== "merchant" &&
      (!scope.providerTypes?.length ||
        scope.providerTypes.includes(draft.company?.providerType || "")) &&
      (!scope.countries?.length ||
        scope.countries.includes(draft.company?.country || "")) &&
      (!scope.methods?.length ||
        draft.capabilities?.some((c) => scope.methods!.includes(c.family))) &&
      (!scope.operations?.length ||
        draft.capabilities?.some((c) =>
          scope.operations!.includes(c.operation),
        ))
    );
  });
}
async function opsCommand(data: Record<string, unknown>, h: Headers) {
  const action = String(data.action);
  const actor = await internal(
    [
      "ops-activate",
      "ops-suspend",
      "ops-retry-publication",
      "ops-requirement",
    ].includes(action),
    h,
  );
  if (action === "ops-requirement") {
    const body = z
      .object({
        templateId: id,
        name: str,
        scope: z.object({
          audience: z.enum(["provider","merchant"]).default("provider"),
          providerTypes: z.array(
            z.enum([
              "PSP",
              "Bank",
              "Card acquirer",
              "Mobile money operator",
              "Mobile money aggregator",
              "Stablecoin ramp",
              "Exchange",
              "Payout provider",
              "Other infrastructure",
            ]),
          ),
          countries: z.array(z.string().length(2)),
          methods: z.array(str),
          operations: z.array(str),
        }),
      })
      .parse(data);
    return atomic(async (tx) => {
      const previous = await tx.requirement.findFirst({
        where: { templateId: body.templateId },
        orderBy: { version: "desc" },
      });
      await tx.requirement.updateMany({
        where: { templateId: body.templateId },
        data: { active: false },
      });
      const r = await tx.requirement.create({
        data: {
          ...body,
          scope: json(body.scope),
          version: (previous?.version || 0) + 1,
          illustrative: localMode(),
        },
      });
      await audit(
        tx,
        null,
        actor.user.id,
        "Requirement version created",
        r.id,
        {},
        true,
      );
      return {
        message:
          "New requirement version created. Existing submissions retain their version.",
      };
    });
  }
  if (action === "ops-evidence") {
    const body = z
      .object({
        evidenceId: id,
        decision: z.enum(["Accepted", "Changes requested", "Rejected"]),
        reason: str,
      })
      .parse(data);
    return atomic(async (tx) => {
      const evidence = await tx.evidence.findUniqueOrThrow({
        where: { id: body.evidenceId },
        include: { org: true },
      });
      if (
        evidence.scanStatus !== "Clean" &&
        !(
          localMode() &&
          evidence.org.fictional &&
          evidence.scanStatus === "Fixture only"
        )
      )
        throw new PortalError(
          "Evidence remains quarantined until a scanner clears it",
        );
      if (
        evidence.deletedAt ||
        (evidence.expiresAt && evidence.expiresAt < new Date())
      )
        throw new PortalError("Evidence deleted or expired");
      await tx.evidence.update({
        where: { id: evidence.id },
        data: { reviewStatus: body.decision },
      });
      await audit(
        tx,
        evidence.orgId,
        actor.user.id,
        "Evidence reviewed",
        evidence.id,
        { decision: body.decision, reason: body.reason },
      );
      return { message: "Evidence decision recorded" };
    });
  }
  if (action === "ops-retry-publication") {
    const job = await db.job.findFirst({
      where: { id: id.parse(data.jobId), kind: "registry", state: "Failed" },
    });
    if (!job) throw new PortalError("Failed publication not found", 404);
    await db.job.update({
      where: { id: job.id },
      data: { state: "Pending", availableAt: new Date(), error: null },
    });
    await audit(
      db,
      job.orgId,
      actor.user.id,
      "Publication retry queued",
      job.id,
      {},
      true,
    );
    return { message: "Idempotent publication retry queued" };
  }
  const applicationId = id.parse(data.applicationId);
  return atomic(async (tx) => {
    const app = await tx.application.findUniqueOrThrow({
      where: { id: applicationId },
      include: {
        org: true,
        submissions: {
          orderBy: { version: "desc" },
          take: 1,
          include: { reviews: true },
        },
      },
    });
    const sub = app.submissions[0];
    if (!sub) throw new PortalError("No submitted version");
    if (action === "ops-review") {
      const body = z
        .object({
          kind: z.enum([
            "legal",
            "technical",
            "application",
            "note",
            "changes",
          ]),
          decision: z.enum([
            "Under review",
            "Passed",
            "Approved",
            "Rejected",
            "Changes requested",
            "Note",
          ]),
          reason: str,
          section: z.string().max(80).optional(),
          internalNote: z.string().max(4000).default(""),
        })
        .parse(data);
      if (body.kind === "changes") {
        if (body.decision !== "Changes requested")
          throw new PortalError("Choose Changes requested");
        transition(app.state, "Changes requested");
        await tx.changeRequest.create({
          data: {
            submissionId: sub.id,
            section: body.section || "company",
            message: body.reason,
          },
        });
        await tx.application.update({
          where: { id: app.id },
          data: { state: "Changes requested" },
        });
        await notify(tx, app.orgId, `Changes requested: ${body.reason}`);
      } else if (body.kind === "application") {
        if (!["Under review", "Approved", "Rejected"].includes(body.decision))
          throw new PortalError("Invalid application decision");
        transition(app.state, body.decision);
        if (body.decision === "Approved") {
          for (const kind of ["legal", "technical"]) {
            const latest = sub.reviews
              .filter((r) => r.kind === kind)
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
            if (latest?.decision !== "Passed")
              throw new PortalError(`Complete ${kind} review first`);
          }
        }
        if (["Approved", "Rejected"].includes(body.decision)) {
          const submitted = (sub.snapshot as { draft: Draft }).draft;
          for (const capability of submitted.capabilities || [])
            await tx.capability.updateMany({
              where: {
                orgId: app.orgId,
                capabilityId: capability.capabilityId,
                version: capability.version,
                environment: capability.environment,
                status: { not: "Published" },
              },
              data: { status: body.decision },
            });
        }
        await tx.application.update({
          where: { id: app.id },
          data: { state: body.decision },
        });
        await notify(
          tx,
          app.orgId,
          `Application ${body.decision.toLowerCase()}`,
        );
      } else if (
        body.kind !== "note" &&
        (app.state !== "Under review" || body.decision !== "Passed")
      )
        throw new PortalError("Start review before recording a review pass");
      await tx.review.create({
        data: {
          submissionId: sub.id,
          actorId: actor.user.id,
          kind: body.kind,
          decision: body.decision,
          reason: body.reason,
          internalNote: body.internalNote,
        },
      });
      await audit(
        tx,
        app.orgId,
        actor.user.id,
        "Review decision",
        sub.id,
        {
          kind: body.kind,
          decision: body.decision,
          ...(body.kind === "note" ? {} : { reason: body.reason }),
        },
        body.kind === "note",
      );
      return { message: "Review recorded" };
    }
    if (action === "ops-activate" || action === "ops-suspend") {
      const { environment, reason } = z
        .object({ environment: env, reason: str })
        .parse(data);
      const activating = action === "ops-activate";
      const gates = await readiness(tx, app.orgId, environment);
      if (activating && gates.length)
        throw new PortalError(`Activation blocked: ${gates.join("; ")}`);
      const previous = await tx.activation.findFirst({
        where: { orgId: app.orgId, environment },
        orderBy: { sequence: "desc" },
      });
      if (
        (activating && previous?.state === "Pending") ||
        (activating &&
          previous?.state === "Active" &&
          previous.submissionId === sub.id)
      )
        throw new PortalError(
          "This publication is already pending or active",
          409,
        );
      if (!activating && !previous)
        throw new PortalError("No active or pending configuration to suspend");
      const record = await tx.activation.create({
        data: {
          orgId: app.orgId,
          submissionId: sub.id,
          environment,
          state: "Pending",
          action: activating ? "publish" : "withdraw",
          reason,
          actorId: actor.user.id,
          sequence: (previous?.sequence || 0) + 1,
        },
      });
      await tx.job.create({
        data: {
          orgId: app.orgId,
          kind: "registry",
          key: `registry:${record.id}`,
          payload: { activationId: record.id },
        },
      });
      await audit(
        tx,
        app.orgId,
        actor.user.id,
        activating ? "Activation requested" : "Suspension requested",
        record.id,
        { environment, reason },
      );
      return {
        message:
          "Registry propagation pending. Status changes after acknowledgement.",
      };
    }
    throw new PortalError("Unknown internal action");
  });
}
export async function readiness(tx: Tx, orgId: string, environment: string) {
  const app = await tx.application.findUniqueOrThrow({
    where: { orgId },
    include: {
      org: true,
      submissions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { reviews: true },
      },
    },
  });
  const sub = app.submissions[0];
  const gates: string[] = [];
  if (app.state !== "Approved" || !sub)
    gates.push("Approved submitted version");
  if (!sub) return gates;
  for (const kind of ["legal", "technical"]) {
    const decision = sub.reviews
      .filter((r) => r.kind === kind)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (decision?.decision !== "Passed") gates.push(`${kind} review`);
  }
  const snapshot = sub.snapshot as {
    draft: Draft;
    evidence: { id: string; requirementId: string }[];
    requirements: { id: string }[];
    integrations: {
      environment: string;
      version: number;
      config: { adapter: string };
    }[];
  };
  const evidence = await tx.evidence.findMany({
    where: {
      orgId,
      id: { in: snapshot.evidence.map((e) => e.id) },
      deletedAt: null,
    },
  });
  const local = environment === "sandbox" && localMode() && app.org.fictional;
  for (const r of snapshot.requirements) {
    if (
      !evidence.some(
        (e) =>
          e.requirementId === r.id &&
          e.reviewStatus === "Accepted" &&
          (!e.expiresAt || e.expiresAt > new Date()) &&
          (e.scanStatus === "Clean" ||
            (local && e.scanStatus === "Fixture only")),
      )
    )
      gates.push("Valid accepted evidence for every submitted requirement");
  }
  const integration = snapshot.integrations.find(
    (i) => i.environment === environment,
  );
  if (!integration) gates.push(`Submitted ${environment} integration`);
  else {
    try {
      const { assertAdapterConfiguration } =
        await import("./provider-adapters");
      assertAdapterConfiguration(
        integration.config.adapter,
        "1",
        environment,
        integration.config,
      );
    } catch {
      gates.push("Compatible registered provider adapter");
    }
  }
  for (const c of snapshot.draft.capabilities || []) {
    if (c.environment !== environment || !c.fulfillment) continue;
    if (
      !snapshot.integrations.some(
        (i) =>
          (i as { id?: string }).id === c.fulfillment!.integrationId &&
          i.environment === environment,
      )
    )
      gates.push("Fulfillment integration must belong to approved submission");
  }
  if (!snapshot.draft.capabilities?.some((c) => c.environment === environment))
    gates.push(`Approved ${environment} capability`);
  if (environment === "sandbox") {
    if (!local)
      gates.push(
        "Sandbox registry simulation requires a fictional development organization",
      );
    const run = await tx.sandboxRun.findFirst({
      where: {
        orgId,
        adapter: "simulator",
        integrationVersion: integration?.version || -1,
        outcome: "Passed",
      },
    });
    if (!run) gates.push("Simulator run for submitted integration version");
  } else {
    gates.push(
      "Production provider test adapter unconfigured",
      "Managed production secrets unconfigured",
      "Production malware scanner unconfigured",
    );
    if (!process.env.S3_BUCKET)
      gates.push("Production private object storage unconfigured");
  }
  return [...new Set(gates)];
}
