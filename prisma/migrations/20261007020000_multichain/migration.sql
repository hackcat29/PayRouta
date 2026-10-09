ALTER TABLE "PaymentIntent" ADD COLUMN "paymentOptions" JSONB, ADD COLUMN "selectedOption" TEXT;
ALTER TABLE "DepositScan" ADD COLUMN "cursor" TEXT;
CREATE TABLE "WalletSubmission" (
"id" TEXT NOT NULL, "attemptId" TEXT NOT NULL, "orgId" TEXT NOT NULL, "network" TEXT NOT NULL,
"payer" TEXT NOT NULL, "unsigned" TEXT NOT NULL, "messageHash" TEXT NOT NULL,
"expiresAt" TIMESTAMP(3) NOT NULL, "state" TEXT NOT NULL DEFAULT 'Prepared', "transactionHash" TEXT,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT "WalletSubmission_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "WalletSubmission_attemptId_key" ON "WalletSubmission"("attemptId");
CREATE INDEX "WalletSubmission_orgId_createdAt_idx" ON "WalletSubmission"("orgId","createdAt");
