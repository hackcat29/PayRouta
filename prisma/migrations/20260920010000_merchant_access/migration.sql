CREATE TABLE "MerchantApiKey" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL REFERENCES "Organization"("id"),
 "environment" TEXT NOT NULL CHECK ("environment" IN ('sandbox','production')),
 "prefix" TEXT NOT NULL, "verifier" TEXT NOT NULL UNIQUE, "permissions" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "expiresAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), "lastUsedAt" TIMESTAMP(3)
);
CREATE INDEX "MerchantApiKey_orgId_environment_createdAt_idx" ON "MerchantApiKey"("orgId","environment","createdAt");
CREATE TABLE "MerchantRequest" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL REFERENCES "Organization"("id"),
 "environment" TEXT NOT NULL, "operation" TEXT NOT NULL, "status" INTEGER NOT NULL,
 "durationMs" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MerchantRequest_orgId_environment_createdAt_idx" ON "MerchantRequest"("orgId","environment","createdAt");
ALTER TABLE "CheckoutSession" ADD COLUMN "requestKey" TEXT, ADD COLUMN "tokenRef" TEXT;
CREATE UNIQUE INDEX "CheckoutSession_intentId_requestKey_key" ON "CheckoutSession"("intentId","requestKey");
