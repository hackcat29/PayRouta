// Payment links under the launch scope: a merchant with no website shares a
// link; each customer who presses Pay gets their own checkout.
Object.assign(process.env, { NODE_ENV: "test" });
delete process.env.PAYMENT_TEST_LEGACY_METHODS;
import "dotenv/config";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/portal/db";
import { enforceLaunchScope } from "../../lib/payments/launch";
import { linkAmount, newSlug, paymentLinkInput, publicPaymentLink, startPaymentLinkCheckout } from "../../lib/merchant/payment-links";
import { methods, progress } from "../../lib/payments/service";
import { liveMerchant, sandboxEntity } from "../fixtures/live-merchant";

let orgId: string;

before(async () => {
  if (!process.env.DATABASE_URL?.includes("127.0.0.1:55432/payrouta") || process.env.PORTAL_MODE !== "local")
    throw new Error("Requires isolated local fixtures");
  assert.equal(enforceLaunchScope(), true);
  const { entityId, accounts } = await sandboxEntity("Links", ["sandbox-platform", "sandbox-credit"]);
  orgId = await liveMerchant(entityId, [accounts["sandbox-platform"], accounts["sandbox-credit"]], "GBP");
});
after(() => db.$disconnect());

const link = (over: object = {}) =>
  db.paymentLink.create({
    data: {
      orgId,
      environment: "sandbox",
      slug: newSlug(),
      title: "Handmade bag",
      amount: "120.00",
      currency: "GBP",
      methods: ["card", "bnpl"],
      country: "GB",
      createdBy: "test",
      ...over,
    },
  });

test("payment links: input rules", () => {
  assert.equal(linkAmount("150000", "NGN"), "150000.00");
  assert.equal(linkAmount("19.9", "USD"), "19.90");
  assert.equal(linkAmount("1500", "JPY"), "1500");
  assert.throws(() => linkAmount("1.234", "USD"), /INVALID_AMOUNT/);
  assert.throws(() => linkAmount("0", "USD"), /INVALID_AMOUNT/);
  assert.equal(paymentLinkInput.safeParse({ title: "x", amount: "1", currency: "USD", country: "US" }).success, false, "needs a way to pay");
  assert.match(newSlug(), /^[A-Za-z0-9]{10}$/);
});

test("payment links: each customer gets their own checkout, back to PayRouta's thank-you page", async () => {
  const l = await link();
  const first = await startPaymentLinkCheckout(l.slug, { ip: "203.0.113.1", country: "NG" });
  const second = await startPaymentLinkCheckout(l.slug, { ip: "203.0.113.2", country: null });
  assert.notEqual(first, second);
  for (const [url, country] of [[first, "NG"], [second, "GB"]] as const) {
    const u = new URL(url);
    const id = u.pathname.split("/")[2];
    const token = u.hash.slice(1);
    const p = await progress(id, token);
    assert.equal(p.amount, "120.00");
    assert.match(p.returnUrl, new RegExp(`/pay/${l.slug}/done$`));
    const session = await db.checkoutSession.findUniqueOrThrow({ where: { id }, include: { intent: true } });
    const ctx = await db.availabilityContext.findUniqueOrThrow({ where: { id: session.intent.contextId } });
    assert.equal((ctx.context as { payerCountry?: string }).payerCountry, country, "visitor's country, else the link's");
    assert.deepEqual(
      (await methods(id, token)).methods.map((m: { method: string }) => m.method),
      ["card", "bnpl"],
    );
  }
  assert.equal((await db.paymentLink.findUniqueOrThrow({ where: { id: l.id } })).checkouts, 2);
});

test("payment links: a link that's off opens nothing", async () => {
  const l = await link({ active: false });
  assert.equal(await publicPaymentLink(l.slug), null);
  await assert.rejects(startPaymentLinkCheckout(l.slug, { ip: "203.0.113.3" }), /PAYMENT_LINK_UNAVAILABLE/);
  assert.equal(await publicPaymentLink("../etc"), null);
});
