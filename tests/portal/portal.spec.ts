import "dotenv/config";
import { test, expect, APIRequestContext, Page } from "@playwright/test";
import { createOTP } from "@better-auth/utils/otp";
import { db } from "../../lib/portal/db";
import { readdir, readFile } from "node:fs/promises";
import { symmetricDecrypt } from "better-auth/crypto";
import { localMode } from "../../lib/portal/adapters";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async () => {
  if (!localMode()) throw new Error("Acceptance fixtures require local mode");
  await db.rateLimit.deleteMany({});
});
const origin = "http://127.0.0.1:3000";
const code = () => createOTP("payrouta-fictional-totp-secret").totp();
async function login(
  request: APIRequestContext,
  email = "owner@harbor.example",
) {
  const signin = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: origin },
    data: { email, password: "PayRouta-Local-2026!" },
  });
  expect(signin.ok(), await signin.text()).toBeTruthy();
  const verify = await request.post("/api/auth/two-factor/verify-totp", {
    headers: { Origin: origin },
    data: { code: await code(), trustDevice: false },
  });
  expect(verify.ok(), await verify.text()).toBeTruthy();
}
async function cmd(request: APIRequestContext, data: Record<string, unknown>) {
  return request.post("/api/portal/command", {
    headers: { Origin: origin },
    data,
  });
}
async function step(request: APIRequestContext) {
  const r = await cmd(request, { action: "step-up", code: await code() });
  expect(r.ok(), await r.text()).toBeTruthy();
}
// Provider organizations come from approved access requests; tests seed them
// directly with the requested owner.
async function providerOrg(name: string, email = "owner@harbor.example") {
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const org = await db.organization.create({
    data: {
      name,
      fictional: true,
      application: { create: {} },
      memberships: { create: { userId: user.id, role: "Owner" } },
    },
  });
  return org.id;
}
async function mailTo(email: string, subject: string) {
  const all = await Promise.all(
    (await readdir(".local/portal/mail")).map(async (f) =>
      JSON.parse(await readFile(`.local/portal/mail/${f}`, "utf8")),
    ),
  );
  return all
    .filter((m) => m.to === email && m.subject.includes(subject))
    .sort((a, b) => b.at.localeCompare(a.at))[0];
}
async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `test-results/portal-${name}.png`,
    fullPage: true,
    caret: "initial",
  });
}
test("provider onboarding, immutable review, changes, activation and publication", async ({
  page,
  browser,
}) => {
  await login(page.request);
  await step(page.request);
  const orgId = await providerOrg(`Review journey ${Date.now()}`);
  const seed = await db.application.findUniqueOrThrow({
    where: { orgId: "harbor" },
  });
  const draft = seed.draft as Record<string, unknown>;
  for (const section of ["company", "coverage", "settlement", "integration"]) {
    const app = await db.application.findUniqueOrThrow({ where: { orgId } });
    const r = await cmd(page.request, {
      action: "save-section",
      orgId,
      section,
      version: app.version,
      value: draft[section],
      environment: "sandbox",
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  let app = await db.application.findUniqueOrThrow({ where: { orgId } });
  let r = await cmd(page.request, {
    action: "save-capability",
    orgId,
    version: app.version,
    value: (draft.capabilities as unknown[])[0],
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const requirement = await db.requirement.findFirstOrThrow({
    where: { active: true, illustrative: true },
  });
  r = await cmd(page.request, {
    action: "fixture-evidence",
    orgId,
    requirementId: requirement.id,
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const runKey = randomUUID();
  for (let i = 0; i < 2; i++) {
    r = await cmd(page.request, {
      action: "sandbox-run",
      orgId,
      scenario: "Timeout with uncertain outcome",
      key: runKey,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  expect(
    await db.sandboxRun.count({ where: { orgId, idempotencyKey: runKey } }),
  ).toBe(1);
  await expect
    .poll(
      async () =>
        (await db.sandboxRun.findFirst({ where: { orgId } }))?.outcome,
    )
    .toBe("Passed");
  app = await db.application.findUniqueOrThrow({ where: { orgId } });
  const key = randomUUID();
  for (let i = 0; i < 2; i++) {
    r = await cmd(page.request, {
      action: "submit",
      orgId,
      version: app.version,
      key,
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  const original = await db.submission.findFirstOrThrow({
    where: { applicationId: app.id },
  });
  expect(await db.submission.count({ where: { applicationId: app.id } })).toBe(
    1,
  );
  await expect(
    db.submission.update({
      where: { id: original.id },
      data: { snapshot: { tampered: true } },
    }),
  ).rejects.toThrow();
  const ops = await browser.newContext({ baseURL: origin });
  await login(ops.request, "ops@payrouta.example");
  await step(ops.request);
  async function review(kind: string, decision: string, reason: string) {
    const r = await cmd(ops.request, {
      action: "ops-review",
      applicationId: app.id,
      kind,
      decision,
      reason,
      section: "company",
      internalNote: "INTERNAL_ONLY_TEST",
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
  await review("application", "Under review", "Review started");
  await review("changes", "Changes requested", "Clarify legal trading name");
  await page.goto(`/provider/application?org=${orgId}`);
  await expect(page.getByText("Clarify legal trading name")).toBeVisible();
  expect(await page.content()).not.toContain("INTERNAL_ONLY_TEST");
  await shot(page, "application-desktop");
  const change = await db.changeRequest.findFirstOrThrow({
    where: { submissionId: original.id },
  });
  r = await cmd(page.request, {
    action: "respond",
    orgId,
    changeId: change.id,
    response: "Trading name clarified in the new draft.",
  });
  expect(r.ok()).toBeTruthy();
  app = await db.application.findUniqueOrThrow({ where: { orgId } });
  r = await cmd(page.request, {
    action: "save-section",
    orgId,
    section: "company",
    version: app.version,
    value: {
      ...(draft.company as object),
      tradingName: "Harbor review revision",
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  expect(
    (await db.submission.findUniqueOrThrow({ where: { id: original.id } }))
      .snapshot,
  ).toEqual(original.snapshot);
  const stale = await cmd(page.request, {
    action: "save-section",
    orgId,
    section: "company",
    version: app.version,
    value: { legalName: "Stale edit" },
  });
  expect(stale.status()).toBe(409);
  app = await db.application.findUniqueOrThrow({ where: { orgId } });
  r = await cmd(page.request, {
    action: "submit",
    orgId,
    version: app.version,
    key: randomUUID(),
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  await review("application", "Under review", "Resubmission review");
  await review("legal", "Passed", "Illustrative local legal review only");
  await review(
    "technical",
    "Passed",
    "Simulator review only; production checks remain required",
  );
  const evidence = await db.evidence.findFirstOrThrow({ where: { orgId } });
  r = await cmd(ops.request, {
    action: "ops-evidence",
    evidenceId: evidence.id,
    decision: "Accepted",
    reason: "Fictional fixture accepted for local sandbox review",
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  await review(
    "application",
    "Approved",
    "Approved for the controlled sandbox workflow",
  );
  r = await cmd(ops.request, {
    action: "ops-activate",
    applicationId: app.id,
    environment: "production",
    reason: "Attempt production",
  });
  expect(r.status()).toBe(400);
  expect(await r.text()).toContain(
    "Production provider test adapter unconfigured",
  );
  r = await cmd(ops.request, {
    action: "ops-activate",
    applicationId: app.id,
    environment: "sandbox",
    reason: "Publish fictional sandbox capability",
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  await expect
    .poll(
      async () =>
        (
          await db.activation.findFirst({
            where: { orgId },
            orderBy: { sequence: "desc" },
          })
        )?.state,
    )
    .toBe("Active");
  expect(await db.registrySnapshot.count({ where: { orgId } })).toBe(1);
  const publication = await db.job.findFirstOrThrow({
    where: { orgId, kind: "registry" },
  });
  await db.job.update({
    where: { id: publication.id },
    data: {
      state: "Failed",
      error: "Injected lost acknowledgement for retry test",
    },
  });
  r = await cmd(ops.request, {
    action: "ops-retry-publication",
    jobId: publication.id,
  });
  expect(r.ok()).toBeTruthy();
  await expect
    .poll(
      async () =>
        (await db.job.findUniqueOrThrow({ where: { id: publication.id } }))
          .state,
    )
    .toBe("Succeeded");
  expect(await db.registrySnapshot.count({ where: { orgId } })).toBe(1);
  const activated = await db.activation.findFirstOrThrow({ where: { orgId } });
  app = await db.application.findUniqueOrThrow({ where: { orgId } });
  r = await cmd(page.request, {
    action: "save-capability",
    orgId,
    version: app.version,
    value: { ...(draft.capabilities as object[])[0], maximum: "1500000" },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  expect(
    (await db.activation.findUniqueOrThrow({ where: { id: activated.id } }))
      .submissionId,
  ).toBe(activated.submissionId);
  const health = await cmd(page.request, {
    action: "sandbox-run",
    orgId,
    scenario: "Authentication succeeds",
    key: randomUUID(),
  });
  expect(health.ok()).toBeTruthy();
  await expect
    .poll(async () =>
      db.availability.count({
        where: { orgId, source: "Simulator observed", status: "Available" },
      }),
    )
    .toBeGreaterThan(0);
  await page.goto(`/provider/availability?org=${orgId}`);
  // Legacy free-text capabilities remain published, but cannot imply complete settlement support.
  await expect(page.getByText("Not ready", { exact: true })).toBeVisible();
  await expect(
    page.getByText(
      "Complete fulfillment declaration requires review and publication",
    ),
  ).toBeVisible();
  r = await cmd(page.request, {
    action: "availability",
    orgId,
    environment: "sandbox",
    capabilityId: "ng-bank-payin",
    status: "Unavailable",
    minutes: 60,
  });
  expect(r.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText("Not ready", { exact: true })).toBeVisible();
  const opsPage = await ops.newPage();
  await opsPage.goto(`/ops/applications/${app.id}`);
  await shot(opsPage, "internal-desktop");
  await opsPage.setViewportSize({ width: 390, height: 844 });
  await shot(opsPage, "internal-mobile");
  expect(
    await opsPage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  r = await cmd(ops.request, {
    action: "ops-suspend",
    applicationId: app.id,
    environment: "sandbox",
    reason: "Fictional suspension test",
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  await expect
    .poll(
      async () =>
        (
          await db.activation.findFirst({
            where: { orgId },
            orderBy: { sequence: "desc" },
          })
        )?.state,
    )
    .toBe("Suspended");
  r = await cmd(page.request, {
    action: "availability",
    orgId,
    environment: "sandbox",
    capabilityId: "ng-bank-payin",
    status: "Available",
    minutes: 60,
  });
  expect(r.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText("Not ready", { exact: true })).toBeVisible();
  await ops.close();
});
test("tenant isolation, roles, MFA, credential redaction, quarantine and CSRF", async ({
  page,
  browser,
}) => {
  await login(page.request);
  const other = await browser.newContext({ baseURL: origin });
  await login(other.request, "owner@cedar.example");
  const analyst = await browser.newContext({ baseURL: origin });
  await login(analyst.request, "analyst@harbor.example");
  let r = await cmd(other.request, {
    action: "save-section",
    orgId: "harbor",
    section: "company",
    version: 1,
    value: { legalName: "forged" },
  });
  expect(r.status()).toBe(403);
  r = await cmd(analyst.request, {
    action: "submit",
    orgId: "harbor",
    version: 1,
    key: randomUUID(),
  });
  expect(r.status()).toBe(403);
  r = await cmd(page.request, {
    action: "save-credential",
    orgId: "harbor",
    environment: "sandbox",
    kind: "outbound",
    label: "Not authorized",
    value: "fictional-secret-12345",
  });
  expect(r.status()).toBe(403);
  await step(page.request);
  r = await cmd(page.request, {
    action: "save-credential",
    orgId: "harbor",
    environment: "sandbox",
    kind: "outbound",
    label: "Security test",
    value: "fictional-secret-12345",
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  expect(await r.text()).not.toContain("fictional-secret-12345");
  await page.goto("/provider/integration/credentials?org=harbor");
  expect(await page.content()).not.toContain("fictional-secret-12345");
  const audit = await db.audit.findMany({ where: { orgId: "harbor" } });
  expect(JSON.stringify(audit)).not.toContain("fictional-secret-12345");
  const req = await db.requirement.findFirstOrThrow({
    where: { active: true },
  });
  r = await page.request.post("/api/portal/evidence?org=harbor", {
    headers: { Origin: origin },
    multipart: {
      requirementId: req.id,
      documentType: "Fictional upload",
      jurisdiction: "NG",
      identifier: "TEST",
      issueDate: "",
      capabilities: "",
      expiryDate: "",
      file: {
        name: "quarantine.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\nFICTIONAL ONLY\n%%EOF"),
      },
    },
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const evidence = await db.evidence.findFirstOrThrow({
    where: { orgId: "harbor", filename: "quarantine.pdf" },
    orderBy: { createdAt: "desc" },
  });
  r = await page.request.post(`/api/portal/evidence/${evidence.id}`, {
    headers: { Origin: origin },
  });
  expect(r.status()).toBe(403);
  r = await other.request.post(`/api/portal/evidence/${evidence.id}`, {
    headers: { Origin: origin },
  });
  expect(r.status()).toBe(403);
  r = await analyst.request.post(`/api/portal/evidence/${evidence.id}`, {
    headers: { Origin: origin },
  });
  expect(r.status()).toBe(403);
  r = await page.request.post("/api/portal/command", {
    headers: { Origin: "https://evil.example" },
    data: { action: "accept-invitation", token: "x".repeat(40) },
  });
  expect(r.status()).toBe(403);
  await page.goto("/provider/overview?org=cedar");
  await expect(
    page.getByRole("heading", { name: "Access restricted" }),
  ).toBeVisible();
  await other.close();
  await analyst.close();
});
test("all provider routes, desktop/mobile screenshots, empty production and accessibility", async ({
  page,
}) => {
  await login(page.request);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const routes = [
    "overview",
    "onboarding",
    "onboarding/company",
    "onboarding/coverage",
    "onboarding/capabilities",
    "onboarding/settlement",
    "onboarding/compliance",
    "onboarding/integration",
    "onboarding/review",
    "application",
    "capabilities",
    "integration",
    "integration/credentials",
    "integration/events",
    "sandbox",
    "availability",
    "transactions",
    "settlements",
    "performance",
    "team",
    "settings",
    "audit-log",
  ];
  for (const route of routes) {
    const r = await page.goto(`/provider/${route}?org=harbor`);
    expect(r?.status(), route).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
  }
  const tx = await db.transaction.findFirstOrThrow({
    where: { orgId: "harbor" },
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const [route, name] of [
      ["onboarding", "onboarding"],
      ["capabilities", "capabilities"],
      ["onboarding/review", "review"],
      [`transactions/${tx.id}`, "transaction"],
    ]) {
      await page.goto(`/provider/${route}?org=harbor`);
      await shot(page, `${name}-${width}`);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        route,
      ).toBeTruthy();
      if (route === "capabilities") {
        await page.getByRole("button", { name: "Add payment method" }).click();
        await shot(page, `capability-form-${width}`);
        await page.getByRole("button", { name: "Close", exact: true }).click();
      }
    }
  }
  await page.goto("/provider/onboarding/integration?org=harbor");
  await expect(
    page.getByText("How would you like to connect?", { exact: true }),
  ).toBeVisible();
  for (const name of [
    "Use the PayRouta Standard",
    "Map our existing API",
    "Ask about a native integration",
  ]) {
    await expect(
      page.getByRole("radio", { name: new RegExp(name) }),
    ).toBeVisible();
  }
  await page.goto("/provider/onboarding?org=harbor");
  const a11y = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    a11y.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.goto("/provider/transactions?org=harbor&env=production");
  await expect(
    page.getByText("No production transactions", { exact: true }),
  ).toBeVisible();
  await page.goto("/provider/performance?org=harbor&env=production");
  await expect(
    page.getByText("No data", { exact: true }).first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("access request, ops approval, invited sign-up, MFA and recipient-bound invitation", async ({
  page,
  browser,
}) => {
  const email = `onboarding-${Date.now()}@example.invalid`;
  // Provider sign-up without an invitation goes to the request form.
  await page.goto("/provider/sign-up");
  await expect(page).toHaveURL(/\/partners#request$/);
  await page.getByLabel("Your name").fill("Fictional New Provider");
  await page.getByLabel("Work email", { exact: true }).fill(email);
  await page.getByLabel("Company", { exact: true }).fill("Fictional new applicant");
  await page.getByLabel("Website").fill("https://applicant.example");
  await page.getByLabel("Country of registration").fill("Nigeria");
  await page
    .getByLabel("What kind of payment service do you run?")
    .selectOption("Mobile-money provider");
  await page.getByLabel("Mobile money").check();
  await page
    .getByLabel("Countries where you can process payments")
    .fill("Nigeria, Ghana");
  await page.getByRole("button", { name: "Request provider access" }).click();
  await expect(page.getByText("Request received")).toBeVisible();
  const request = await db.providerAccessRequest.findFirstOrThrow({
    where: { email },
  });
  expect(request.state).toBe("Pending");
  expect(await db.user.count({ where: { email } })).toBe(0);
  expect(await mailTo(email, "received your PayRouta provider request")).toBeTruthy();

  // Only an operations admin can approve.
  const reviewer = await browser.newContext({ baseURL: origin });
  await login(reviewer.request);
  await step(reviewer.request);
  let r = await cmd(reviewer.request, {
    action: "ops-provider-access",
    decision: "approve",
    requestId: request.id,
    orgName: "Fictional new applicant",
  });
  expect(r.status()).toBe(403);
  await reviewer.close();
  const ops = await browser.newContext({ baseURL: origin });
  await login(ops.request, "ops@payrouta.example");
  await step(ops.request);
  r = await cmd(ops.request, {
    action: "ops-provider-access",
    decision: "approve",
    requestId: request.id,
    orgName: "Fictional new applicant",
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  r = await cmd(ops.request, {
    action: "ops-provider-access",
    decision: "decline",
    requestId: request.id,
  });
  expect(r.status()).toBe(409);
  await ops.close();

  const approved = await mailTo(email, "approved for the PayRouta provider workspace");
  await page.goto(approved.text.match(/https?:\/\/\S+provider\/sign-up\S+?(?=\)|\s|$)/)[0]);
  await page.getByLabel("Full name").fill("Fictional New Provider");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page
    .getByLabel("Password", { exact: true })
    .fill("New-Local-Account-123!");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Check your email" }),
  ).toBeVisible();
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.emailVerified).toBe(false);
  expect(user.internalRole).toBeNull();
  const mail = await mailTo(email, "Confirm your email");
  expect(mail).toBeTruthy();
  await page.goto(mail.text.match(/https?:\/\/\S+verify-email\S+?(?=\)|\s|$)/)[0]);
  await expect(
    page.getByRole("heading", { name: "Join your provider workspace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page.locator("h1")).toHaveText("Home");
  const membership = await db.membership.findFirstOrThrow({
    where: { userId: user.id },
  });
  expect(membership.role).toBe("Owner");
  expect(membership.orgId).toBe(
    (await db.providerAccessRequest.findUniqueOrThrow({ where: { id: request.id } })).orgId,
  );
  await page.goto(`/provider/onboarding/company?org=${membership.orgId}`);
  await page
    .getByLabel("Legal name", { exact: true })
    .fill("Saved incomplete legal name");
  await page.getByRole("button", { name: "Save company details" }).click();
  await expect(page.getByRole("status")).toContainText("Draft saved");
  await page.reload();
  await expect(page.getByLabel("Legal name", { exact: true })).toHaveValue(
    "Saved incomplete legal name",
  );
  await page.goto(`/provider/settings?org=${membership.orgId}`);
  await page.getByLabel("Current password").fill("New-Local-Account-123!");
  await page.getByRole("button", { name: "Set up authenticator" }).click();
  await expect(
    page.getByText("Add this secret to your authenticator.", { exact: false }),
  ).toBeVisible();
  const factor = await db.twoFactor.findFirstOrThrow({
    where: { userId: user.id },
  });
  const raw = await symmetricDecrypt({
    key: process.env.BETTER_AUTH_SECRET!,
    data: factor.secret,
  });
  await page.getByLabel("Authenticator code").fill(await createOTP(raw).totp());
  await page
    .getByRole("button", { name: "Verify for sensitive actions" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "authorized for 15 minutes",
  );
  r = await cmd(page.request, {
    action: "member-remove",
    orgId: membership.orgId,
    memberId: membership.id,
  });
  expect(r.status()).toBe(400);
  expect(await r.text()).toContain("last owner");
  const owner = await browser.newContext({ baseURL: origin });
  await login(owner.request);
  await step(owner.request);
  r = await cmd(owner.request, {
    action: "invite",
    orgId: "harbor",
    email,
    role: "Analyst",
  });
  expect(r.ok(), await r.text()).toBeTruthy();
  const latest = await Promise.all(
    (await readdir(".local/portal/mail")).map(async (f) =>
      JSON.parse(await readFile(`.local/portal/mail/${f}`, "utf8")),
    ),
  );
  const invitationMail = latest.find(
    (m) => m.to === email && m.subject.includes("invited to join"),
  );
  const token = new URL(
    invitationMail.text.match(/https?:\/\/\S+invitation=[^\s)]+/)[0],
  ).searchParams.get("invitation");
  r = await cmd(owner.request, { action: "accept-invitation", token });
  expect(r.status()).toBe(403);
  r = await cmd(page.request, { action: "accept-invitation", token });
  expect(r.ok(), await r.text()).toBeTruthy();
  r = await cmd(page.request, { action: "accept-invitation", token });
  expect(r.status()).toBe(403);
  expect(await db.membership.count({ where: { userId: user.id } })).toBe(2);
  await owner.close();
});

test("internal roles, tenant-scoped details, auth limits and all deterministic scenarios", async ({
  page,
  browser,
}) => {
  await login(page.request, "reviewer@payrouta.example");
  await step(page.request);
  const application = await db.application.findUniqueOrThrow({
    where: { orgId: "harbor" },
  });
  let r = await cmd(page.request, {
    action: "ops-activate",
    applicationId: application.id,
    environment: "sandbox",
    reason: "Reviewer cannot activate",
  });
  expect(r.status()).toBe(403);
  const provider = await browser.newContext({ baseURL: origin });
  await login(provider.request);
  await step(provider.request);
  r = await cmd(provider.request, {
    action: "ops-review",
    applicationId: application.id,
    kind: "application",
    decision: "Approved",
    reason: "Provider cannot approve",
  });
  expect(r.status()).toBe(403);
  const transaction = await db.transaction.findFirstOrThrow({
    where: { orgId: "harbor" },
  });
  const other = await browser.newContext({ baseURL: origin });
  await login(other.request, "owner@cedar.example");
  const otherPage = await other.newPage();
  await otherPage.goto(`/provider/transactions/${transaction.id}?org=cedar`);
  await expect(otherPage.getByRole("heading", { level: 1 })).toContainText(
    /not|find|404|doesn’t connect/i,
  );
  const { scenarios } = await import("../../lib/portal/domain");
  const runs: string[] = [];
  for (const scenario of scenarios) {
    const response = await cmd(provider.request, {
      action: "sandbox-run",
      orgId: "harbor",
      scenario,
      key: randomUUID(),
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    runs.push((await response.json()).runId);
  }
  await expect
    .poll(async () =>
      db.sandboxRun.count({ where: { id: { in: runs }, outcome: "Passed" } }),
    )
    .toBe(scenarios.length);
  // Password sign-in allows 5 attempts a minute (lib/portal/auth.ts); the
  // sign-ins above count towards it, so a few wrong guesses reach the limit.
  const statuses: number[] = [];
  for (let i = 0; i < 6 && !statuses.includes(429); i++) {
    const attempt = await other.request.post("/api/auth/sign-in/email", {
      headers: { Origin: origin },
      data: { email: "owner@cedar.example", password: "wrong-password-123" },
    });
    statuses.push(attempt.status());
  }
  expect(statuses.at(-1)).toBe(429);
  expect(statuses.slice(0, -1).every((s) => s === 401)).toBeTruthy();
  await provider.close();
  await other.close();
});
