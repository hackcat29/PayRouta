-- Crypto checkouts settled straight to an address on any chain.
CREATE TABLE "SettlementAddress" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "blockchain" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "contract" TEXT,
    "address" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SettlementAddress_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SettlementAddress_decimals_check" CHECK ("decimals" BETWEEN 0 AND 30)
);
CREATE UNIQUE INDEX "SettlementAddress_orgId_environment_key" ON "SettlementAddress"("orgId", "environment");
