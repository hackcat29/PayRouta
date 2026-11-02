-- Cashing out crypto to a bank or mobile money (lib/treasury/offramp).
CREATE TABLE "FiatPayoutAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Verifying',
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "partnerCustomerId" TEXT,
    "kycLinkId" TEXT,
    "kycUrl" TEXT,
    "tosUrl" TEXT,
    "externalAccountId" TEXT,
    "liquidationAddressId" TEXT,
    "liquidationAddress" TEXT,
    "destinationRef" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FiatPayoutAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FiatPayoutAccount_orgId_environment_partner_key" ON "FiatPayoutAccount"("orgId", "environment", "partner");

CREATE TABLE "FiatPayout" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partner" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "amountUsd" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Awaiting signature',
    "partnerRef" TEXT,
    "localAmount" TEXT,
    "rate" TEXT,
    "failure" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FiatPayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FiatPayout_payoutId_key" ON "FiatPayout"("payoutId");
CREATE INDEX "FiatPayout_orgId_environment_createdAt_idx" ON "FiatPayout"("orgId", "environment", "createdAt");
CREATE INDEX "FiatPayout_status_idx" ON "FiatPayout"("status");
