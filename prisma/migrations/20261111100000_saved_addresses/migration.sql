-- Addresses a merchant sends to from their NEAR Intents wallet.
CREATE TABLE "SavedAddress" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "blockchain" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedAddress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SavedAddress_label_check" CHECK (char_length("label") BETWEEN 1 AND 60)
);
CREATE INDEX "SavedAddress_orgId_environment_createdAt_idx" ON "SavedAddress"("orgId", "environment", "createdAt");
