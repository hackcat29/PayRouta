ALTER TABLE "PaymentIntent" ADD COLUMN "pilotBatchId" TEXT;
ALTER TABLE "PublishedProfile" ADD COLUMN "rollout" JSONB NOT NULL DEFAULT '{}';
