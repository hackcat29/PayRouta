// Database tests for marketing email (needs PostgreSQL: npm run portal:db).
// Rendering, sending and webhook checks that need no database are in
// tests/email-marketing.test.ts.
import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../../lib/portal/db";
import { MarketingService } from "../../lib/email/marketing-service";

// These tests use the simulated sender; never let them reach real Resend.
delete process.env.RESEND_API_KEY;

const unique = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@payrouta.test`;

async function confirmed(email: string, extra: Partial<Parameters<typeof MarketingService.subscribe>[0]> = {}) {
  const sub = await MarketingService.subscribe({ email, ...extra });
  return (await MarketingService.confirm(sub.unsubscribeToken))!;
}

test("public sign-ups need confirmation; unsubscribes are never silently undone", async () => {
  const email = unique("optin");
  const sub = await MarketingService.subscribe({ email, name: "Test Merchant", role: "merchant", topics: ["product_updates", "bogus"] });
  assert.equal(sub.status, "pending");
  assert.deepEqual(sub.topics, ["product_updates"]);
  assert.ok(sub.unsubscribeToken.length >= 32);
  assert.ok(await db.marketingDeliveryLog.findFirst({ where: { subscriberId: sub.id, templateId: "confirm_subscription" } }));
  assert.equal(await db.marketingDeliveryLog.count({ where: { subscriberId: sub.id, templateId: "welcome_onboarding" } }), 0);

  const active = await MarketingService.confirm(sub.unsubscribeToken);
  assert.equal(active?.status, "active");
  assert.ok(await db.marketingDeliveryLog.findFirst({ where: { subscriberId: sub.id, templateId: "welcome_onboarding" } }));
  // Clicking the link twice sends nothing more.
  await MarketingService.confirm(sub.unsubscribeToken);
  assert.equal(await db.marketingDeliveryLog.count({ where: { subscriberId: sub.id, templateId: "welcome_onboarding" } }), 1);

  const updated = await MarketingService.updateSubscriberPreferences(sub.unsubscribeToken, { topics: ["weekly_digest"] });
  assert.deepEqual(updated.topics, ["weekly_digest"]);

  const gone = await MarketingService.updateSubscriberPreferences(sub.unsubscribeToken, { unsubscribeAll: true });
  assert.equal(gone.status, "unsubscribed");
  // A workspace sign-up (already-verified address) must not resubscribe them.
  const again = await MarketingService.subscribe({ email, confirmed: true, source: "merchant_workspace_created" });
  assert.equal(again.status, "unsubscribed");

  // A verified account owner who never unsubscribed is active straight away.
  const owner = await MarketingService.subscribe({ email: unique("owner"), role: "merchant", confirmed: true });
  assert.equal(owner.status, "active");
});

test("campaigns reach active subscribers once, filtered by topic", async () => {
  const a = await confirmed(unique("camp_a"), { role: "merchant", topics: ["developer_advisories"] });
  const b = await confirmed(unique("camp_b"), { role: "merchant", topics: ["product_updates"] });
  const pending = await MarketingService.subscribe({ email: unique("camp_pending"), role: "merchant", topics: ["developer_advisories"] });

  const campaign = await MarketingService.createCampaign({
    name: "API change",
    subject: "A change to the payments API",
    contentHtml: "<p>Details.</p>",
    targetAudience: "merchants",
    targetTopics: ["developer_advisories"],
  });
  assert.equal(campaign.status, "draft");
  assert.equal((await MarketingService.sendTestCampaign(campaign.id, "preview@payrouta.test")).success, true);

  const result = await MarketingService.launchCampaign(campaign.id);
  assert.equal(result.failed, 0);
  const reached = new Set(
    (await db.marketingDeliveryLog.findMany({ where: { campaignId: campaign.id } })).map((l) => l.subscriberId),
  );
  assert.ok(reached.has(a.id));
  assert.ok(!reached.has(b.id));
  assert.ok(!reached.has(pending.id));
  assert.equal((await db.marketingCampaign.findUnique({ where: { id: campaign.id } }))?.status, "sent");
  await assert.rejects(MarketingService.launchCampaign(campaign.id), /already been sent/);

  // Webhook statuses only move forward; each recipient's open counts once.
  const log = (await db.marketingDeliveryLog.findFirst({ where: { campaignId: campaign.id, subscriberId: a.id } }))!;
  await MarketingService.handleResendWebhookEvent({ type: "email.opened", data: { email_id: log.resendEmailId! } });
  await MarketingService.handleResendWebhookEvent({ type: "email.opened", data: { email_id: log.resendEmailId! } });
  await MarketingService.handleResendWebhookEvent({ type: "email.delivered", data: { email_id: log.resendEmailId! } });
  assert.equal((await db.marketingDeliveryLog.findUnique({ where: { id: log.id } }))?.status, "opened");
  assert.equal((await db.marketingCampaign.findUnique({ where: { id: campaign.id } }))?.openCount, 1);

  const analytics = await MarketingService.getMarketingAnalytics();
  assert.ok(analytics.subscribers.pending >= 1);
});

test("onboarding emails advance on schedule and stop for unsubscribed people", async () => {
  const sub = await confirmed(unique("drip"), { name: "Drip Pioneer", role: "merchant" });
  const due = () => new Date(Date.now() - 10_000);
  const step = (n: number) =>
    db.marketingDripStep.findUnique({
      where: { subscriberId_sequence_step: { subscriberId: sub.id, sequence: "merchant_onboarding", step: n } },
    });

  await db.marketingDripStep.update({ where: { id: (await step(0))!.id }, data: { nextStepAt: due() } });
  assert.ok((await MarketingService.processScheduledDrips()).processed >= 1);
  const step1 = await step(1);
  assert.ok(step1?.nextStepAt);

  await MarketingService.updateSubscriberPreferences(sub.unsubscribeToken, { unsubscribeAll: true });
  await db.marketingDripStep.update({ where: { id: step1.id }, data: { nextStepAt: due() } });
  await MarketingService.processScheduledDrips();
  assert.equal(await step(2), null);
});

test("bounces and complaints suppress the address", async () => {
  const sub = await confirmed(unique("bounce"));
  const log = (await db.marketingDeliveryLog.findFirst({ where: { subscriberId: sub.id, templateId: "welcome_onboarding" } }))!;

  // A temporary bounce (full mailbox) does not suppress.
  await MarketingService.handleResendWebhookEvent({
    type: "email.bounced",
    data: { email_id: log.resendEmailId!, to: [sub.email], bounce: { type: "Transient" } },
  });
  assert.equal((await db.marketingSubscriber.findUnique({ where: { id: sub.id } }))?.status, "active");

  await MarketingService.handleResendWebhookEvent({
    type: "email.bounced",
    data: { email_id: log.resendEmailId!, to: [sub.email], bounce: { type: "Permanent" } },
  });
  assert.equal((await db.marketingSubscriber.findUnique({ where: { id: sub.id } }))?.status, "bounced");
  // Choosing topics again can't reactivate a bounced address.
  const after = await MarketingService.updateSubscriberPreferences(sub.unsubscribeToken, { topics: ["product_updates"] });
  assert.equal(after.status, "bounced");
});
