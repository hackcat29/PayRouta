// The merchant's logo: uploaded in Settings → Business, then shown on their
// customers' checkout from a key-addressed, nosniff image route. SVG and
// other files are refused (lib/merchant/branding.ts).
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { createOTP } from "@better-auth/utils/otp";
import AxeBuilder from "@axe-core/playwright";
import { db } from "../../lib/portal/db";
import { json } from "../../lib/portal/service";
import { createIntent, createSession } from "../../lib/payments/service";
import { treasuryMerchant } from "../fixtures/treasury";

const origin = process.env.PAYROUTA_TEST_ORIGIN ?? "http://127.0.0.1:3000";
const otp = () => createOTP("payrouta-fictional-totp-secret").totp();
// A 1×1 PNG.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const asset = { kind: "blockchain", network: "eip155:84532", identifier: "erc20:0x036cbd53842c5426634e7929541ec2318f3dcf7e" };
test.afterAll(() => db.$disconnect());

test("a merchant's logo appears on their checkout; SVG is refused", async ({ page }) => {
  const h = { Origin: origin };
  expect((await page.request.post("/api/auth/sign-in/email", { headers: h, data: { email: "owner@harbor.example", password: "PayRouta-Local-2026!" } })).ok()).toBeTruthy();
  expect((await page.request.post("/api/auth/two-factor/verify-totp", { headers: h, data: { code: await otp(), trustDevice: false } })).ok()).toBeTruthy();
  const { orgId, name } = await treasuryMerchant("owner@harbor.example", "fresh");

  await page.goto(`/merchant/settings?orgId=${orgId}&environment=sandbox`);
  await expect(page.getByRole("heading", { name: "Logo", exact: true })).toBeVisible();
  // An SVG with a script, renamed: refused by its bytes.
  await page.getByLabel("PNG, JPEG or WebP, up to 256 KB").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  const logoSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "Logo", exact: true }) });
  await expect(logoSection.getByRole("alert")).toHaveText("Upload the logo as a PNG, JPEG or WebP image.");
  await page.getByLabel("PNG, JPEG or WebP, up to 256 KB").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await expect(page.getByRole("img", { name: `${name} logo` })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations).toEqual([]);

  const logo = await db.merchantLogo.findUniqueOrThrow({ where: { orgId } });
  const served = await page.request.get(`/api/brand/${logo.key}`);
  expect(served.status()).toBe(200);
  expect(served.headers()["content-type"]).toBe("image/png");
  expect(served.headers()["x-content-type-options"]).toBe("nosniff");
  expect(Buffer.from(await served.body()).equals(png)).toBe(true);
  expect((await page.request.get(`/api/brand/${"0".repeat(32)}`)).status()).toBe(404);

  // The customer's checkout shows it, and the name links back to the store.
  await db.integration.create({
    data: {
      orgId,
      environment: "sandbox",
      version: 1,
      config: json({ mode: "NATIVE", adapter: "erc20-deposit", environment: "sandbox", network: asset.network, identifier: asset.identifier, addresses: [`0x${randomBytes(20).toString("hex")}`], publicTestnetRpc: true }),
    },
  });
  const intent = await createIntent(orgId, randomUUID(), { reference: "Order 7", amount: "5.000000", asset, precision: 6, methods: ["stablecoin"], settlement: asset, returnUrl: "http://127.0.0.1:3000/" });
  const session = await createSession(orgId, intent.id);
  const customer = await page.context().browser()!.newPage();
  await customer.goto(`${origin}${session.checkoutPath}`);
  const back = customer.getByRole("link", { name: `Back to ${name}` });
  await expect(back).toHaveAttribute("href", "http://127.0.0.1:3000/");
  await expect(back.locator("img")).toHaveAttribute("src", `/api/brand/${logo.key}`);
  await customer.close();

  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByRole("img", { name: `${name} logo` })).toHaveCount(0);
  expect(await db.merchantLogo.count({ where: { orgId } })).toBe(0);
});
