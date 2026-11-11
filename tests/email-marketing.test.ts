import "dotenv/config";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
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

// These tests use the simulated sender; never let them reach real Resend.
delete process.env.RESEND_API_KEY;

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
