import { db } from "@/lib/portal/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import {
  sendEmail,
  sendBatchEmails,
  syncResendAudienceContact,
  isResendConfigured,
} from "./resend-client";
import {
  renderWelcomeEmail,
  renderDripRoutingTipsEmail,
  renderDripSettlementEmail,
  renderMarketingBroadcastEmail,
  stripHtmlToText,
} from "./templates";

export const MARKETING_TOPICS = [
  { id: "product_updates", label: "Product & Protocol Updates", default: true },
  { id: "weekly_digest", label: "Weekly Routing & Settlement Digest", default: true },
  { id: "developer_advisories", label: "Developer & API Advisories", default: true },
  { id: "market_insights", label: "Stablecoins & FX Market Insights", default: false },
] as const;

export type TopicId = (typeof MARKETING_TOPICS)[number]["id"];

export interface SubscribeInput {
  email: string;
  name?: string;
  orgId?: string;
  role?: "subscriber" | "merchant" | "developer" | "provider";
  source?: string;
  topics?: string[];
  metadata?: Record<string, unknown>;
  sendWelcome?: boolean;
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

export class MarketingService {
  private static siteUrl = process.env.SITE_URL || "https://payrouta.com";

  /**
   * Add or update a subscriber, sync to Resend Audience, and kick off onboarding drip.
   */
  static async subscribe(input: SubscribeInput) {
    const email = input.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new Error("Invalid email address provided");
    }

    const defaultTopicList = MARKETING_TOPICS.filter((t) => t.default).map(
      (t) => t.id,
    );
    const selectedTopics = input.topics?.length ? input.topics : defaultTopicList;

    // Check existing subscriber
    let subscriber = await db.marketingSubscriber.findUnique({
      where: { email },
    });

    const isNew = !subscriber;

    if (!subscriber) {
      subscriber = await db.marketingSubscriber.create({
        data: {
          email,
          name: input.name,
          orgId: input.orgId,
          role: input.role || "subscriber",
          source: input.source || "landing_page",
          topics: selectedTopics,
          status: "active",
          metadata: (input.metadata ?? {}) as Prisma.InputJsonObject,
        },
      });
    } else {
      // Re-activate if was unsubscribed or update role/name
      subscriber = await db.marketingSubscriber.update({
        where: { id: subscriber.id },
        data: {
          name: input.name || subscriber.name,
          role: input.role || subscriber.role,
          status: "active",
          topics: selectedTopics,
          orgId: input.orgId || subscriber.orgId,
        },
      });
    }

    // Sync to Resend Audience in background
    try {
      const audienceResult = await syncResendAudienceContact({
        email: subscriber.email,
        firstName: subscriber.name?.split(" ")[0],
        lastName: subscriber.name?.split(" ").slice(1).join(" "),
        unsubscribed: false,
      });

      if (audienceResult.contactId) {
        await db.marketingSubscriber.update({
          where: { id: subscriber.id },
          data: { resendContactId: audienceResult.contactId },
        });
      }
    } catch (e) {
      console.warn("[Resend Audience Sync]", e);
    }

    // If new or explicitly asked to send welcome email
    if (input.sendWelcome !== false && isNew) {
      await this.startOnboardingDrip(subscriber);
    }

    return subscriber;
  }

  /**
   * Start the multi-day onboarding drip for a subscriber
   */
  static async startOnboardingDrip(subscriber: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    unsubscribeToken: string;
  }) {
    const preferencesUrl = `${this.siteUrl}/email/preferences?token=${subscriber.unsubscribeToken}`;
    const unsubscribeUrl = `${this.siteUrl}/email/preferences?token=${subscriber.unsubscribeToken}&action=unsub`;

    // Render Welcome (Day 0)
    const emailData = renderWelcomeEmail({
      name: subscriber.name || undefined,
      role: subscriber.role as "merchant" | "developer" | "provider" | "subscriber",
      siteUrl: this.siteUrl,
      preferencesUrl,
      unsubscribeUrl,
    });

    // Send via Resend
    const sendResult = await sendEmail({
      to: subscriber.email,
      subject: emailData.subject,
      html: emailData.html,
      text: emailData.text,
      tags: [
        { name: "type", value: "onboarding" },
        { name: "step", value: "welcome" },
        { name: "role", value: subscriber.role },
      ],
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
      },
    });

    // Log delivery
    await db.marketingDeliveryLog.create({
      data: {
        subscriberId: subscriber.id,
        email: subscriber.email,
        type: "drip",
        templateId: "welcome_onboarding",
        resendEmailId: sendResult.id,
        status: sendResult.success ? "sent" : "failed",
        errorMessage: sendResult.error,
        metadata: { step: 0, sequence: "merchant_onboarding" },
      },
    });

    // Schedule Next Step (Day 3: Multi-Rail Failover tips)
    const nextStepDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await db.marketingDripStep.upsert({
      where: {
        subscriberId_sequence_step: {
          subscriberId: subscriber.id,
          sequence: "merchant_onboarding",
          step: 0,
        },
      },
      create: {
        subscriberId: subscriber.id,
        sequence: "merchant_onboarding",
        step: 0,
        sentAt: new Date(),
        nextStepAt: nextStepDate,
        completed: true,
      },
      update: {
        sentAt: new Date(),
        nextStepAt: nextStepDate,
        completed: true,
      },
    });
  }

  /**
   * Process all scheduled drip steps (e.g. Day 3 and Day 7 emails)
   */
  static async processScheduledDrips() {
    const now = new Date();

    // Find drip steps that completed step 0 and are due for step 1
    const dueStep0 = await db.marketingDripStep.findMany({
      where: {
        sequence: "merchant_onboarding",
        step: 0,
        completed: true,
        nextStepAt: { lte: now },
      },
      include: {
        subscriber: true,
      },
      take: 50,
    });

    let processedCount = 0;

    for (const item of dueStep0) {
      if (item.subscriber.status !== "active") continue;

      // Check if step 1 already exists
      const existingStep1 = await db.marketingDripStep.findUnique({
        where: {
          subscriberId_sequence_step: {
            subscriberId: item.subscriberId,
            sequence: "merchant_onboarding",
            step: 1,
          },
        },
      });

      if (existingStep1) continue;

      const unsubscribeUrl = `${this.siteUrl}/email/preferences?token=${item.subscriber.unsubscribeToken}&action=unsub`;
      const preferencesUrl = `${this.siteUrl}/email/preferences?token=${item.subscriber.unsubscribeToken}`;

      const emailData = renderDripRoutingTipsEmail({
        name: item.subscriber.name || undefined,
        siteUrl: this.siteUrl,
        unsubscribeUrl,
        preferencesUrl,
      });

      const res = await sendEmail({
        to: item.subscriber.email,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        tags: [
          { name: "type", value: "drip" },
          { name: "step", value: "routing_tips" },
        ],
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
      });

      // Schedule Step 2 (Day 7) in 4 days
      const step2Date = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);

      await db.marketingDripStep.create({
        data: {
          subscriberId: item.subscriber.id,
          sequence: "merchant_onboarding",
          step: 1,
          sentAt: new Date(),
          nextStepAt: step2Date,
          completed: true,
        },
      });

      await db.marketingDeliveryLog.create({
        data: {
          subscriberId: item.subscriber.id,
          email: item.subscriber.email,
          type: "drip",
          templateId: "drip_routing_tips",
          resendEmailId: res.id,
          status: res.success ? "sent" : "failed",
          errorMessage: res.error,
          metadata: { step: 1 },
        },
      });

      processedCount++;
    }

    // Find drip steps that completed step 1 and are due for step 2 (Day 7: Settlement)
    const dueStep1 = await db.marketingDripStep.findMany({
      where: {
        sequence: "merchant_onboarding",
        step: 1,
        completed: true,
        nextStepAt: { lte: now },
      },
      include: {
        subscriber: true,
      },
      take: 50,
    });

    for (const item of dueStep1) {
      if (item.subscriber.status !== "active") continue;

      const existingStep2 = await db.marketingDripStep.findUnique({
        where: {
          subscriberId_sequence_step: {
            subscriberId: item.subscriberId,
            sequence: "merchant_onboarding",
            step: 2,
          },
        },
      });

      if (existingStep2) continue;

      const unsubscribeUrl = `${this.siteUrl}/email/preferences?token=${item.subscriber.unsubscribeToken}&action=unsub`;
      const preferencesUrl = `${this.siteUrl}/email/preferences?token=${item.subscriber.unsubscribeToken}`;

      const emailData = renderDripSettlementEmail({
        name: item.subscriber.name || undefined,
        siteUrl: this.siteUrl,
        unsubscribeUrl,
        preferencesUrl,
      });

      const res = await sendEmail({
        to: item.subscriber.email,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text,
        tags: [
          { name: "type", value: "drip" },
          { name: "step", value: "settlement" },
        ],
        headers: { "List-Unsubscribe": `<${unsubscribeUrl}>` },
      });

      await db.marketingDripStep.create({
        data: {
          subscriberId: item.subscriber.id,
          sequence: "merchant_onboarding",
          step: 2,
          sentAt: new Date(),
          completed: true,
        },
      });

      await db.marketingDeliveryLog.create({
        data: {
          subscriberId: item.subscriber.id,
          email: item.subscriber.email,
          type: "drip",
          templateId: "drip_settlement",
          resendEmailId: res.id,
          status: res.success ? "sent" : "failed",
          errorMessage: res.error,
          metadata: { step: 2 },
        },
      });

      processedCount++;
    }

    return { processed: processedCount };
  }

  /**
   * Create a new marketing campaign
   */
  static async createCampaign(input: CampaignInput) {
    const campaign = await db.marketingCampaign.create({
      data: {
        name: input.name,
        subject: input.subject,
        previewText: input.previewText,
        templateId: input.templateId || "marketing_broadcast",
        targetAudience: input.targetAudience || "all",
        targetTopics: input.targetTopics || [],
        contentHtml: input.contentHtml,
        contentText: input.contentText || stripHtmlToText(input.contentHtml),
        createdBy: input.createdBy,
        status: "draft",
      },
    });

    return campaign;
  }

  /**
   * Send a test preview of a campaign
   */
  static async sendTestCampaign(campaignId: string, testEmail: string) {
    const campaign = await db.marketingCampaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new Error("Campaign not found");
    }

    const emailData = renderMarketingBroadcastEmail({
      headline: campaign.subject,
      previewText: campaign.previewText || undefined,
      bodyHtml: campaign.contentHtml,
      siteUrl: this.siteUrl,
      preferencesUrl: `${this.siteUrl}/email/preferences`,
      unsubscribeUrl: `${this.siteUrl}/email/preferences?action=unsub`,
    });

    const res = await sendEmail({
      to: testEmail,
      subject: `[TEST] ${campaign.subject}`,
      html: emailData.html,
      text: emailData.text,
      tags: [
        { name: "type", value: "test_campaign" },
        { name: "campaign_id", value: campaign.id },
      ],
    });

    return res;
  }

  /**
   * Launch and send a campaign to target audience in batch
   */
  static async launchCampaign(campaignId: string) {
    const campaign = await db.marketingCampaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      throw new Error("Campaign not found");
    }

    if (campaign.status === "sent" || campaign.status === "sending") {
      throw new Error("Campaign has already been sent or is currently sending");
    }

    await db.marketingCampaign.update({
      where: { id: campaignId },
      data: { status: "sending" },
    });

    // Build subscriber query based on audience filter
    const audienceFilter: Prisma.MarketingSubscriberWhereInput = {
      status: "active",
    };

    if (campaign.targetAudience !== "all") {
      // Map audience target to role
      if (campaign.targetAudience === "merchants") {
        audienceFilter.role = "merchant";
      } else if (campaign.targetAudience === "developers") {
        audienceFilter.role = "developer";
      } else if (campaign.targetAudience === "providers") {
        audienceFilter.role = "provider";
      }
    }

    const subscribers = await db.marketingSubscriber.findMany({
      where: audienceFilter,
    });

    if (subscribers.length === 0) {
      await db.marketingCampaign.update({
        where: { id: campaignId },
        data: { status: "sent", sentAt: new Date(), recipientCount: 0 },
      });
      return { sent: 0 };
    }

    // Format individual emails for each recipient
    const emailBatch = subscribers.map((sub) => {
      const preferencesUrl = `${this.siteUrl}/email/preferences?token=${sub.unsubscribeToken}`;
      const unsubscribeUrl = `${this.siteUrl}/email/preferences?token=${sub.unsubscribeToken}&action=unsub`;

      const rendered = renderMarketingBroadcastEmail({
        headline: campaign.subject,
        previewText: campaign.previewText || undefined,
        bodyHtml: campaign.contentHtml,
        siteUrl: this.siteUrl,
        preferencesUrl,
        unsubscribeUrl,
      });

      return {
        subscriberId: sub.id,
        to: sub.email,
        subject: campaign.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [
          { name: "campaign_id", value: campaign.id },
          { name: "type", value: "campaign" },
        ],
        headers: {
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
        },
      };
    });

    // Send in chunks of 100 via batch API
    let totalSent = 0;
    const chunkSize = 100;

    for (let i = 0; i < emailBatch.length; i += chunkSize) {
      const chunk = emailBatch.slice(i, i + chunkSize);
      const batchResult = await sendBatchEmails(
        chunk.map((item) => ({
          to: item.to,
          subject: item.subject,
          html: item.html,
          text: item.text,
          tags: item.tags,
          headers: item.headers,
        })),
      );

      // Record logs
      const logPromises = chunk.map((item, idx) => {
        const resendId = batchResult.ids[idx];
        return db.marketingDeliveryLog.create({
          data: {
            subscriberId: item.subscriberId,
            campaignId: campaign.id,
            email: item.to,
            type: "campaign",
            templateId: campaign.templateId,
            resendEmailId: resendId,
            status: batchResult.success ? "sent" : "failed",
            errorMessage: batchResult.error,
          },
        });
      });

      await Promise.all(logPromises);
      totalSent += chunk.length;
    }

    // Update campaign record
    await db.marketingCampaign.update({
      where: { id: campaignId },
      data: {
        status: "sent",
        sentAt: new Date(),
        recipientCount: totalSent,
      },
    });

    return { sent: totalSent };
  }

  /**
   * CAN-SPAM and GDPR Preference Center logic
   */
  static async getSubscriberByToken(token: string) {
    const subscriber = await db.marketingSubscriber.findUnique({
      where: { unsubscribeToken: token },
    });
    return subscriber;
  }

  static async updateSubscriberPreferences(
    token: string,
    params: {
      topics?: string[];
      unsubscribeAll?: boolean;
    },
  ) {
    const subscriber = await db.marketingSubscriber.findUnique({
      where: { unsubscribeToken: token },
    });

    if (!subscriber) {
      throw new Error("Invalid or expired preference link");
    }

    const isUnsubscribed = params.unsubscribeAll === true;
    const newStatus = isUnsubscribed ? "unsubscribed" : "active";
    const newTopics = isUnsubscribed ? [] : params.topics || (subscriber.topics as string[]);

    const updated = await db.marketingSubscriber.update({
      where: { id: subscriber.id },
      data: {
        status: newStatus,
        topics: newTopics,
      },
    });

    // Sync to Resend in background
    syncResendAudienceContact({
      email: updated.email,
      unsubscribed: isUnsubscribed,
    }).catch(console.error);

    return updated;
  }

  /**
   * Webhook processor for Resend delivery/engagement webhooks
   */
  static async handleResendWebhookEvent(event: {
    type: string;
    data: {
      email_id?: string;
      to?: string[];
      created_at?: string;
      [key: string]: unknown;
    };
  }) {
    const emailId = event.data?.email_id;
    if (!emailId) return { processed: false, reason: "No email_id" };

    const log = await db.marketingDeliveryLog.findUnique({
      where: { resendEmailId: emailId },
    });

    if (!log) {
      return { processed: false, reason: "Delivery log not found" };
    }

    switch (event.type) {
      case "email.delivered":
        await db.marketingDeliveryLog.update({
          where: { id: log.id },
          data: { status: "delivered" },
        });
        break;

      case "email.opened":
        await db.marketingDeliveryLog.update({
          where: { id: log.id },
          data: { status: "opened" },
        });
        if (log.campaignId) {
          await db.marketingCampaign.update({
            where: { id: log.campaignId },
            data: { openCount: { increment: 1 } },
          });
        }
        break;

      case "email.clicked":
        await db.marketingDeliveryLog.update({
          where: { id: log.id },
          data: { status: "clicked" },
        });
        if (log.campaignId) {
          await db.marketingCampaign.update({
            where: { id: log.campaignId },
            data: { clickCount: { increment: 1 } },
          });
        }
        break;

      case "email.bounced":
        await db.marketingDeliveryLog.update({
          where: { id: log.id },
          data: { status: "bounced" },
        });
        if (log.campaignId) {
          await db.marketingCampaign.update({
            where: { id: log.campaignId },
            data: { bounceCount: { increment: 1 } },
          });
        }
        // Suppress subscriber
        if (log.subscriberId) {
          await db.marketingSubscriber.update({
            where: { id: log.subscriberId },
            data: { status: "bounced" },
          });
        }
        break;

      case "email.complained":
        await db.marketingDeliveryLog.update({
          where: { id: log.id },
          data: { status: "complained" },
        });
        if (log.subscriberId) {
          await db.marketingSubscriber.update({
            where: { id: log.subscriberId },
            data: { status: "complained" },
          });
        }
        break;
    }

    return { processed: true, type: event.type };
  }

  /**
   * Aggregated Marketing Analytics for the ops & merchant dashboard
   */
  static async getMarketingAnalytics() {
    const [
      totalSubscribers,
      activeSubscribers,
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
      db.marketingSubscriber.count({ where: { status: "unsubscribed" } }),
      db.marketingCampaign.count(),
      db.marketingCampaign.count({ where: { status: "sent" } }),
      db.marketingDeliveryLog.count(),
      db.marketingDeliveryLog.count({ where: { status: "opened" } }),
      db.marketingDeliveryLog.count({ where: { status: "clicked" } }),
      db.marketingDeliveryLog.count({ where: { status: "bounced" } }),
      db.marketingCampaign.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
      }),
      db.marketingDeliveryLog.findMany({
        take: 10,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const openRate =
      logsCount > 0 ? ((openLogsCount / logsCount) * 100).toFixed(1) : "0.0";
    const clickRate =
      logsCount > 0 ? ((clickLogsCount / logsCount) * 100).toFixed(1) : "0.0";
    const bounceRate =
      logsCount > 0 ? ((bounceLogsCount / logsCount) * 100).toFixed(2) : "0.00";

    return {
      subscribers: {
        total: totalSubscribers,
        active: activeSubscribers,
        unsubscribed: unsubscribedCount,
      },
      campaigns: {
        total: totalCampaigns,
        sent: sentCampaigns,
      },
      engagement: {
        totalSent: logsCount,
        openRate: `${openRate}%`,
        clickRate: `${clickRate}%`,
        bounceRate: `${bounceRate}%`,
      },
      resendStatus: {
        configured: isResendConfigured(),
        mode: isResendConfigured() ? "live" : "local_mock",
      },
      recentCampaigns,
      recentLogs,
    };
  }
}
