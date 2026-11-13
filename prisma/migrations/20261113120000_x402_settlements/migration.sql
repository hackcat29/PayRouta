-- x402 payments PayRouta's NEAR relayer settled (lib/x402, docs/x402.md):
-- for a merchant's own x402 server through the facilitator API, or for a
-- PayRouta checkout paid over x402.
CREATE TABLE "X402Settlement" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "payTo" TEXT NOT NULL,
    "payer" TEXT,
    "resource" TEXT,
    "intentId" TEXT,
    "success" BOOLEAN NOT NULL,
    "transaction" TEXT,
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "X402Settlement_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "X402Settlement_orgId_environment_createdAt_idx" ON "X402Settlement"("orgId", "environment", "createdAt");
CREATE INDEX "X402Settlement_intentId_idx" ON "X402Settlement"("intentId");
