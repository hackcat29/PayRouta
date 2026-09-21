import "dotenv/config";
import { test, expect, APIRequestContext } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
import { workOnce } from "../../lib/portal/worker";
import {
  publishActivation,
  reconcileRegistry,
} from "../../lib/portal/registry";
import { ingestObservation } from "../../lib/portal/observations";
import {
  evaluateContext,
  revalidateSelectedMethod,
} from "../../lib/portal/availability-service";
import { fixtureCapability, config, context } from "../fixtures/providers";
import { localMode } from "../../lib/portal/adapters";
const origin = "http://127.0.0.1:3000";
async function cmd(request: APIRequestContext, data: Record<string, unknown>) {
  return request.post("/api/portal/command", {
    headers: { Origin: origin },
    data,
  });
}
async function ok(request: APIRequestContext, data: Record<string, unknown>) {
  const result = await cmd(request, data);
  expect(result.ok(), await result.text()).toBeTruthy();
  return result.json();
}
async function login(request: APIRequestContext, email: string) {
  const r = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email, password: "PayRouta-Local-2026!" },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const code = await createOTP("payrouta-fictional-totp-secret").totp();
  const v = await request.post("/api/auth/two-factor/verify-totp", {
    headers: { Origin: origin },
    data: { code, trustDevice: false },
  });
  expect(v.ok(), await v.text()).toBeTruthy();
  await ok(request, { action: "step-up", code });
}
async function drain() {
  for (let i = 0; i < 100; i++) if (!(await workOnce())) return;
  throw new Error("worker budget exceeded");
}
test("complete approved sandbox registry → observations → customer method availability; ordering and restrictions", async ({
  browser,
  request,
}) => {
  test.setTimeout(180000);
  expect(localMode()).toBe(true);
  await db.rateLimit.deleteMany({});
  await login(request, "owner@harbor.example");
  const ops = await browser.newContext({ baseURL: origin });
  await login(ops.request, "ops@payrouta.example");
  const seed = await db.application.findUniqueOrThrow({
    where: { orgId: "harbor" },
  });
  const draft = seed.draft as Record<string, unknown>;
  const providers: {
    orgId: string;
    appId: string;
    integrationId: string;
    capability: ReturnType<typeof fixtureCapability>;
    activationId: string;
  }[] = [];
  for (let index = 0; index < 3; index++) {
    const { orgId } = await ok(request, {
      action: "create-organization",
      name: `Fictional registry ${index} ${randomUUID()}`,
    });
    for (const section of [
      "company",
      "coverage",
      "settlement",
      "integration",
    ]) {
      const app = await db.application.findUniqueOrThrow({ where: { orgId } });
      await ok(request, {
        action: "save-section",
        orgId,
        section,
        version: app.version,
        value:
          section === "integration"
            ? config
            : section === "settlement" && index === 2
              ? {
                  ...(draft.settlement as object),
                  assets: [fixtureCapability("fictional-chain", true).input],
                }
              : draft[section],
        environment: "sandbox",
      });
    }
    let app = await db.application.findUniqueOrThrow({ where: { orgId } });
    const integration = await db.integration.findFirstOrThrow({
      where: { orgId },
    });
    const capability = fixtureCapability(
      index === 0
        ? "fictional-harbor"
        : index === 1
          ? "fictional-creek"
          : "fictional-chain",
      index === 2,
    );
    capability.fulfillment!.integrationId = integration.id;
    await ok(request, {
      action: "save-capability",
      orgId,
      version: app.version,
      value: capability,
    });
    const requirements = await db.requirement.findMany({
      where: { active: true, illustrative: true },
    });
    for (const r of requirements) {
      await ok(request, {
        action: "fixture-evidence",
        orgId,
        requirementId: r.id,
      });
      const e = await db.evidence.findFirstOrThrow({
        where: { orgId, requirementId: r.id },
      });
      await ok(ops.request, {
        action: "ops-evidence",
        evidenceId: e.id,
        decision: "Accepted",
        reason: "Fictional sandbox only",
      });
    }
    await ok(request, {
      action: "sandbox-run",
      orgId,
      scenario: "Authentication succeeds",
      key: randomUUID(),
    });
    await drain();
    app = await db.application.findUniqueOrThrow({ where: { orgId } });
    await ok(request, {
      action: "submit",
      orgId,
      version: app.version,
      key: randomUUID(),
    });
    for (const [kind, decision] of [
      ["application", "Under review"],
      ["legal", "Passed"],
      ["technical", "Passed"],
      ["application", "Approved"],
    ])
      await ok(ops.request, {
        action: "ops-review",
        applicationId: app.id,
        kind,
        decision,
        reason: "Fictional sandbox review",
        internalNote: "PRIVATE_REVIEW_NOTE",
      });
    expect(await db.publishedProfile.count({ where: { orgId } })).toBe(0);
    await ok(ops.request, {
      action: "ops-activate",
      applicationId: app.id,
      environment: "sandbox",
      reason: "Fictional scenario",
    });
    const activation = await db.activation.findFirstOrThrow({
      where: { orgId },
    });
    // Crash boundary: publish durable projection, leave job unacknowledged, then run worker again.
    await Promise.all([
      publishActivation(activation.id, `registry:${activation.id}`),
      publishActivation(activation.id, `registry:${activation.id}`),
    ]);
    expect(
      (await db.activation.findUniqueOrThrow({ where: { id: activation.id } }))
        .acknowledgedAt,
    ).toBeNull();
    await drain();
    await publishActivation(activation.id, `registry:${activation.id}`);
    expect(await db.registrySnapshot.count({ where: { orgId } })).toBe(1);
    expect(
      await db.publishedProfile.count({ where: { orgId, current: true } }),
    ).toBe(1);
    expect(
      (await db.activation.findUniqueOrThrow({ where: { id: activation.id } }))
        .state,
    ).toBe("Active");
    providers.push({
      orgId,
      appId: app.id,
      integrationId: integration.id,
      capability,
      activationId: activation.id,
    });
  }
  const now = new Date();
  async function observe(index: number, status = "Available", sequence = 1) {
    const p = providers[index];
    for (const type of ["health", "availability", "capacity"]) {
      const input = {
        integrationId: p.integrationId,
        capabilityId: p.capability.capabilityId,
        capabilityVersion: 1,
        environment: "sandbox",
        type,
        eventId: `event-${index}-${type}-${sequence}`,
        sequence,
        observedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 30000).toISOString(),
        status,
        ...(type === "capacity" ? { remaining: "100000" } : {}),
      };
      const result = await ingestObservation(p.orgId, input, "simulated", now);
      const duplicate = await ingestObservation(
        p.orgId,
        input,
        "simulated",
        now,
      );
      expect(duplicate.id).toBe(result.id);
      expect(duplicate.duplicate).toBe(true);
      await expect(
        ingestObservation(
          p.orgId,
          {
            ...input,
            status: status === "Available" ? "Unavailable" : "Available",
          },
          "simulated",
          now,
        ),
      ).rejects.toThrow("EVENT_CONFLICT");
      expect(
        (
          await ingestObservation(
            p.orgId,
            {
              ...input,
              eventId: `old-${index}-${type}-${sequence}`,
              sequence: 0,
            },
            "simulated",
            now,
          )
        ).applied,
      ).toBe(false);
      await expect(
        ingestObservation(
          p.orgId,
          {
            ...input,
            eventId: "future",
            observedAt: new Date(now.getTime() + 60000).toISOString(),
            expiresAt: new Date(now.getTime() + 70000).toISOString(),
          },
          "simulated",
          now,
        ),
      ).rejects.toThrow("TIME_INVALID");
      await expect(
        ingestObservation(
          p.orgId,
          { ...input, environment: "production" },
          "simulated",
          now,
        ),
      ).rejects.toThrow("PRODUCTION_FORBIDDEN");
    }
  }
  for (let i = 0; i < 3; i++) await observe(i);
  const merchantId = providers[0].orgId;
  const value = {
    ...context,
    merchantId,
    providerAllowlist: providers.map((p) => p.orgId),
    validUntil: new Date(now.getTime() + 3600000).toISOString(),
  };
  const unauthorized = await cmd(request, {
    action: "ops-availability-context",
    orgId: merchantId,
    value,
  });
  expect(unauthorized.status()).toBe(403);
  const { contextId } = await ok(ops.request, {
    action: "ops-availability-context",
    orgId: merchantId,
    value,
  });
  const safe = await ok(request, {
    action: "evaluate-availability",
    orgId: merchantId,
    contextId,
  });
  expect(safe.methods[0].status).toBe("AVAILABLE");
  expect(JSON.stringify(safe)).not.toContain(providers[1].orgId);
  const allowed = await revalidateSelectedMethod(
    merchantId,
    contextId,
    safe.evaluationId,
    "bank-transfer",
    now,
  );
  expect(allowed.candidateIds).toHaveLength(2);
  await expect(
    revalidateSelectedMethod(
      merchantId,
      contextId,
      safe.evaluationId,
      "stablecoin",
      now,
    ),
  ).rejects.toThrow("NOT_AVAILABLE");
  await expect(
    revalidateSelectedMethod(
      merchantId,
      "wrong",
      safe.evaluationId,
      "bank-transfer",
      now,
    ),
  ).rejects.toThrow("MISMATCHED");
  const stale = await evaluateContext(
    merchantId,
    contextId,
    new Date(now.getTime() + 30001),
  );
  expect(stale.methods[0].status).toBe("UNKNOWN");
  await expect(
    revalidateSelectedMethod(
      merchantId,
      contextId,
      safe.evaluationId,
      "bank-transfer",
      new Date(now.getTime() + 30001),
    ),
  ).rejects.toThrow("EXPIRED");
  // Proposed version has no effect on live version or observations.
  const app = await db.application.findUniqueOrThrow({
    where: { orgId: merchantId },
  });
  await ok(request, {
    action: "save-capability",
    orgId: merchantId,
    version: app.version,
    value: { ...providers[0].capability, maximum: "200" },
  });
  expect(
    (
      await db.publishedProfile.findFirstOrThrow({
        where: { orgId: merchantId, current: true },
      })
    ).capabilityVersion,
  ).toBe(1);
  await observe(0, "Unavailable", 2);
  expect(
    (await evaluateContext(merchantId, contextId, now)).methods[0].status,
  ).toBe("AVAILABLE");
  await ok(ops.request, {
    action: "ops-suspend",
    applicationId: providers[1].appId,
    environment: "sandbox",
    reason: "Immediate authoritative restriction",
  });
  // No worker delivery yet. A new positive provider report cannot bypass the pending suspension.
  await ok(request, {
    action: "availability",
    orgId: providers[1].orgId,
    environment: "sandbox",
    capabilityId: providers[1].capability.capabilityId,
    status: "Available",
    minutes: 5,
  });
  expect(
    (await evaluateContext(merchantId, contextId, now)).methods[0].status,
  ).toBe("TEMPORARILY_UNAVAILABLE");
  await expect(
    revalidateSelectedMethod(
      merchantId,
      contextId,
      safe.evaluationId,
      "bank-transfer",
      now,
    ),
  ).rejects.toThrow("NO_LONGER_AVAILABLE");
  const withdrawal = await db.activation.findFirstOrThrow({
    where: { orgId: providers[1].orgId },
    orderBy: { sequence: "desc" },
  });
  await publishActivation(withdrawal.id, `registry:${withdrawal.id}`);
  const older = await publishActivation(
    providers[1].activationId,
    `registry:${providers[1].activationId}`,
  );
  expect(older.stale).toBe(true);
  expect(
    await db.publishedProfile.count({
      where: { orgId: providers[1].orgId, current: true },
    }),
  ).toBe(0);
  await drain();
  // Explicit rollback uses a fresh revision; pending republish cannot bypass a withdrawal.
  const prior = await db.activation.findUniqueOrThrow({
    where: { id: providers[1].activationId },
  });
  const republish = await ok(ops.request, {
    action: "ops-republish-approved",
    orgId: providers[1].orgId,
    submissionId: prior.submissionId,
    reason: "Republish approved historical fixture",
  });
  expect(republish.revision).toBe(3);
  expect(
    (await evaluateContext(merchantId, contextId, now)).methods[0].status,
  ).not.toBe("AVAILABLE");
  await ok(ops.request, {
    action: "ops-suspend",
    applicationId: providers[1].appId,
    environment: "sandbox",
    reason: "Withdraw while republish pending",
  });
  await drain();
  const replay = await ok(ops.request, {
    action: "ops-republish-approved",
    orgId: providers[1].orgId,
    submissionId: prior.submissionId,
    reason: "Explicit approved rollback",
  });
  expect(replay.revision).toBe(5);
  await db.job.delete({ where: { key: `registry:${replay.activationId}` } });
  let cursor: string | undefined;
  do {
    const result = await reconcileRegistry(100, cursor);
    cursor = result.nextCursor || undefined;
  } while (cursor);
  await drain();
  const restored = await db.publishedProfile.findFirstOrThrow({
    where: { orgId: providers[1].orgId, current: true },
  });
  expect(restored.revision).toBe(5);
  expect(
    await db.registrySnapshot.count({ where: { orgId: providers[1].orgId } }),
  ).toBe(5);
  await expect(
    db.publishedProfile.update({
      where: { id: restored.id },
      data: { definition: {} },
    }),
  ).rejects.toThrow();
  const list = await ok(ops.request, {
    action: "ops-registry-query",
    orgId: providers[1].orgId,
    query: { environment: "sandbox", method: "bank-transfer", limit: 1 },
  });
  expect(list.rows).toHaveLength(1);
  expect(list.rows[0].revision).toBe(5);
  const other = await browser.newContext({ baseURL: origin });
  await login(other.request, "owner@cedar.example");
  const denial = await cmd(other.request, {
    action: "evaluate-availability",
    orgId: merchantId,
    contextId,
  });
  expect(denial.status()).toBe(403);
  await other.close();
  await ops.close();
});
