import { db } from "./db";
import { identity, internal, member } from "./access";
import { can, Draft, PortalError, effectiveEligibility } from "./domain";
import { matchedRequirements, readiness } from "./service";
import { localMode } from "./adapters";
export async function workspaceData(
  orgId: string | undefined,
  environment: string,
  q = "",
  page = 1,
) {
  const session = await identity();
  const memberships = await db.membership.findMany({
    where: { userId: session.user.id },
    include: { org: { include: { application: true } } },
    orderBy: { org: { name: "asc" } },
  });
  const providerOrg = memberships.find((m) => m.org.application)?.orgId;
  const selected = orgId || providerOrg || memberships[0]?.orgId;
  const me = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    twoFactorEnabled: session.user.twoFactorEnabled,
  };
  const operator = await db.user.findUnique({
    where: { id: session.user.id },
    select: { internalRole: true },
  });
  if (!selected)
    return {
      me,
      memberships,
      org: null,
      local: localMode(),
      internalRole: operator?.internalRole,
    };
  const { membership } = await member(selected);
  const accessEvidence = can(membership.role, "compliance");
  const accessIntegration = can(membership.role, "integration");
  const filter = { orgId: selected, environment };
  const where = {
    ...filter,
    ...(q ? { reference: { contains: q, mode: "insensitive" as const } } : {}),
  };
  const [
    application,
    evidence,
    integrations,
    credentials,
    runs,
    activations,
    jobs,
    availability,
    transactions,
    total,
    settlements,
    events,
    audit,
    notifications,
    team,
    invitations,
    metrics,
    capabilities,
  ] = await Promise.all([
    db.application
      .findUnique({
        where: { orgId: selected },
        include: {
          submissions: {
            orderBy: { version: "desc" },
            include: {
              changes: true,
              reviews: {
                where: { kind: { not: "note" } },
                select: {
                  id: true,
                  kind: true,
                  decision: true,
                  reason: true,
                  createdAt: true,
                },
              },
            },
          },
        },
      })
      .then(async (app) => {
        if (app) return app;
        return db.application.upsert({
          where: { orgId: selected },
          create: { orgId: selected },
          update: {},
          include: {
            submissions: {
              orderBy: { version: "desc" },
              include: {
                changes: true,
                reviews: {
                  where: { kind: { not: "note" } },
                  select: {
                    id: true,
                    kind: true,
                    decision: true,
                    reason: true,
                    createdAt: true,
                  },
                },
              },
            },
          },
        });
      }),
    accessEvidence
      ? db.evidence.findMany({
          where: { orgId: selected, deletedAt: null },
          select: {
            id: true,
            requirementId: true,
            filename: true,
            mime: true,
            size: true,
            metadata: true,
            scanStatus: true,
            reviewStatus: true,
            expiresAt: true,
            retentionUntil: true,
            createdAt: true,
          },
        })
      : [],
    accessIntegration
      ? db.integration.findMany({ where: filter, orderBy: { version: "desc" } })
      : [],
    accessIntegration
      ? db.credential.findMany({
          where: filter,
          select: {
            id: true,
            kind: true,
            label: true,
            backend: true,
            createdAt: true,
            revokedAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : [],
    db.sandboxRun.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.activation.findMany({ where: filter, orderBy: { sequence: "desc" } }),
    db.job.findMany({
      where: { orgId: selected },
      select: {
        id: true,
        kind: true,
        state: true,
        attempts: true,
        error: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    db.availability.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.transaction.findMany({
      where,
      include: { settlements: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 15,
      take: 15,
    }),
    db.transaction.count({ where }),
    db.settlement.findMany({
      where: filter,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    accessIntegration
      ? db.integrationEvent.findMany({
          where: filter,
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : [],
    db.audit.findMany({
      where: { orgId: selected, internal: false },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.notification.findMany({
      where: { orgId: selected },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.membership.findMany({
      where: { orgId: selected },
      include: { user: { select: { name: true, email: true } } },
    }),
    can(membership.role, "team")
      ? db.invitation.findMany({
          where: { orgId: selected },
          select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            acceptedAt: true,
          },
        })
      : [],
    db.transaction.findMany({
      where: {
        ...filter,
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
      },
      select: { executionState: true, latencyMs: true, failureCategory: true },
    }),
    db.capability.findMany({ where: filter, orderBy: { version: "desc" } }),
  ]);
  if (["Analyst", "Developer"].includes(membership.role)) {
    application.draft = {};
    application.submissions = [];
  }
  const registryProfiles = await db.publishedProfile.findMany({
    where: { ...filter, current: true },
    take: 500,
  });
  const latestActivation = activations[0];
  const acknowledged = activations.find(
    (a) => a.acknowledgedAt && a.action === "publish",
  );
  const publishedSubmission = acknowledged
    ? await db.submission.findUnique({
        where: { id: acknowledged.submissionId },
      })
    : null;
  const publishedSnapshot = publishedSubmission?.snapshot as
    | {
        draft: Draft;
        requirements: { id: string }[];
        evidence: { id: string }[];
      }
    | undefined;
  const evidenceForEligibility = publishedSnapshot
    ? await db.evidence.findMany({
        where: {
          orgId: selected,
          id: { in: publishedSnapshot.evidence.map((e) => e.id) },
          deletedAt: null,
        },
        select: {
          requirementId: true,
          scanStatus: true,
          reviewStatus: true,
          expiresAt: true,
        },
      })
    : [];
  const evidenceValid =
    !!publishedSnapshot &&
    publishedSnapshot.requirements.every((r) =>
      evidenceForEligibility.some(
        (e) =>
          e.requirementId === r.id &&
          e.reviewStatus === "Accepted" &&
          (!e.expiresAt || e.expiresAt > new Date()) &&
          (e.scanStatus === "Clean" ||
            (localMode() &&
              membership.org.fictional &&
              environment === "sandbox" &&
              e.scanStatus === "Fixture only")),
      ),
    );
  const availabilityRows = [
    ...new Map(
      [...capabilities].reverse().map((c) => [c.capabilityId, c]),
    ).values(),
  ].map((capability) => {
    const profile = registryProfiles.find(
      (p) => p.capabilityId === capability.capabilityId,
    );
    const reported = availability.find(
      (a) =>
        a.capabilityId === capability.capabilityId &&
        a.source === "Provider reported" &&
        (!profile || a.capabilityVersion === profile.capabilityVersion),
    );
    const observed = availability.find(
      (a) =>
        a.capabilityId === capability.capabilityId &&
        a.observationType === "availability" &&
        a.trust !== "authenticated-provider" &&
        a.capabilityVersion === profile?.capabilityVersion,
    );
    const current =
      publishedSnapshot?.draft.capabilities?.some(
        (c) =>
          c.capabilityId === capability.capabilityId &&
          c.environment === environment,
      ) || false;
    const definition = profile?.definition as unknown as
      import("./domain").CapabilityDefinition | undefined;
    const scoped = availability.filter(
      (o) =>
        o.integrationId === profile?.integrationId &&
        o.capabilityVersion === profile?.capabilityVersion &&
        o.capabilityId === capability.capabilityId,
    );
    const required = definition?.fulfillment?.checks || [];
    const latestByScope = [
      ...new Map(
        [...scoped]
          .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
          .map((o) => [`${o.observationType}:${o.trust}`, o]),
      ).values(),
    ];
    const independent = latestByScope.filter((o) =>
      [
        "operator",
        "adapter",
        ...(environment === "sandbox" ? ["simulated"] : []),
      ].includes(o.trust || ""),
    );
    const freshChecks =
      required.every((type) =>
        independent.some(
          (o) =>
            o.observationType === type &&
            o.expiresAt > new Date() &&
            o.status === "Available",
        ),
      ) &&
      !latestByScope.some(
        (o) => o.expiresAt > new Date() && o.status !== "Available",
      );
    const withdrawn = activations.some(
      (a) => a.action === "withdraw" && a.sequence > (profile?.revision || 0),
    );
    const effective = effectiveEligibility({
      active: !!profile && latestActivation?.action === "publish" && !withdrawn,
      published: !!profile && current,
      evidenceValid,
      reported,
      observed: scoped.find(
        (o) =>
          o.observationType === "availability" &&
          o.trust !== "authenticated-provider",
      ),
      now: Date.now(),
    });
    return {
      capabilityId: capability.capabilityId,
      reported,
      observed,
      eligible: effective.eligible && freshChecks,
      reason: !profile
        ? "Complete fulfillment declaration requires review and publication"
        : !freshChecks
          ? "Fresh scoped health, availability and capacity required"
          : effective.eligible
            ? "Operational evidence present; transaction-specific evaluation still required"
            : effective.reason,
    };
  });
  const requirements = await matchedRequirements(
    db,
    application.draft as Draft,
  );
  const gates = await readiness(db, selected, environment);
  return {
    me,
    memberships,
    org: membership.org,
    role: membership.role,
    local: localMode(),
    internalRole: operator?.internalRole,
    application,
    evidence,
    integrations,
    credentials,
    runs,
    activations,
    jobs,
    availability,
    availabilityRows,
    transactions,
    total,
    settlements,
    events,
    audit: ["Analyst", "Developer"].includes(membership.role) ? [] : audit,
    notifications: membership.role === "Analyst" ? [] : notifications,
    team,
    invitations,
    metrics,
    capabilities,
    requirements,
    gates,
  };
}
export type WorkspaceData = Awaited<ReturnType<typeof workspaceData>>;
export async function transactionDetail(
  orgId: string,
  id: string,
  environment: string,
) {
  await member(orgId);
  const record = await db.transaction.findFirst({
    where: { orgId, id, environment },
    include: { settlements: true },
  });
  if (!record) throw new PortalError("Transaction not found", 404);
  return record;
}
export async function opsData(
  id?: string,
  filters?: {
    state?: string;
    market?: string;
    type?: string;
    reviewer?: string;
    from?: string;
  },
) {
  const actor = await internal();
  const me = await db.user.findUniqueOrThrow({
    where: { id: actor.user.id },
    select: { name: true, internalRole: true },
  });
  const apps = await db.application.findMany({
    take: 100,
    include: {
      org: true,
      submissions: {
        orderBy: { version: "desc" },
        take: 2,
        include: { reviews: true, changes: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });
  const applications = apps.filter((a) => {
    const d = ((a.submissions[0]?.snapshot as { draft: Draft } | undefined)
      ?.draft || a.draft) as Draft;
    return (
      (!filters?.state || a.state === filters.state) &&
      (!filters?.market ||
        d.coverage?.payerOrigins?.includes(filters.market)) &&
      (!filters?.type || d.company?.providerType === filters.type) &&
      (!filters?.reviewer ||
        a.submissions[0]?.reviews.some(
          (r) => r.actorId === filters.reviewer,
        )) &&
      (!filters?.from || a.submissions[0]?.createdAt >= new Date(filters.from))
    );
  });
  const application = id
    ? apps.find((a) => a.id === id || a.orgId === id)
    : undefined;
  if (id && !application) throw new PortalError("Application not found", 404);
  const submittedEvidenceIds = (
    (
      application?.submissions[0]?.snapshot as
        { evidence?: { id: string }[] } | undefined
    )?.evidence || []
  ).map((e) => e.id);
  const [requirements, audit, reviewers] = await Promise.all([
    db.requirement.findMany({ orderBy: { createdAt: "desc" } }),
    db.audit.findMany({
      where: application ? { orgId: application.orgId } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    db.user.findMany({
      where: { internalRole: { not: null } },
      select: { id: true, name: true },
    }),
  ]);
  return {
    me,
    applications,
    application,
    requirements,
    audit,
    reviewers,
    evidence: application
      ? await db.evidence.findMany({
          where: {
            orgId: application.orgId,
            id: { in: submittedEvidenceIds },
            deletedAt: null,
          },
          select: {
            id: true,
            filename: true,
            requirementId: true,
            scanStatus: true,
            reviewStatus: true,
            expiresAt: true,
            metadata: true,
          },
        })
      : [],
    runs: application
      ? await db.sandboxRun.findMany({
          where: { orgId: application.orgId },
          orderBy: { createdAt: "desc" },
          take: 20,
        })
      : [],
    activations: application
      ? await db.activation.findMany({
          where: { orgId: application.orgId },
          orderBy: { createdAt: "desc" },
        })
      : [],
    jobs: application
      ? await db.job.findMany({
          where: { orgId: application.orgId, kind: "registry" },
          orderBy: { createdAt: "desc" },
        })
      : [],
    productionGates: application
      ? await readiness(db, application.orgId, "production")
      : [],
    sandboxGates: application
      ? await readiness(db, application.orgId, "sandbox")
      : [],
    local: localMode(),
  };
}
export type OpsData = Awaited<ReturnType<typeof opsData>>;
