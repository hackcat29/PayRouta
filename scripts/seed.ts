import "dotenv/config";
import { hashPassword, symmetricEncrypt } from "better-auth/crypto";
import { randomUUID, createHash } from "node:crypto";
import { db } from "../lib/portal/db";
import { localMode, storage } from "../lib/portal/adapters";
import { json } from "../lib/portal/service";
import { CapabilityDefinition, Draft } from "../lib/portal/domain";
async function main() {
  if (
    !localMode() ||
    !new URL(process.env.DATABASE_URL!).hostname.match(
      /^(127\.0\.0\.1|localhost)$/,
    )
  )
    throw new Error(
      "Seed is restricted to explicit local mode and a loopback database",
    );
  const password = await hashPassword("PayRouta-Local-2026!");
  const secret = await symmetricEncrypt({
    key: process.env.BETTER_AUTH_SECRET!,
    data: "payrouta-fictional-totp-secret",
  });
  const backupCodes = await symmetricEncrypt({
    key: process.env.BETTER_AUTH_SECRET!,
    data: JSON.stringify(["123456"]),
  });
  const users = [
    {
      id: "dev-owner",
      email: "owner@harbor.example",
      name: "Amara Okafor",
      role: "Owner",
      orgId: "harbor",
      internalRole: null,
    },
    {
      id: "dev-developer",
      email: "developer@harbor.example",
      name: "Kelechi Eze",
      role: "Developer",
      orgId: "harbor",
      internalRole: null,
    },
    {
      id: "dev-compliance",
      email: "compliance@harbor.example",
      name: "Zainab Bello",
      role: "Compliance",
      orgId: "harbor",
      internalRole: null,
    },
    {
      id: "dev-analyst",
      email: "analyst@harbor.example",
      name: "David Cole",
      role: "Analyst",
      orgId: "harbor",
      internalRole: null,
    },
    {
      id: "dev-other",
      email: "owner@cedar.example",
      name: "Nia Mensah",
      role: "Owner",
      orgId: "cedar",
      internalRole: null,
    },
    {
      id: "dev-reviewer",
      email: "reviewer@payrouta.example",
      name: "Review Operator",
      role: "Analyst",
      orgId: "harbor",
      internalRole: "Reviewer",
    },
    {
      id: "dev-ops",
      email: "ops@payrouta.example",
      name: "Operations Admin",
      role: "Owner",
      orgId: "harbor",
      internalRole: "Operations admin",
    },
  ];
  for (const org of [
    { id: "harbor", name: "Harbor Payments" },
    { id: "cedar", name: "Cedar Mobile Money" },
  ])
    await db.organization.upsert({
      where: { id: org.id },
      create: { ...org, fictional: true, application: { create: {} } },
      update: {},
    });
  for (const u of users) {
    await db.user.upsert({
      where: { id: u.id },
      create: {
        id: u.id,
        email: u.email,
        name: u.name,
        emailVerified: true,
        twoFactorEnabled: true,
        internalRole: u.internalRole,
      },
      update: {},
    });
    await db.account.upsert({
      where: { id: `account-${u.id}` },
      create: {
        id: `account-${u.id}`,
        userId: u.id,
        accountId: u.id,
        providerId: "credential",
        password,
      },
      update: {},
    });
    await db.twoFactor.upsert({
      where: { id: `factor-${u.id}` },
      create: {
        id: `factor-${u.id}`,
        userId: u.id,
        secret,
        backupCodes,
        verified: true,
      },
      update: {},
    });
    await db.membership.upsert({
      where: { orgId_userId: { orgId: u.orgId, userId: u.id } },
      create: { orgId: u.orgId, userId: u.id, role: u.role },
      update: {},
    });
  }
  const requirement = await db.requirement.upsert({
    where: {
      templateId_version: {
        templateId: "illustrative-registration",
        version: 1,
      },
    },
    create: {
      templateId: "illustrative-registration",
      version: 1,
      name: "Company registration evidence",
      scope: {},
      illustrative: true,
    },
    update: {},
  });
  const cap: CapabilityDefinition = {
    capabilityId: "ng-bank-payin",
    version: 1,
    family: "bank",
    rail: "NIBSS bank transfer",
    operation: "pay-in",
    origin: "NG",
    destination: "NG",
    input: { kind: "fiat", identifier: "NGN", network: "" },
    minimum: "100",
    maximum: "1000000",
    daily: "5000000",
    limitAsset: "NGN",
    settlement: "T+1 business day",
    hours: "Monday–Friday 09:00–17:00",
    timezone: "Africa/Lagos",
    availability: "webhook",
    conditions: "Verified customer",
    endpoint: "bank.payin",
    environment: "sandbox",
  };
  const integration = {
    adapter: "simulator" as const,
    mode: "NATIVE" as const,
    maintainedBy: "PAYROUTA" as const,
    baseUrl: "",
    auth: "bearer" as const,
    mappings: "bank.payin → /payments",
    healthPath: "/health",
    events: "webhook" as const,
    signing: "HMAC-SHA256" as const,
    timeoutMs: 8000,
    retries: 0,
  };
  const draft: Draft = {
    company: {
      legalName: "Harbor Payments Limited (Fictional)",
      tradingName: "Harbor Payments",
      website: "https://harbor.example",
      country: "NG",
      registration: "FICTIONAL-NG-001",
      address: "1 Fictional Street, Lagos, Nigeria",
      providerType: "PSP",
      description:
        "Fictional provider for local development and review testing.",
      businessContact: "business@harbor.example",
      technicalContact: "developer@harbor.example",
      complianceContact: "compliance@harbor.example",
    },
    coverage: {
      payerOrigins: ["NG"],
      merchantDestinations: ["NG"],
      jurisdictions: ["NG"],
      payIn: ["NG"],
      payout: [],
    },
    capabilities: [cap],
    settlement: {
      assets: [{ kind: "fiat", identifier: "NGN", network: "" }],
      countries: ["NG"],
      schedule: "Business days, T+1",
      minHours: 1,
      maxHours: 24,
      cutoff: "17:00",
      timezone: "Africa/Lagos",
      holidays: "Nigerian public holidays",
      fees: "Quoted per operation",
      reconciliation: "HBR-{date}-{reference}",
      reporting: "Signed webhook plus daily report",
    },
    integration,
  };
  const app = await db.application.findUniqueOrThrow({
    where: { orgId: "harbor" },
  });
  if (app.version === 1 && Object.keys(app.draft as object).length === 0)
    await db.application.update({
      where: { id: app.id },
      data: { draft: json(draft) },
    });
  await db.integration.upsert({
    where: {
      orgId_environment_version: {
        orgId: "harbor",
        environment: "sandbox",
        version: 1,
      },
    },
    create: {
      orgId: "harbor",
      environment: "sandbox",
      version: 1,
      config: json(integration),
    },
    update: {},
  });
  await db.capability.upsert({
    where: {
      orgId_capabilityId_version_environment: {
        orgId: "harbor",
        capabilityId: cap.capabilityId,
        version: 1,
        environment: "sandbox",
      },
    },
    create: {
      orgId: "harbor",
      capabilityId: cap.capabilityId,
      version: 1,
      environment: "sandbox",
      definition: json(cap),
    },
    update: {},
  });
  if (
    !(await db.evidence.findFirst({
      where: { orgId: "harbor", scanStatus: "Fixture only" },
    }))
  ) {
    const objectKey = randomUUID();
    const content = Buffer.from(
      "%PDF-1.4\nFICTIONAL FIXTURE ONLY. NOT A REAL DOCUMENT.\n%%EOF",
    );
    await storage.put(objectKey, content, "application/pdf");
    await db.evidence.create({
      data: {
        orgId: "harbor",
        requirementId: requirement.id,
        objectKey,
        filename: "fictional-registration.pdf",
        mime: "application/pdf",
        size: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
        metadata: {
          documentType: "Illustrative registration",
          jurisdiction: "NG",
          identifier: "FICTIONAL-001",
        },
        scanStatus: "Fixture only",
        reviewStatus: "Pending review",
        expiresAt: new Date(Date.now() + 180 * 86400000),
        retentionUntil: new Date(Date.now() + 90 * 86400000),
      },
    });
  }
  for (let i = 0; i < 18; i++) {
    const createdAt = new Date(Date.now() - (i + 1) * 3600000);
    const status =
      i % 7 === 0 ? "Failed" : i % 5 === 0 ? "Uncertain" : "Confirmed";
    const transaction = await db.transaction.upsert({
      where: {
        orgId_environment_reference: {
          orgId: "harbor",
          environment: "sandbox",
          reference: `SBX-HBR-${String(1001 + i)}`,
        },
      },
      create: {
        orgId: "harbor",
        environment: "sandbox",
        reference: `SBX-HBR-${1001 + i}`,
        method: "Bank transfer",
        operation: "pay-in",
        amount: `${2500 + i * 125}.00`,
        asset: "NGN",
        executionState: status,
        latencyMs: status === "Confirmed" ? 350 + i * 23 : null,
        failureCategory:
          status === "Failed"
            ? "Provider unavailable"
            : status === "Uncertain"
              ? "Timeout — reconciliation required"
              : null,
        createdAt,
        timeline: json([
          {
            at: createdAt.toISOString(),
            action: "Intent created",
            result: "Fictional NGN bank-transfer payment intent",
          },
          {
            at: new Date(createdAt.getTime() + 100).toISOString(),
            action: "Availability evaluated",
            result: "Bank transfer available; customer selected this method",
          },
          {
            at: new Date(createdAt.getTime() + 200).toISOString(),
            action: "Eligible provider selected",
            result: "Harbor selected within bank transfer",
          },
          {
            at: new Date(createdAt.getTime() + 600).toISOString(),
            action: status,
            result:
              status === "Uncertain"
                ? "No retry issued. Reconcile status before another execution decision."
                : "Local simulator result; no funds moved",
          },
        ]),
      },
      update: {},
    });
    if (
      status === "Confirmed" &&
      !(await db.settlement.findFirst({
        where: { transactionId: transaction.id },
      }))
    )
      await db.settlement.create({
        data: {
          orgId: "harbor",
          environment: "sandbox",
          transactionId: transaction.id,
          state: i % 3 === 0 ? "Pending" : "Completed",
          reference: `HBR-SBX-SET-${1001 + i}`,
          amount: transaction.amount,
          asset: "NGN",
          createdAt,
          completedAt:
            i % 3 === 0 ? null : new Date(createdAt.getTime() + 1800000),
        },
      });
  }
  await db.integrationEvent.upsert({
    where: {
      orgId_environment_eventId: {
        orgId: "harbor",
        environment: "sandbox",
        eventId: "fixture-event-001",
      },
    },
    create: {
      orgId: "harbor",
      environment: "sandbox",
      eventId: "fixture-event-001",
      type: "Settlement completed",
      state: "Processed",
      summary: "Fictional settlement event applied once; duplicate ignored",
    },
    update: {},
  });
  console.log(
    "Fictional local data ready. Accounts and review instructions: docs/PROVIDER-PORTAL.md. Existing drafts were preserved.",
  );
}
main()
  .then(() => db.$disconnect())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
