import { randomBytes } from "node:crypto";
import { db } from "@/lib/portal/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  sendEmail,
  sendBatchEmails,
  syncResendContact,
  isResendConfigured,
  type ResendWebhookEvent,
} from "./resend-client";
import {
  renderWelcomeEmail,
  renderDripRoutingTipsEmail,
  renderDripSettlementEmail,
  renderMarketingBroadcastEmail,
  renderConfirmSubscriptionEmail,
  stripHtmlToText,
} from "./templates";

export const MARKETING_TOPICS = [
  { id: "product_updates", label: "Product updates", default: true },
  { id: "weekly_digest", label: "Monthly round-up", default: true },
  { id: "developer_advisories", label: "API changes and deprecations", default: true },
  { id: "market_insights", label: "Guides on local payment methods", default: false },
] as const;

export type TopicId = (typeof MARKETING_TOPICS)[number]["id"];
const topicIds = new Set<string>(MARKETING_TOPICS.map((t) => t.id));
const defaultTopics = MARKETING_TOPICS.filter((t) => t.default).map((t) => t.id);

// Subscriber states. Only "active" subscribers receive marketing mail.
// "pending" waits for the double opt-in click; "bounced" and "complained" are
// set by Resend webhooks and are never reactivated automatically.
export type SubscriberStatus = "pending" | "active" | "unsubscribed" | "bounced" | "complained";

export interface SubscribeInput {
  email: string;
  name?: string;
  orgId?: string;
  role?: "subscriber" | "merchant" | "developer" | "provider";
  source?: string;
  topics?: string[];
  metadata?: Record<string, unknown>;
  sendWelcome?: boolean;
  // The address is already proven (a verified PayRouta account), so the
  // confirmation email is skipped. Public sign-ups must leave this false.
  confirmed?: boolean;
}

export interface CampaignInput {
  name: string;
  subject: string;
  previewText?: string;
  templateId?: string;
  targetAudience?: "all" | "merchants" | "developers" | "providers";
  targetTopics?: string[];
  contentHtml: string;
  contentText?: string;
  createdBy?: string;
}

type Subscriber = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  status: string;
  unsubscribeToken: string;
  metadata: Prisma.JsonValue;
};

const DAY = 86_400_000;
const RESEND_CONFIRMATION_AFTER = 10 * 60_000;
const newToken = () => randomBytes(24).toString("base64url");
const validTopics = (topics?: unknown) =>
  Array.isArray(topics) ? topics.filter((t): t is string => typeof t === "string" && topicIds.has(t)) : [];
const meta = (s: { metadata: Prisma.JsonValue }) =>
  (s.metadata && typeof s.metadata === "object" && !Array.isArray(s.metadata)
    ? s.metadata
    : {}) as Record<string, unknown>;

// The onboarding sequence: step 0 is sent on confirmation, later steps by the worker.
const ONBOARDING = "merchant_onboarding";
const onboardingSteps = [
  { templateId: "welcome_onboarding", afterDays: 0 },
  { templateId: "drip_routing_tips", afterDays: 3 },
  { templateId: "drip_settlement", afterDays: 4 },
] as const;

export class MarketingService {
  private static get siteUrl() {
    return process.env.SITE_URL || "https://payrouta.com";
  }

  static links(token: string) {
    const site = this.siteUrl;
    const t = encodeURIComponent(token);
    return {
      preferences: `${site}/email/preferences?token=${t}`,
      unsubscribe: `${site}/email/preferences?token=${t}&action=unsub`,
      confirm: `${site}/email/preferences?token=${t}&action=confirm`,
      oneClick: `${site}/api/marketing/unsubscribe?token=${t}`,
    };
  }

  // RFC 8058 one-click unsubscribe, required by Gmail and Yahoo for bulk mail.
  static unsubscribeHeaders(token: string) {
    return {
      "List-Unsubscribe": `<${this.links(token).oneClick}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }

  /**
   * Public sign-ups get a confirmation email and stay "pending" until the
   * link is clicked. People who unsubscribed, bounced or complained are never
   * reactivated without a fresh confirmation. The return value is the same
   * whether or not the address was already known.
   */
  static async subscribe(input: SubscribeInput) {
    const email = input.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new Error("Invalid email address provided");
    const chosen = validTopics(input.topics);
    const topics = chosen.length ? chosen : defaultTopics;
    const name = input.name?.trim().slice(0, 120) || undefined;

    let subscriber = await db.marketingSubscriber.findUnique({ where: { email } });

    if (!subscriber) {
      subscriber = await db.marketingSubscriber.create({
        data: {
          email,
          name,
          orgId: input.orgId,
          role: input.role || "subscriber",
          source: input.source || "landing_page",
          topics,
          status: input.confirmed ? "active" : "pending",
          unsubscribeToken: newToken(),
          metadata: {
            ...(input.metadata ?? {}),
            ...(input.confirmed ? { confirmedAt: new Date().toISOString(), confirmedBy: input.source } : {}),
          } as Prisma.InputJsonObject,
        },
      });
      if (input.confirmed) await this.activated(subscriber, input.sendWelcome !== false);
      else await this.sendConfirmation(subscriber);
      return subscriber;
    }

    // Known address. Fill in missing details, but never overwrite a status the
    // person (or their mailbox) chose.
    subscriber = await db.marketingSubscriber.update({
      where: { id: subscriber.id },
      data: {
        name: subscriber.name || name,
        orgId: subscriber.orgId || input.orgId,
        role: subscriber.role === "subscriber" && input.role ? input.role : subscriber.role,
      },
    });
    if (subscriber.status === "pending" || (subscriber.status === "unsubscribed" && !input.confirmed))
      await this.sendConfirmation(subscriber);
    return subscriber;
  }

  private static async sendConfirmation(subscriber: Subscriber) {
    const m = meta(subscriber);
    const last = typeof m.confirmationSentAt === "string" ? Date.parse(m.confirmationSentAt) : 0;
    if (Date.now() - last < RESEND_CONFIRMATION_AFTER) return;
    const rendered = renderConfirmSubscriptionEmail({
      name: subscriber.name,
      url: this.links(subscriber.unsubscribeToken).confirm,
    });
    const res = await sendEmail({
      to: subscriber.email,
      ...rendered,
      tags: [{ name: "type", value: "subscription_confirmation" }],
    });
    await db.marketingSubscriber.update({
      where: { id: subscriber.id },
      data: {
        metadata: { ...m, confirmationSentAt: new Date().toISOString() } as Prisma.InputJsonObject,
      },
    });
    await this.log(subscriber, "confirmation", "confirm_subscription", res);
  }

  /** Double opt-in click. Returns the subscriber, or undefined for an unknown token. */
  static async confirm(token: string) {
    const subscriber = await db.marketingSubscriber.findUnique({ where: { unsubscribeToken: token } });
    if (!subscriber) return undefined;
    if (subscriber.status !== "pending" && subscriber.status !== "unsubscribed") return subscriber;
    const updated = await db.marketingSubscriber.update({
      where: { id: subscriber.id },
      data: {
        status: "active",
        topics: validTopics(subscriber.topics).length ? subscriber.topics! : defaultTopics,
        metadata: { ...meta(subscriber), confirmedAt: new Date().toISOString() } as Prisma.InputJsonObject,
      },
    });
    const started = await db.marketingDripStep.findFirst({
      where: { subscriberId: updated.id, sequence: ONBOARDING },
    });
    await this.activated(updated, !started);
    return updated;
  }

  private static async activated(subscriber: Subscriber, startOnboarding: boolean) {
    const [firstName, ...rest] = (subscriber.name || "").split(" ");
    const synced = await syncResendContact({
      email: subscriber.email,
      firstName: firstName || undefined,
      lastName: rest.join(" ") || undefined,
      unsubscribed: false,
    });
    if (synced.contactId)
      await db.marketingSubscriber.update({
        where: { id: subscriber.id },
        data: { resendContactId: synced.contactId },
      });
    if (startOnboarding) await this.sendOnboardingStep(subscriber, 0);
  }

  private static render(templateId: string, subscriber: Subscriber) {
    const links = this.links(subscriber.unsubscribeToken);
    const common = {
      name: subscriber.name || undefined,
      siteUrl: this.siteUrl,
      preferencesUrl: links.preferences,
      unsubscribeUrl: links.unsubscribe,
    };
    if (templateId === "welcome_onboarding")
      return renderWelcomeEmail({
        ...common,
        role: subscriber.role as "merchant" | "developer" | "provider" | "subscriber",
      });
    if (templateId === "drip_routing_tips") return renderDripRoutingTipsEmail(common);
    return renderDripSettlementEmail(common);
  }

  private static async sendOnboardingStep(subscriber: Subscriber, step: number) {
    const def = onboardingSteps[step];
    const next = onboardingSteps[step + 1];
    // Claim the step first, so two workers can never send it twice.
    try {
      await db.marketingDripStep.create({
        data: {
          subscriberId: subscriber.id,
          sequence: ONBOARDING,
          step,
          sentAt: new Date(),
          nextStepAt: next ? new Date(Date.now() + next.afterDays * DAY) : null,
          completed: true,
        },
      });
    } catch {
      return false;
    }
    const rendered = this.render(def.templateId, subscriber);
    const res = await sendEmail({
      to: subscriber.email,
      ...rendered,
      tags: [
        { name: "type", value: "drip" },
        { name: "step", value: def.templateId },
      ],
      headers: this.unsubscribeHeaders(subscriber.unsubscribeToken),
      idempotencyKey: `drip/${subscriber.id}/${ONBOARDING}/${step}`,
    });
    await this.log(subscriber, "drip", def.templateId, res, { step, sequence: ONBOARDING });
    return true;
  }

  private static async log(
    subscriber: { id: string; email: string },
    type: string,
    templateId: string,
    res: { success: boolean; id?: string; error?: string; isMock?: boolean },
    metadata: Record<string, unknown> = {},
    campaignId?: string,
  ) {
    await db.marketingDeliveryLog.create({
      data: {
        subscriberId: subscriber.id,
        campaignId,
        email: subscriber.email,
        type,
        templateId,
        resendEmailId: res.id,
        status: res.success ? (res.isMock ? "simulated" : "sent") : "failed",
        errorMessage: res.error,
        metadata: metadata as Prisma.InputJsonObject,
      },
    });
    if (res.success)
      await db.marketingSubscriber.update({
        where: { id: subscriber.id },
        data: { lastEmailedAt: new Date() },
      });
  }

  /** Sends every onboarding step that is due. Run by the worker every cycle. */
  static async processScheduledDrips() {
    let processed = 0;
    for (let step = 1; step < onboardingSteps.length; step++) {
      const due = await db.marketingDripStep.findMany({
        where: { sequence: ONBOARDING, step: step - 1, completed: true, nextStepAt: { lte: new Date() } },
        include: { subscriber: true },
        take: 50,
      });
      for (const item of due) {
        if (item.subscriber.status === "active" && (await this.sendOnboardingStep(item.subscriber, step)))
          processed++;
        // Either sent, claimed by someone else, or no longer wanted: stop polling it.
        await db.marketingDripStep.update({ where: { id: item.id }, data: { nextStepAt: null } });
      }
    }
    return { processed };
  }

  static async createCampaign(input: CampaignInput) {
    return db.marketingCampaign.create({
      data: {
        name: input.name,
        subject: input.subject,
        previewText: input.previewText,
        templateId: input.templateId || "marketing_broadcast",
        targetAudience: input.targetAudience || "all",
        targetTopics: validTopics(input.targetTopics),
        contentHtml: input.contentHtml,
        contentText: input.contentText || stripHtmlToText(input.contentHtml),
        createdBy: input.createdBy,
        status: "draft",
      },
    });
  }

  private static renderCampaign(
    campaign: { subject: string; previewText: string | null; contentHtml: string },
    token?: string,
  ) {
    const links = token ? this.links(token) : undefined;
    return renderMarketingBroadcastEmail({
      headline: campaign.subject,
      previewText: campaign.previewText || undefined,
      bodyHtml: campaign.contentHtml,
      siteUrl: this.siteUrl,
      preferencesUrl: links?.preferences ?? `${this.siteUrl}/email/preferences`,
      unsubscribeUrl: links?.unsubscribe ?? `${this.siteUrl}/email/preferences`,
    });
  }

  static async sendTestCampaign(campaignId: string, testEmail: string) {
    const campaign = await db.marketingCampaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new Error("Campaign not found");
    const rendered = this.renderCampaign(campaign);
    return sendEmail({
      to: testEmail,
      subject: `[TEST] ${campaign.subject}`,
      html: rendered.html,
      text: rendered.text,
      tags: [
        { name: "type", value: "test_campaign" },
        { name: "campaign_id", value: campaign.id },
      ],
    });
  }

  static async audienceFor(campaign: { targetAudience: string; targetTopics: Prisma.JsonValue }) {
    const roles: Record<string, string> = { merchants: "merchant", developers: "developer", providers: "provider" };
    const where: Prisma.MarketingSubscriberWhereInput = { status: "active" };
    if (roles[campaign.targetAudience]) where.role = roles[campaign.targetAudience];
    const subscribers = await db.marketingSubscriber.findMany({ where, orderBy: { createdAt: "asc" } });
    const wanted = validTopics(campaign.targetTopics);
    // A campaign about given topics reaches only people who kept at least one of them.
    return wanted.length
      ? subscribers.filter((s) => validTopics(s.topics).some((t) => wanted.includes(t)))
      : subscribers;
  }

  static async launchCampaign(campaignId: string) {
    // Claim the campaign atomically so a double click can't send it twice.
    const claimed = await db.marketingCampaign.updateMany({
      where: { id: campaignId, status: { in: ["draft", "failed"] } },
      data: { status: "sending" },
    });
    if (!claimed.count) {
      const exists = await db.marketingCampaign.findUnique({ where: { id: campaignId } });
      throw new Error(exists ? "Campaign has already been sent or is currently sending" : "Campaign not found");
    }
    const campaign = await db.marketingCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    try {
      // Skip anyone this campaign already reached, so relaunching after a failure resumes.
      const done = new Set(
        (
          await db.marketingDeliveryLog.findMany({
            where: { campaignId, status: { not: "failed" } },
            select: { subscriberId: true },
          })
        ).map((l) => l.subscriberId),
      );
      const audience = (await this.audienceFor(campaign)).filter((s) => !done.has(s.id));
      let sent = 0;
      let failed = 0;
      for (let i = 0; i < audience.length; i += 100) {
        const chunk = audience.slice(i, i + 100);
        const result = await sendBatchEmails(
          chunk.map((sub) => {
            const rendered = this.renderCampaign(campaign, sub.unsubscribeToken);
            return {
              to: sub.email,
              subject: campaign.subject,
              html: rendered.html,
              text: rendered.text,
              tags: [
                { name: "campaign_id", value: campaign.id },
                { name: "type", value: "campaign" },
              ],
              headers: this.unsubscribeHeaders(sub.unsubscribeToken),
            };
          }),
          `campaign/${campaign.id}/${chunk[0].id}/${chunk.length}`,
        );
        await db.marketingDeliveryLog.createMany({
          data: chunk.map((sub, idx) => ({
            subscriberId: sub.id,
            campaignId: campaign.id,
            email: sub.email,
            type: "campaign",
            templateId: campaign.templateId,
            resendEmailId: result.ids[idx],
            status: result.success ? "sent" : "failed",
            errorMessage: result.error,
          })),
        });
        if (result.success) sent += chunk.length;
        else failed += chunk.length;
      }
      await db.marketingCampaign.update({
        where: { id: campaignId },
        data: {
          status: failed ? "failed" : "sent",
          sentAt: failed ? null : new Date(),
          recipientCount: { increment: sent },
        },
      });
      return { sent, failed };
    } catch (error) {
      await db.marketingCampaign.update({ where: { id: campaignId }, data: { status: "failed" } });
      throw error;
    }
  }

  static async getSubscriberByToken(token: string) {
    if (!token) return null;
    return db.marketingSubscriber.findUnique({ where: { unsubscribeToken: token } });
  }

  static async updateSubscriberPreferences(
    token: string,
    params: { topics?: string[]; unsubscribeAll?: boolean },
  ) {
    const subscriber = await db.marketingSubscriber.findUnique({ where: { unsubscribeToken: token } });
    if (!subscriber) throw new Error("Invalid or expired preference link");

    const unsubscribe = params.unsubscribeAll === true;
    const topics = unsubscribe ? [] : validTopics(params.topics ?? subscriber.topics);
    // Choosing topics from the preference page is a fresh opt-in for people who
    // had unsubscribed. Bounced or complained addresses stay suppressed.
    const status = unsubscribe
      ? "unsubscribed"
      : ["bounced", "complained"].includes(subscriber.status)
        ? subscriber.status
        : topics.length
          ? "active"
          : "unsubscribed";

    const updated = await db.marketingSubscriber.update({
      where: { id: subscriber.id },
      data: { status, topics },
    });
    await syncResendContact({ email: updated.email, unsubscribed: status !== "active" });
    return updated;
  }

  /** Resend delivery webhooks. Statuses only move forward, never back. */
  static async handleResendWebhookEvent(event: ResendWebhookEvent) {
    if (event.type === "contact.updated" || event.type === "contact.deleted") {
      const email = typeof event.data.email === "string" ? event.data.email.toLowerCase() : undefined;
      if (email && (event.type === "contact.deleted" || event.data.unsubscribed === true)) {
        await db.marketingSubscriber.updateMany({
          where: { email, status: { in: ["active", "pending"] } },
          data: { status: "unsubscribed" },
        });
        return { processed: true, type: event.type };
      }
      return { processed: false, reason: "No change" };
    }

    // Bounces and complaints suppress the address even for transactional mail
    // that has no delivery log here.
    const recipients = (event.data.to ?? []).map((e) => e.toLowerCase());
    if (event.type === "email.bounced" || event.type === "email.complained") {
      const suppressed = event.type === "email.bounced" ? "bounced" : "complained";
      if (event.type === "email.complained" || isPermanentBounce(event))
        await db.marketingSubscriber.updateMany({
          where: { email: { in: recipients }, status: { not: "complained" } },
          data: { status: suppressed },
        });
    }

    const emailId = event.data.email_id;
    if (!emailId) return { processed: false, reason: "No email_id" };
    const log = await db.marketingDeliveryLog.findUnique({ where: { resendEmailId: emailId } });
    if (!log) return { processed: event.type === "email.bounced" || event.type === "email.complained", reason: "No delivery log" };

    const status = eventStatus[event.type];
    if (!status) return { processed: false, reason: "Ignored event type" };
    if (rank[status] <= (rank[log.status] ?? 0)) return { processed: true, type: event.type, unchanged: true };

    await db.marketingDeliveryLog.update({ where: { id: log.id }, data: { status } });
    const counter = { opened: "openCount", clicked: "clickCount", bounced: "bounceCount" }[status as string];
    // Statuses only move forward, so each recipient is counted once per stage.
    if (log.campaignId && counter)
      await db.marketingCampaign.update({
        where: { id: log.campaignId },
        data: { [counter]: { increment: 1 } },
      });
    return { processed: true, type: event.type };
  }

  static async getMarketingAnalytics() {
    const [
      totalSubscribers,
      activeSubscribers,
      pendingSubscribers,
      unsubscribedCount,
      totalCampaigns,
      sentCampaigns,
      logsCount,
      openLogsCount,
      clickLogsCount,
      bounceLogsCount,
      recentCampaigns,
      recentLogs,
    ] = await Promise.all([
      db.marketingSubscriber.count(),
      db.marketingSubscriber.count({ where: { status: "active" } }),
      db.marketingSubscriber.count({ where: { status: "pending" } }),
      db.marketingSubscriber.count({ where: { status: "unsubscribed" } }),
      db.marketingCampaign.count(),
      db.marketingCampaign.count({ where: { status: "sent" } }),
      db.marketingDeliveryLog.count({ where: { status: { notIn: ["failed", "simulated"] } } }),
      db.marketingDeliveryLog.count({ where: { status: { in: ["opened", "clicked"] } } }),
      db.marketingDeliveryLog.count({ where: { status: "clicked" } }),
      db.marketingDeliveryLog.count({ where: { status: "bounced" } }),
      db.marketingCampaign.findMany({ take: 5, orderBy: { createdAt: "desc" } }),
      db.marketingDeliveryLog.findMany({ take: 10, orderBy: { createdAt: "desc" } }),
    ]);

    const pct = (n: number, digits: number) =>
      `${logsCount > 0 ? ((n / logsCount) * 100).toFixed(digits) : (0).toFixed(digits)}%`;

    return {
      subscribers: {
        total: totalSubscribers,
        active: activeSubscribers,
        pending: pendingSubscribers,
        unsubscribed: unsubscribedCount,
      },
      campaigns: { total: totalCampaigns, sent: sentCampaigns },
      engagement: {
        totalSent: logsCount,
        openRate: pct(openLogsCount, 1),
        clickRate: pct(clickLogsCount, 1),
        bounceRate: pct(bounceLogsCount, 2),
      },
      resendStatus: {
        configured: isResendConfigured(),
        mode: isResendConfigured() ? "live" : "local_mock",
        webhookSigned: Boolean(process.env.RESEND_WEBHOOK_SECRET),
        segment: Boolean(process.env.RESEND_SEGMENT_ID || process.env.RESEND_AUDIENCE_ID),
      },
      recentCampaigns,
      recentLogs,
    };
  }
}

const eventStatus: Record<string, string> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.delivery_delayed": "delayed",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
  "email.failed": "failed",
};
const rank: Record<string, number> = {
  failed: 0,
  simulated: 1,
  sent: 1,
  delayed: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  bounced: 6,
  complained: 7,
};

// Resend reports bounce.type "Permanent" for hard bounces. Transient bounces
// (full mailbox, greylisting) should not suppress the address.
function isPermanentBounce(event: ResendWebhookEvent) {
  const bounce = event.data.bounce as { type?: string } | undefined;
  return !bounce?.type || bounce.type.toLowerCase() === "permanent";
}
