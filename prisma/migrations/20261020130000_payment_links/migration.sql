-- Payment links: shareable checkout URLs for merchants without a website.
CREATE TABLE "PaymentLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "methods" JSONB NOT NULL,
    "crypto" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "checkouts" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentLink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PaymentLink_slug_key" ON "PaymentLink"("slug");
CREATE INDEX "PaymentLink_orgId_environment_createdAt_idx" ON "PaymentLink"("orgId", "environment", "createdAt");
