import "dotenv/config";
import { randomBytes } from "node:crypto";
import { db } from "../lib/portal/db";
import { localMode, secretManager } from "../lib/portal/adapters";
import { json } from "../lib/portal/service";
import { publishActivation } from "../lib/portal/registry";
import { refreshObservations } from "../lib/portal/provider-probes";
import { fixtureCapability, config } from "../tests/fixtures/providers";
export async function paymentFixtures() {
  if (
    !localMode() ||
    !["localhost", "127.0.0.1"].includes(
      new URL(process.env.DATABASE_URL!).hostname,
    )
  )
    throw new Error("Local fictional fixtures only");
  const merchant = "payment-demo-merchant";
  await db.organization.upsert({
    where: { id: merchant },
    create: {
      id: merchant,
      name: "Fictional Market",
      fictional: true,
      application: { create: {} },
    },
    update: {},
  });
  const user = await db.user.findUnique({ where: { id: "dev-owner" } });
  if (user)
    await db.membership.upsert({
      where: { orgId_userId: { orgId: merchant, userId: user.id } },
      create: {
        orgId: merchant,
        userId: user.id,
        role: "Owner",
        merchantRole: "Owner",
      },
      update: { merchantRole: "Owner" },
    });
  const ref = await secretManager.put("fictional-payment-webhook-secret-2026");
  await db.merchantConfig.upsert({
    where: { orgId: merchant },
    create: {
      orgId: merchant,
      returnOrigin: "http://127.0.0.1:3000",
      providerAllowlist: [
        "payment-demo-provider-0",
        "payment-demo-provider-1",
        "payment-demo-provider-2",
        "payment-demo-provider-3",
        "payment-demo-provider-4",
      ],
      webhookUrl: "local://payment-receiver",
      webhookSecretRef: ref,
    },
    update: {
      webhookSecretRef: ref,
      providerAllowlist: [
        "payment-demo-provider-0",
        "payment-demo-provider-1",
        "payment-demo-provider-2",
        "payment-demo-provider-3",
        "payment-demo-provider-4",
      ],
    },
  });
  await seedSandboxProviders(ref);
  return merchant;
}

// Five fictional simulator providers (bank ×2, card, mobile money,
// stablecoin) published to the sandbox registry. Used locally and, with
// HOSTED_SANDBOX=enabled, on a deployed sandbox.
export async function seedSandboxProviders(ref?: string) {
  ref ??= await secretManager.put(randomBytes(32).toString("hex"));
  for (let n = 0; n < 5; n++) {
    const orgId = `payment-demo-provider-${n}`;
    await db.organization.upsert({
      where: { id: orgId },
      create: {
        id: orgId,
        name: `Fictional payment provider ${n}`,
        fictional: true,
      },
      update: {},
    });
    const integration = await db.integration.upsert({
      where: {
        orgId_environment_version: {
          orgId,
          environment: "sandbox",
          version: 1,
        },
      },
      create: {
        id: `${orgId}-integration`,
        orgId,
        environment: "sandbox",
        version: 1,
        config,
      },
      update: {},
    });
    const app = await db.application.upsert({
      where: { orgId },
      create: { orgId, state: "Approved" },
      update: {},
    });
    const cap = fixtureCapability(orgId, n === 4);
    if (n === 2) {
      cap.family = "card";
      cap.rail = "card-network";
      cap.fulfillment!.method = "card";
    }
    if (n === 3) {
      cap.family = "mobile-money";
      cap.rail = "mobile-money-network";
      cap.fulfillment!.method = "mobile-money";
    }
    cap.fulfillment!.integrationId = integration.id;
    const snapshot = {
      draft: { capabilities: [cap] },
      integrations: [integration],
      requirements: [],
      evidence: [],
    };
    const sub = await db.submission.upsert({
      where: { applicationId_version: { applicationId: app.id, version: 1 } },
      create: {
        applicationId: app.id,
        version: 1,
        snapshot: json(snapshot),
        idempotencyKey: "payment-fixture",
      },
      update: {},
    });
    for (const [kind, decision] of [
      ["application", "Approved"],
      ["legal", "Passed"],
      ["technical", "Passed"],
    ])
      if (
        !(await db.review.findFirst({ where: { submissionId: sub.id, kind } }))
      )
        await db.review.create({
          data: {
            submissionId: sub.id,
            actorId: "fixture",
            kind,
            decision,
            reason: "Local fictional fixture",
          },
        });
    const activation = await db.activation.upsert({
      where: {
        orgId_environment_sequence: {
          orgId,
          environment: "sandbox",
          sequence: 1,
        },
      },
      create: {
        orgId,
        submissionId: sub.id,
        environment: "sandbox",
        state: "Active",
        action: "publish",
        reason: "Fictional sandbox fixture",
        actorId: "fixture",
        sequence: 1,
      },
      update: {},
    });
    await publishActivation(activation.id, `registry:${activation.id}`);
    if (
      !(await db.credential.findFirst({
        where: { orgId, kind: "payment-webhook" },
      }))
    )
      await db.credential.create({
        data: {
          orgId,
          environment: "sandbox",
          kind: "payment-webhook",
          label: "Fictional webhook verifier",
          secretRef: ref,
          backend: "local",
        },
      });
  }
  await refreshObservations();
}
if (process.argv[1]?.endsWith("payment-fixtures.ts"))
  paymentFixtures()
    .then(() => console.log("Fictional payment fixtures ready."))
    .finally(() => db.$disconnect());
