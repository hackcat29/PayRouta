import "dotenv/config";
import { test, expect } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import { randomUUID } from "node:crypto";
import { db } from "../../lib/portal/db";
const origin = "http://127.0.0.1:3000";
test("qualification controls: MFA, scope version conflicts, fictional live denial and audited rollout gates", async ({
  page,
}) => {
  if (
    !process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") ||
    process.env.PORTAL_MODE !== "local"
  )
    throw new Error("Local fixture database required");
  const login = await page.request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email: "ops@payrouta.example", password: "PayRouta-Local-2026!" },
  });
  expect(login.ok()).toBeTruthy();
  const code = await createOTP("payrouta-fictional-totp-secret").totp();
  const verify = await page.request.post("/api/auth/two-factor/verify-totp", {
    headers: { Origin: origin },
    data: { code, trustDevice: false },
  });
  expect(verify.ok()).toBeTruthy();
  const command = (data: unknown) =>
    page.request.post("/api/merchant", { headers: { Origin: origin }, data });
  const orgId = `qualification-test-${randomUUID()}`;
  await db.organization.create({
    data: {
      id: orgId,
      name: "Fictional qualification regression",
      fictional: true,
    },
  });
  await db.merchantConfig.create({
    data: {
      orgId,
      returnOrigin: origin,
      applicationState: "Under review",
      application: { country: "NG", methods: ["bank-transfer"] },
    },
  });
  const due = new Date(Date.now() + 86400000).toISOString();
  const scope = {
    environment: "production",
    merchantCountry: "NG",
    payerCountries: ["NG"],
    methods: ["bank-transfer"],
    asset: "fiat:NGN:",
    settlementAsset: "fiat:NGN:",
    maximumMinor: "10000",
    dailyMaximumMinor: "20000",
    profileIds: ["missing-profile"],
    accounts: [
      {
        integrationId: "missing-integration",
        accountReference: "test-account",
        permissionEvidenceId: "permission",
        settlementDestinationEvidenceId: "destination",
        refundResponsibilityEvidenceId: "refund",
      },
    ],
    evidenceIds: ["merchant-evidence"],
    nextReviewAt: due,
  };
  const proposal = {
    action: "propose-live-scope",
    orgId,
    applicationVersion: 1,
    expectedScopeVersion: null,
    input: scope,
    reason: "Fictional local regression only",
  };
  expect((await command(proposal)).status()).toBe(403);
  const step = await page.request.post("/api/portal/command", {
    headers: { Origin: origin },
    data: { action: "step-up", code },
  });
  expect(step.ok()).toBeTruthy();
  const proposed = await command(proposal);
  expect(proposed.ok(), await proposed.text()).toBeTruthy();
  const saved = await proposed.json();
  expect((await command(proposal)).status()).toBe(409);
  const approve = await command({
    action: "approve-live-scope",
    orgId,
    version: saved.version,
    reason: "Fictional live approval must fail",
  });
  expect(approve.status()).toBe(409);
  expect((await approve.json()).error).toContain("FICTIONAL_MERCHANT");
  const revoke = await command({
    action: "revoke-live-scope",
    orgId,
    version: saved.version,
    reason: "Close fictional local proposal",
  });
  expect(revoke.ok()).toBeTruthy();
  const original = await db.publishedProfile.findFirstOrThrow({
    where: { environment: "sandbox", current: true },
  });
  const profileId = `qualification-profile-${randomUUID()}`;
  const integration = await db.integration.findUniqueOrThrow({
    where: { id: original.integrationId },
  });
  const proof = await db.evidence.create({
    data: {
      orgId: original.orgId,
      requirementId: "synthetic-test-report",
      objectKey: randomUUID(),
      filename: "fictional-regression-report.txt",
      mime: "text/plain",
      size: 1,
      sha256: "fixture",
      metadata: { fictional: true },
      scanStatus: "Clean",
      reviewStatus: "Accepted",
      retentionUntil: new Date(Date.now() + 2 * 86400000),
    },
  });
  const run = await db.sandboxRun.create({
    data: {
      orgId: original.orgId,
      adapter: "simulator",
      integrationVersion: integration.version,
      scenario: "qualification-test-fixture",
      outcome: "Passed",
      idempotencyKey: randomUUID(),
      steps: { fictional: true },
      finishedAt: new Date(),
    },
  });
  await db.publishedProfile.create({
    data: {
      ...original,
      id: profileId,
      definition: original.definition as object,
      rollout: {
        stage: "Candidate",
        version: "initial",
        evidenceIds: [],
        maximumMinor: "10000",
        merchantAllowlist: [],
      },
    },
  });
  try {
    await expect(
      db.publishedProfile.update({
        where: { id: profileId },
        data: { method: "card" === original.method ? "bank-transfer" : "card" },
      }),
    ).rejects.toThrow();
    const rollout = {
      stage: "Sandbox qualified",
      merchantAllowlist: [],
      maximumMinor: "10000",
      nextReviewAt: due,
      qualificationKind: "simulator",
      proofs: ["adapter-conformance", "sandbox", "runbook"].map((gate) => ({
        gate,
        evidenceId: proof.id,
      })),
      sandboxRunIds: [run.id],
    };
    const change = {
      action: "rollout-transition",
      profileId,
      expectedVersion: "initial",
      reason: "Fictional simulator qualification regression",
      rollout,
    };
    expect(
      (
        await command({
          ...change,
          rollout: { ...rollout, stage: "Limited live" },
        })
      ).status(),
    ).toBe(409);
    const qualified = await command(change);
    expect(qualified.ok(), await qualified.text()).toBeTruthy();
    const current = await qualified.json();
    expect((await command(change)).status()).toBe(409);
    const live = await command({
      ...change,
      expectedVersion: current.version,
      rollout: {
        ...rollout,
        stage: "Pilot enabled",
        proofs: [
          "account",
          "adapter-conformance",
          "sandbox",
          "risk",
          "monitoring",
          "runbook",
        ].map((gate) => ({ gate, evidenceId: proof.id })),
      },
    });
    expect(live.status()).toBe(409);
    expect((await live.json()).error).toContain(
      "REAL_EXECUTION_AND_SETTLEMENT",
    );
    const paused = await command({
      ...change,
      expectedVersion: current.version,
      rollout: { ...rollout, stage: "Paused" },
    });
    expect(paused.ok()).toBeTruthy();
    expect(
      await db.audit.count({
        where: { target: profileId, action: "coverage.rollout.transition" },
      }),
    ).toBe(2);
    await page.goto("/ops/coverage");
    await expect(
      page.getByRole("heading", {
        name: "Coverage qualification",
        exact: true,
      }),
    ).toBeVisible();
    await page.goto("/ops/observability");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  } finally {
    await db.publishedProfile.update({
      where: { id: profileId },
      data: { current: false },
    });
  }
});
test.afterAll(() => db.$disconnect());
