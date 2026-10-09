-- CreateTable MarketingSubscriber
CREATE TABLE IF NOT EXISTS "MarketingSubscriber" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "orgId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'subscriber',
    "status" TEXT NOT NULL DEFAULT 'active',
    "source" TEXT NOT NULL DEFAULT 'landing_page',
    "topics" JSONB NOT NULL DEFAULT '["product_updates","weekly_digest","developer_advisories"]',
    "resendContactId" TEXT,
    "resendAudienceId" TEXT,
    "unsubscribeToken" TEXT NOT NULL,
    "lastEmailedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable MarketingCampaign
CREATE TABLE IF NOT EXISTS "MarketingCampaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "previewText" TEXT,
    "templateId" TEXT NOT NULL DEFAULT 'marketing_broadcast',
    "targetAudience" TEXT NOT NULL DEFAULT 'all',
    "targetTopics" JSONB NOT NULL DEFAULT '[]',
    "contentHtml" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "bounceCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable MarketingDeliveryLog
CREATE TABLE IF NOT EXISTS "MarketingDeliveryLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriberId" TEXT,
    "campaignId" TEXT,
    "email" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'campaign',
    "templateId" TEXT NOT NULL,
    "resendEmailId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable MarketingDripStep
CREATE TABLE IF NOT EXISTS "MarketingDripStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "subscriberId" TEXT NOT NULL,
    "sequence" TEXT NOT NULL DEFAULT 'merchant_onboarding',
    "step" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextStepAt" TIMESTAMP(3),
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingSubscriber_email_key" ON "MarketingSubscriber"("email");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingSubscriber_unsubscribeToken_key" ON "MarketingSubscriber"("unsubscribeToken");
CREATE INDEX IF NOT EXISTS "MarketingSubscriber_status_role_idx" ON "MarketingSubscriber"("status", "role");
CREATE INDEX IF NOT EXISTS "MarketingSubscriber_orgId_idx" ON "MarketingSubscriber"("orgId");

CREATE INDEX IF NOT EXISTS "MarketingCampaign_status_createdAt_idx" ON "MarketingCampaign"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "MarketingDeliveryLog_resendEmailId_key" ON "MarketingDeliveryLog"("resendEmailId");
CREATE INDEX IF NOT EXISTS "MarketingDeliveryLog_email_status_idx" ON "MarketingDeliveryLog"("email", "status");
CREATE INDEX IF NOT EXISTS "MarketingDeliveryLog_type_createdAt_idx" ON "MarketingDeliveryLog"("type", "createdAt");
CREATE INDEX IF NOT EXISTS "MarketingDeliveryLog_resendEmailId_idx" ON "MarketingDeliveryLog"("resendEmailId");

CREATE INDEX IF NOT EXISTS "MarketingDripStep_sequence_completed_nextStepAt_idx" ON "MarketingDripStep"("sequence", "completed", "nextStepAt");
CREATE UNIQUE INDEX IF NOT EXISTS "MarketingDripStep_subscriberId_sequence_step_key" ON "MarketingDripStep"("subscriberId", "sequence", "step");

-- Foreign Keys
ALTER TABLE "MarketingDeliveryLog" ADD CONSTRAINT "MarketingDeliveryLog_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "MarketingSubscriber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketingDeliveryLog" ADD CONSTRAINT "MarketingDeliveryLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketingDripStep" ADD CONSTRAINT "MarketingDripStep_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "MarketingSubscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
