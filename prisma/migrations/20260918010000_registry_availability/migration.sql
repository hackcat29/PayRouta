-- AlterTable
ALTER TABLE "Availability" ADD COLUMN     "capabilityVersion" INTEGER,
ADD COLUMN     "eventKey" TEXT,
ADD COLUMN     "integrationId" TEXT,
ADD COLUMN     "observationType" TEXT,
ADD COLUMN     "observedAt" TIMESTAMP(3),
ADD COLUMN     "sequence" INTEGER,
ADD COLUMN     "trust" TEXT,
ADD COLUMN     "value" JSONB;

-- CreateTable
CREATE TABLE "RegistryHead" (
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "action" TEXT NOT NULL,

    CONSTRAINT "RegistryHead_pkey" PRIMARY KEY ("orgId","environment")
);

-- CreateTable
CREATE TABLE "PublishedProfile" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "capabilityVersion" INTEGER NOT NULL,
    "submissionId" TEXT NOT NULL,
    "publicationKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "inputAsset" TEXT NOT NULL,
    "inputNetwork" TEXT NOT NULL,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "definition" JSONB NOT NULL,

    CONSTRAINT "PublishedProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityContext" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityContext_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityEvaluation" (
    "id" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "contextFingerprint" TEXT NOT NULL,
    "safe" JSONB NOT NULL,
    "trace" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "retentionUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AvailabilityEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RegistryHead_key_key" ON "RegistryHead"("key");

-- CreateIndex
CREATE INDEX "PublishedProfile_environment_current_method_operation_input_idx" ON "PublishedProfile"("environment", "current", "method", "operation", "inputAsset", "inputNetwork");

-- CreateIndex
CREATE INDEX "PublishedProfile_orgId_environment_current_idx" ON "PublishedProfile"("orgId", "environment", "current");

-- CreateIndex
CREATE INDEX "PublishedProfile_publicationKey_idx" ON "PublishedProfile"("publicationKey");

-- CreateIndex
CREATE INDEX "AvailabilityContext_orgId_environment_idx" ON "AvailabilityContext"("orgId", "environment");

-- CreateIndex
CREATE INDEX "AvailabilityEvaluation_orgId_environment_createdAt_idx" ON "AvailabilityEvaluation"("orgId", "environment", "createdAt");

-- CreateIndex
CREATE INDEX "AvailabilityEvaluation_retentionUntil_idx" ON "AvailabilityEvaluation"("retentionUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Availability_eventKey_key" ON "Availability"("eventKey");

-- CreateIndex
CREATE INDEX "Availability_integrationId_environment_observationType_capa_idx" ON "Availability"("integrationId", "environment", "observationType", "capabilityId", "observedAt");

