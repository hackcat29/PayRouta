import { randomUUID } from "node:crypto";
import { z } from "zod";
import { internal } from "../portal/access";
import { atomic, audit, json } from "../portal/service";
import { PortalError } from "../portal/domain";
import { rolloutSchema } from "./rollout";

export const qualificationGates = [
  "account",
  "adapter-conformance",
  "sandbox",
  "risk",
  "monitoring",
  "runbook",
  "pilot",
  "settlement",
  "reconciliation",
] as const;
export const gatesForStage = (stage: string): readonly string[] => {
  if (stage === "Candidate" || stage === "Paused") return [];
  if (stage === "Sandbox qualified")
    return ["adapter-conformance", "sandbox", "runbook"];
  if (stage === "Pilot enabled")
    return [
      "account",
      "adapter-conformance",
      "sandbox",
      "risk",
      "monitoring",
      "runbook",
    ];
  return qualificationGates;
};
export function canTransition(from: string, to: string) {
  if (to === "Paused") return true;
  if (to === "Candidate") return from === "Paused" || from === "Candidate";
  const stages = [
    "Candidate",
    "Sandbox qualified",
    "Pilot enabled",
    "Limited live",
    "Generally enabled",
  ];
  return (
    stages.indexOf(to) === stages.indexOf(from) + 1 && stages.includes(from)
  );
}
const input = z
  .object({
    action: z.literal("rollout-transition"),
    profileId: z.string().min(1).max(300),
    expectedVersion: z.string().max(100).nullable(),
    reason: z.string().min(10).max(1000),
    rollout: rolloutSchema
      .omit({ version: true, evidenceIds: true })
      .extend({
        nextReviewAt: z.iso.datetime(),
        qualificationKind: z.enum([
          "simulator",
          "provider-sandbox",
          "live-pilot",
        ]),
        proofs: z
          .array(
            z
              .object({
                gate: z.enum(qualificationGates),
                evidenceId: z.string().min(1).max(100),
              })
              .strict(),
          )
          .max(9),
        sandboxRunIds: z.array(z.string().min(1).max(100)).max(20),
      })
      .strict(),
  })
  .strict();
export async function transitionRollout(raw: unknown, headers: Headers) {
  const actor = await internal(true, headers);
  const b = input.parse(raw);
  const now = new Date();
  return atomic(async (tx) => {
    const profile = await tx.publishedProfile.findUniqueOrThrow({
      where: { id: b.profileId },
    });
    if (!profile.current) throw new PortalError("PROFILE_SUPERSEDED", 409);
    const previous = rolloutSchema.safeParse(profile.rollout);
    if ((previous.success ? previous.data.version : null) !== b.expectedVersion)
      throw new PortalError("ROLLOUT_VERSION_CONFLICT", 409);
    const from = previous.success ? previous.data.stage : "Candidate";
    if (!canTransition(from, b.rollout.stage))
      throw new PortalError("ROLLOUT_TRANSITION_NOT_ALLOWED", 409);
    const active = !["Candidate", "Paused"].includes(b.rollout.stage);
    const ids = [...new Set(b.rollout.proofs.map((p) => p.evidenceId))];
    if (active) {
      const review = new Date(b.rollout.nextReviewAt);
      if (review <= now || review.getTime() > now.getTime() + 90 * 86400000)
        throw new PortalError("QUALIFICATION_REVIEW_DATE_INVALID", 409);
      if (
        new Set(b.rollout.proofs.map((p) => p.gate)).size !==
          b.rollout.proofs.length ||
        gatesForStage(b.rollout.stage).some(
          (g) => !b.rollout.proofs.some((p) => p.gate === g),
        )
      )
        throw new PortalError("QUALIFICATION_PROOFS_REQUIRED", 409);
      const evidence = await tx.evidence.findMany({
        where: {
          id: { in: ids },
          orgId: profile.orgId,
          deletedAt: null,
          scanStatus: "Clean",
          reviewStatus: "Accepted",
          retentionUntil: { gt: now },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (evidence.length !== ids.length)
        throw new PortalError(
          "CURRENT_ACCEPTED_QUALIFICATION_EVIDENCE_REQUIRED",
          409,
        );
      const integration = await tx.integration.findUniqueOrThrow({
        where: { id: profile.integrationId },
      });
      const adapter = (integration.config as { adapter?: string }).adapter;
      // Actual orchestrator support is authoritative, never an operator checkbox.
      if (
        profile.environment !== "sandbox" ||
        adapter !== "simulator" ||
        b.rollout.qualificationKind !== "simulator" ||
        b.rollout.stage !== "Sandbox qualified"
      )
        throw new PortalError(
          "REAL_EXECUTION_AND_SETTLEMENT_QUALIFICATION_INCOMPLETE",
          409,
        );
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: profile.orgId },
      });
      if (!org.fictional)
        throw new PortalError("SIMULATOR_REQUIRES_FICTIONAL_ORGANIZATION", 409);
      const runs = await tx.sandboxRun.findMany({
        where: {
          id: { in: b.rollout.sandboxRunIds },
          orgId: profile.orgId,
          environment: "sandbox",
          adapter: "simulator",
          integrationVersion: integration.version,
          outcome: "Passed",
          finishedAt: { gte: new Date(now.getTime() - 30 * 86400000) },
        },
      });
      if (!runs.length || runs.length !== new Set(b.rollout.sandboxRunIds).size)
        throw new PortalError("CURRENT_MATCHING_SANDBOX_RUN_REQUIRED", 409);
    }
    const rollout = { ...b.rollout, evidenceIds: ids, version: randomUUID() };
    await tx.publishedProfile.update({
      where: { id: profile.id },
      data: { rollout: json(rollout) },
    });
    await audit(
      tx,
      profile.orgId,
      actor.user.id,
      "coverage.rollout.transition",
      profile.id,
      { reason: b.reason, from, rollout },
      true,
    );
    return { stage: rollout.stage, version: rollout.version };
  });
}
