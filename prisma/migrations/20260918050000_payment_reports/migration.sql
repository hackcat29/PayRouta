-- CreateTable
CREATE TABLE "PaymentReport" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "providerReportId" TEXT NOT NULL,
    "coverageStart" TIMESTAMP(3) NOT NULL,
    "coverageEnd" TIMESTAMP(3) NOT NULL,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "rows" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReport_integrationId_environment_fingerprint_key" ON "PaymentReport"("integrationId", "environment", "fingerprint");

