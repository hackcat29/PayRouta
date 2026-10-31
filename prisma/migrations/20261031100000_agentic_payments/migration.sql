-- Agentic payments (lib/agents): agents pay checkouts from a NEAR Intents
-- balance by a signed transfer intent, within limits set on their key.
ALTER TABLE "CrossChainPayment" ADD COLUMN "fundedBy" TEXT NOT NULL DEFAULT 'ORIGIN_CHAIN';
ALTER TABLE "CrossChainPayment" ADD COLUMN "payer" TEXT;
ALTER TABLE "CrossChainPayment" ADD COLUMN "payload" JSONB;
ALTER TABLE "CrossChainPayment" ADD COLUMN "intentHash" TEXT;

CREATE TABLE "AgentKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "budgetMinor" DECIMAL(30,0) NOT NULL,
    "period" TEXT NOT NULL,
    "perPaymentMinor" DECIMAL(30,0) NOT NULL,
    "merchants" JSONB NOT NULL,
    "payer" TEXT,
    "createdBy" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentKey_verifier_key" ON "AgentKey"("verifier");
CREATE INDEX "AgentKey_orgId_environment_createdAt_idx" ON "AgentKey"("orgId", "environment", "createdAt");

CREATE TABLE "AgentSpend" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "paymentId" TEXT,
    "amountMinor" DECIMAL(30,0) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Reserved',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentSpend_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentSpend_keyId_intentId_key" ON "AgentSpend"("keyId", "intentId");
CREATE INDEX "AgentSpend_keyId_createdAt_idx" ON "AgentSpend"("keyId", "createdAt");
