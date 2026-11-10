// The verified tick beside the merchant at checkout: shown once PayRouta has
// verified who the merchant is (an accepted ID and a clear screening), and
// nothing in its place otherwise (lib/merchant/requirements.ts).
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { createIntent, createSession } from "../../lib/payments/service";
import { fingerprint } from "../../lib/partners/kyb";

const asset = { kind: "blockchain", network: "eip155:84532", identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" };
test.afterAll(() => db.$disconnect());

async function store(name: string, verified: boolean) {
  const orgId = `tick-${randomUUID()}`;
  await db.organization.create({ data: { id: orgId, name, fictional: true } });
  await db.merchantConfig.create({ data: { orgId, returnOrigin: "http://127.0.0.1:3000" } });
  await db.integration.create({
    data: {
      orgId,
      environment: "sandbox",
      version: 1,
      config: json({ mode: "NATIVE", adapter: "erc20-deposit", environment: "sandbox", network: asset.network, identifier: asset.identifier, addresses: [`0x${randomBytes(20).toString("hex")}`], publicTestnetRpc: true }),
    },
  });
  const profile = { legalName: name, businessType: "individual", country: "NG", owners: [], monthlyVolume: "under-10k" };
  await db.merchantKybProfile.create({
    data: { orgId, version: 1, data: json(profile), fingerprint: fingerprint(profile as never), createdBy: "test" },
  });
  await db.merchantScreening.create({ data: { orgId, profileVersion: 1, provider: "sandbox-fixture", verdict: "clear", results: json([]), createdBy: "test" } });
  if (verified)
    await db.evidence.create({
      data: {
        orgId,
        requirementId: "req_onboarding_government_id",
        objectKey: `tick/${randomUUID()}`,
        filename: "id.png",
        mime: "image/png",
        size: 1,
        sha256: "0".repeat(64),
        metadata: json({}),
        scanStatus: "Clean",
        reviewStatus: "Accepted",
        retentionUntil: new Date(Date.now() + 86400000),
      },
    });
  const intent = await createIntent(orgId, randomUUID(), { reference: "Order 1042", amount: "40.000000", asset, precision: 6, methods: ["stablecoin"], settlement: asset, returnUrl: "http://127.0.0.1:3000/" });
  return createSession(orgId, intent.id);
}

test("checkout shows the verified tick only for a merchant PayRouta has verified", async ({ page }) => {
  const yes = await store("Adire House", true);
  await page.goto(yes.checkoutPath);
  await expect(page.getByRole("img", { name: "Verified by PayRouta" })).toBeVisible();
  const no = await store("Kola Market", false);
  await page.goto(no.checkoutPath);
  await expect(page.getByText("Kola Market")).toBeVisible();
  await expect(page.getByRole("img", { name: "Verified by PayRouta" })).toHaveCount(0);
});
