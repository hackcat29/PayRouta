import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/portal/db";
import {
  renderBaseTemplate,
  renderWelcomeEmail,
  renderDripRoutingTipsEmail,
  renderDripSettlementEmail,
  renderMarketingBroadcastEmail,
  renderMonthlyDigestEmail,
  renderTransactionReceiptEmail,
  renderSecurityAlertEmail,
  stripHtmlToText,
} from "../lib/email/templates";
import {
  sendEmail,
  sendBatchEmails,
  syncResendAudienceContact,
} from "../lib/email/resend-client";
import { MarketingService } from "../lib/email/marketing-service";

test("Email Templates: All templates render responsive HTML and clean plaintext", () => {
  // Base & Plaintext
  const baseHtml = renderBaseTemplate({
    headline: "Test Heading",
    bodyContent: "<p>Hello world from PayRouta routing</p>",
    ctaText: "Check Dashboard",
    ctaUrl: "https://payrouta.com/merchant",
    unsubscribeUrl: "https://payrouta.com/email/preferences?token=test_tok&action=unsub",
    preferencesUrl: "https://payrouta.com/email/preferences?token=test_tok",
  });
  assert.ok(baseHtml.includes("PayRouta"));
  assert.ok(baseHtml.includes("Hello world from PayRouta routing"));
  assert.ok(baseHtml.includes("Check Dashboard"));
  assert.ok(baseHtml.includes("Unsubscribe"));

  const baseText = stripHtmlToText(baseHtml);
  assert.ok(baseText.includes("Hello world from PayRouta routing"));
  assert.ok(!baseText.includes("<p>"));

  // Welcome Onboarding
  const welcome = renderWelcomeEmail({
    name: "Alex",
    role: "merchant",
    siteUrl: "https://payrouta.com",
    unsubscribeUrl: "https://payrouta.com/unsub",
  });
  assert.ok(welcome.subject.includes("Welcome to PayRouta"));
  assert.ok(welcome.html.includes("Alex"));
  assert.ok(welcome.html.includes("Open Merchant Dashboard"));
  assert.ok(welcome.text.length > 50);

  // Drip Day 3: Routing tips
  const dripDay3 = renderDripRoutingTipsEmail({
    name: "Sarah",
    siteUrl: "https://payrouta.com",
  });
  assert.ok(dripDay3.subject.includes("22%"));
  assert.ok(dripDay3.html.includes("Multi-Provider Redundancy"));

  // Drip Day 7: Settlement
  const dripDay7 = renderDripSettlementEmail({
    name: "Jordan",
    siteUrl: "https://payrouta.com",
  });
  assert.ok(dripDay7.subject.includes("Instant Global Settlement"));
  assert.ok(dripDay7.html.includes("Ondo USDY"));

  // Marketing Broadcast
  const broadcast = renderMarketingBroadcastEmail({
    headline: "Solana Pay Rails Now Live",
    bodyHtml: "<p>We have integrated Solana Pay for sub-cent gas fees.</p>",
    ctaText: "Enable in Dashboard",
    ctaUrl: "https://payrouta.com/merchant",
  });
  assert.ok(broadcast.html.includes("Solana Pay Rails Now Live"));
  assert.ok(broadcast.text.includes("sub-cent gas fees"));

  // Monthly Digest
  const digest = renderMonthlyDigestEmail({
    merchantName: "Acme Payments",
    month: "September 2026",
    totalVolume: "$1,450,000.00",
    totalTransactions: 12450,
    successRate: "99.4%",
    recoveredVolume: "$78,300.00",
    topRails: [
      { rail: "Paystack (NGN Cards)", volumePercent: "52%" },
      { rail: "Solana USDC", volumePercent: "31%" },
      { rail: "Flutterwave (M-Pesa)", volumePercent: "17%" },
    ],
  });
  assert.ok(digest.subject.includes("September 2026"));
  assert.ok(digest.html.includes("$1,450,000.00"));
  assert.ok(digest.html.includes("Paystack (NGN Cards)"));

  // Transaction Receipt
  const receipt = renderTransactionReceiptEmail({
    intentId: "pi_test_987654",
    amount: "150.00",
    currency: "USD",
    method: "USDC (Solana)",
    provider: "Native Solana Program",
    status: "succeeded",
    timestamp: "2026-10-08 00:00:00 UTC",
    txHashOrRef: "5Knp78g...x9L",
  });
  assert.ok(receipt.subject.includes("Payment Receipt for USD 150.00"));
  assert.ok(receipt.html.includes("pi_test_987654"));

  // Security Alert
  const alert = renderSecurityAlertEmail({
    name: "Operator",
    actionTitle: "Production API Key Generated",
    details: "A new live secret key (sec_live_...) was provisioned.",
    timestamp: "2026-10-08 00:00:00 UTC",
    ipAddress: "192.168.1.1",
  });
  assert.ok(alert.subject.includes("[Security Alert]"));
  assert.ok(alert.html.includes("Production API Key Generated"));
});

test("Resend Client: Mock & Fallback mode generates valid identifiers", async () => {
  const single = await sendEmail({
    to: "test@example.com",
    subject: "Test Send",
    html: "<p>Test</p>",
    text: "Test",
  });
  assert.equal(single.success, true);
  assert.ok(single.id);

  const batch = await sendBatchEmails([
    { to: "a@example.com", subject: "Batch 1", html: "<p>1</p>" },
    { to: "b@example.com", subject: "Batch 2", html: "<p>2</p>" },
  ]);
  assert.equal(batch.success, true);
  assert.equal(batch.ids.length, 2);

  const contact = await syncResendAudienceContact({
    email: "contact@example.com",
    firstName: "Test",
  });
  assert.equal(contact.success, true);
});

test("MarketingService: End-to-end subscriber lifecycle, drip, and campaign broadcast", async () => {
  const testEmail = `merchant_${Date.now()}_${Math.random().toString(36).substring(2, 6)}@payrouta.test`;

  // 1. Subscribe
  const sub = await MarketingService.subscribe({
    email: testEmail,
    name: "Test Merchant",
    role: "merchant",
    source: "unit_test",
    topics: ["product_updates", "weekly_digest"],
  });

  assert.equal(sub.email, testEmail);
  assert.equal(sub.status, "active");
  assert.ok(sub.unsubscribeToken);

  // Verify Day 0 Welcome log was recorded
  const welcomeLog = await db.marketingDeliveryLog.findFirst({
    where: { subscriberId: sub.id, templateId: "welcome_onboarding" },
  });
  assert.ok(welcomeLog);
  assert.equal(welcomeLog.email, testEmail);

  // Verify Day 0 Drip step scheduled Day 3
  const dripStep0 = await db.marketingDripStep.findUnique({
    where: {
      subscriberId_sequence_step: {
        subscriberId: sub.id,
        sequence: "merchant_onboarding",
        step: 0,
      },
    },
  });
  assert.ok(dripStep0);
  assert.equal(dripStep0.completed, true);
  assert.ok(dripStep0.nextStepAt);

  // 2. Preferences & Unsubscribe
  const fetchedSub = await MarketingService.getSubscriberByToken(sub.unsubscribeToken);
  assert.equal(fetchedSub?.email, testEmail);

  // Update topics
  const updatedTopics = await MarketingService.updateSubscriberPreferences(
    sub.unsubscribeToken,
    { topics: ["product_updates"] },
  );
  assert.deepEqual(updatedTopics.topics, ["product_updates"]);

  // 3. Campaign Drafting & Broadcasting
  const campaign = await MarketingService.createCampaign({
    name: "Automated Routing Update",
    subject: "Introducing Intelligent Failover Rules",
    previewText: "Zero downtime checkouts across African and global rails.",
    contentHtml: "<p>Automatic failover between Paystack and Flutterwave is now live.</p>",
    targetAudience: "merchants",
  });
  assert.equal(campaign.status, "draft");

  // Send test preview
  const testPreview = await MarketingService.sendTestCampaign(campaign.id, "preview@payrouta.test");
  assert.equal(testPreview.success, true);

  // Launch campaign
  const launchResult = await MarketingService.launchCampaign(campaign.id);
  assert.ok(launchResult.sent >= 1);

  const updatedCamp = await db.marketingCampaign.findUnique({
    where: { id: campaign.id },
  });
  assert.equal(updatedCamp?.status, "sent");
  assert.ok(updatedCamp?.sentAt);

  // 4. Webhook Handling
  // Find a delivery log for this campaign
  const campLog = await db.marketingDeliveryLog.findFirst({
    where: { campaignId: campaign.id },
  });

  if (campLog?.resendEmailId) {
    // Simulate email.opened event
    const openWebhook = await MarketingService.handleResendWebhookEvent({
      type: "email.opened",
      data: { email_id: campLog.resendEmailId },
    });
    assert.equal(openWebhook.processed, true);

    const refreshedCamp = await db.marketingCampaign.findUnique({
      where: { id: campaign.id },
    });
    assert.ok(refreshedCamp!.openCount >= 1);
  }

  // 5. Unsubscribe from all
  const unsubscribed = await MarketingService.updateSubscriberPreferences(
    sub.unsubscribeToken,
    { unsubscribeAll: true },
  );
  assert.equal(unsubscribed.status, "unsubscribed");

  // 6. Analytics check
  const analytics = await MarketingService.getMarketingAnalytics();
  assert.ok(analytics.subscribers.total >= 1);
  assert.ok(analytics.campaigns.total >= 1);
});

test("MarketingService: Drip Progression advances through Day 3 and Day 7", async () => {
  const dripUser = `drip_${Date.now()}@payrouta.test`;
  const sub = await MarketingService.subscribe({
    email: dripUser,
    name: "Drip Pioneer",
    role: "merchant",
    source: "drip_test",
  });

  // Fast forward nextStepAt for step 0 to the past
  await db.marketingDripStep.update({
    where: {
      subscriberId_sequence_step: {
        subscriberId: sub.id,
        sequence: "merchant_onboarding",
        step: 0,
      },
    },
    data: { nextStepAt: new Date(Date.now() - 10000) },
  });

  // Run scheduled drips
  const cycle1 = await MarketingService.processScheduledDrips();
  assert.ok(cycle1.processed >= 1);

  // Step 1 should now be recorded
  const step1 = await db.marketingDripStep.findUnique({
    where: {
      subscriberId_sequence_step: {
        subscriberId: sub.id,
        sequence: "merchant_onboarding",
        step: 1,
      },
    },
  });
  assert.ok(step1);
  assert.equal(step1.completed, true);
  assert.ok(step1.nextStepAt);

  // Fast forward step 1 to test step 2 (Day 7)
  await db.marketingDripStep.update({
    where: { id: step1.id },
    data: { nextStepAt: new Date(Date.now() - 10000) },
  });

  const cycle2 = await MarketingService.processScheduledDrips();
  assert.ok(cycle2.processed >= 1);

  const step2 = await db.marketingDripStep.findUnique({
    where: {
      subscriberId_sequence_step: {
        subscriberId: sub.id,
        sequence: "merchant_onboarding",
        step: 2,
      },
    },
  });
  assert.ok(step2);
  assert.equal(step2.completed, true);
});

test("Resend Webhooks: Bounce & spam complaints suppress recipient", async () => {
  const bounceEmail = `bounce_${Date.now()}@payrouta.test`;
  const sub = await MarketingService.subscribe({
    email: bounceEmail,
    role: "subscriber",
  });

  const log = await db.marketingDeliveryLog.findFirst({
    where: { subscriberId: sub.id },
  });

  if (log?.resendEmailId) {
    const bounceRes = await MarketingService.handleResendWebhookEvent({
      type: "email.bounced",
      data: { email_id: log.resendEmailId },
    });
    assert.equal(bounceRes.processed, true);

    const updatedSub = await db.marketingSubscriber.findUnique({
      where: { id: sub.id },
    });
    assert.equal(updatedSub?.status, "bounced");
  }
});

