import "dotenv/config";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/portal/db";
import {
  esc,
  renderBaseTemplate,
  renderWelcomeEmail,
  renderDripRoutingTipsEmail,
  renderDripSettlementEmail,
  renderMarketingBroadcastEmail,
  renderMonthlyDigestEmail,
  renderTransactionReceiptEmail,
  renderSecurityAlertEmail,
  renderVerifyEmail,
  renderResetPasswordEmail,
  renderInvitationEmail,
  stripHtmlToText,
} from "../lib/email/templates";
import { sendEmail, sendBatchEmails, syncResendContact, verifyResendWebhook } from "../lib/email/resend-client";
import { MarketingService } from "../lib/email/marketing-service";

// These tests use the simulated sender; never let them reach real Resend.
delete process.env.RESEND_API_KEY;

const unique = (prefix: string) =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}@payrouta.test`;

async function confirmed(email: string, extra: Partial<Parameters<typeof MarketingService.subscribe>[0]> = {}) {
  const sub = await MarketingService.subscribe({ email, ...extra });
  return (await MarketingService.confirm(sub.unsubscribeToken))!;
}

test("templates render HTML and plain text, and escape user-supplied values", () => {
  const html = renderBaseTemplate({
    headline: "Test heading",
    bodyContent: "<p>Hello from PayRouta</p>",
    ctaText: "Open dashboard",
    ctaUrl: "https://payrouta.com/merchant",
    unsubscribeUrl: "https://payrouta.com/email/preferences?token=t&action=unsub",
    preferencesUrl: "https://payrouta.com/email/preferences?token=t",
  });
  assert.ok(html.includes("Hello from PayRouta"));
  assert.ok(html.includes("Open dashboard"));
  assert.ok(html.includes("Unsubscribe"));
  const text = stripHtmlToText(html);
  assert.ok(text.includes("Hello from PayRouta"));
  assert.ok(!text.includes("<p>"));
  assert.ok(text.includes("Open dashboard (https://payrouta.com/merchant)"));

  assert.equal(esc(`<img src=x onerror="alert(1)">`), "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  const hostile = renderWelcomeEmail({ name: `<script>alert(1)</script> Smith`, role: "merchant" });
  assert.ok(!hostile.html.includes("<script>alert(1)</script>"));
  assert.ok(hostile.html.includes("&lt;script&gt;"));

  const welcome = renderWelcomeEmail({ name: "Ada Obi", role: "merchant", unsubscribeUrl: "https://x/u" });
  assert.equal(welcome.subject, "Welcome to PayRouta");
  assert.ok(welcome.html.includes("Hi Ada,"));
  assert.ok(welcome.text.length > 50);

  // Onboarding mail makes no invented performance claims.
  for (const email of [renderDripRoutingTipsEmail({}), renderDripSettlementEmail({})])
    assert.ok(!/\d+(\.\d+)?%/.test(email.text), email.subject);

  const broadcast = renderMarketingBroadcastEmail({ headline: "News", bodyHtml: "<p>Something shipped.</p>" });
  assert.ok(broadcast.text.includes("Something shipped."));

  const digest = renderMonthlyDigestEmail({
    merchantName: "Acme",
    month: "September 2026",
    totalVolume: "$1,450.00",
    totalTransactions: 12,
    successRate: "99.4%",
    recoveredVolume: "$78.00",
    topRails: [{ rail: "Cards", volumePercent: "52%" }],
  });
  assert.ok(digest.subject.includes("September 2026"));
  assert.ok(digest.html.includes("$1,450.00"));

  const receipt = renderTransactionReceiptEmail({
    intentId: "pi_test_987654",
    amount: "150.00",
    currency: "USD",
    method: "Card",
    provider: "sandbox",
    status: "succeeded",
    timestamp: "2026-10-08 00:00:00 UTC",
  });
  assert.ok(receipt.subject.includes("Payment Receipt for USD 150.00"));
  assert.ok(receipt.html.includes("pi_test_987654"));

  const alert = renderSecurityAlertEmail({ actionTitle: "API key created", details: "A live key was created.", timestamp: "now" });
  assert.ok(alert.subject.includes("[Security Alert]"));

  const verify = renderVerifyEmail({ name: "Ada", url: "https://payrouta.com/api/auth/verify-email?token=abc" });
  assert.ok(verify.text.includes("https://payrouta.com/api/auth/verify-email?token=abc"));
  assert.ok(!verify.html.includes("Unsubscribe"));
  const reset = renderResetPasswordEmail({ url: "https://payrouta.com/reset-password?token=abc" });
  assert.ok(reset.subject.includes("Reset"));
  const invite = renderInvitationEmail({ orgName: "Acme & Co", role: "Developer", url: "https://x/i", expires: "7 days" });
  assert.ok(invite.html.includes("Acme &amp; Co"));
});

test("simulated sending works outside production and fails closed in production", async () => {
  const single = await sendEmail({ to: "test@example.com", subject: "Test", html: "<p>Test</p>" });
  assert.equal(single.success, true);
  assert.equal(single.isMock, true);

  const batch = await sendBatchEmails([
    { to: "a@example.com", subject: "1", html: "<p>1</p>" },
    { to: "b@example.com", subject: "2", html: "<p>2</p>" },
  ]);
  assert.equal(batch.ids.length, 2);
  assert.equal((await syncResendContact({ email: "c@example.com" })).skipped, true);

  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = "production";
  try {
    const result = await sendEmail({ to: "test@example.com", subject: "Test", html: "<p>Test</p>" });
    assert.equal(result.success, false);
  } finally {
    env.NODE_ENV = previous;
  }
});

test("webhook verification rejects unsigned and wrongly signed requests", () => {
  process.env.RESEND_API_KEY = "re_test_key_for_verification_only";
  process.env.RESEND_WEBHOOK_SECRET = "whsec_" + Buffer.from("x".repeat(32)).toString("base64");
  try {
    assert.equal(verifyResendWebhook("{}", new Headers()), undefined);
    const headers = new Headers({
      "svix-id": "msg_1",
      "svix-timestamp": String(Math.floor(Date.now() / 1000)),
      "svix-signature": "v1,bm90LWEtcmVhbC1zaWduYXR1cmU=",
    });
    assert.equal(verifyResendWebhook(JSON.stringify({ type: "email.bounced", data: {} }), headers), undefined);

    // A correctly signed event (Standard Webhooks: HMAC-SHA256 of "id.timestamp.body").
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "e_1" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const key = Buffer.from(process.env.RESEND_WEBHOOK_SECRET!.slice(6), "base64");
    const sig = createHmac("sha256", key).update(`msg_2.${ts}.${body}`).digest("base64");
    const event = verifyResendWebhook(
      body,
      new Headers({ "svix-id": "msg_2", "svix-timestamp": ts, "svix-signature": `v1,${sig}` }),
    );
    assert.equal(event?.type, "email.delivered");
    // The same signature on a different body fails.
    assert.equal(
      verifyResendWebhook(body.replace("e_1", "e_2"), new Headers({ "svix-id": "msg_2", "svix-timestamp": ts, "svix-signature": `v1,${sig}` })),
      undefined,
    );
  } finally {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_WEBHOOK_SECRET;
  }
});

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
