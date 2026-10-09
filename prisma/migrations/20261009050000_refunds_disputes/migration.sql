-- Aggregator phase 2c (docs/AGGREGATOR.md): refunds, disputes (chargebacks)
-- and daily reconciliation of merchant balances against the provider.
CREATE TABLE "PlatformRefund" (
 id TEXT PRIMARY KEY,
 "attemptId" TEXT NOT NULL REFERENCES "PlatformPayment"("attemptId"),
 "orgId" TEXT NOT NULL REFERENCES "Organization"(id),
 environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
 "platformAccountId" TEXT NOT NULL REFERENCES "PlatformAccount"(id),
 asset TEXT NOT NULL,
 "amountMinor" DECIMAL(50,0) NOT NULL CHECK ("amountMinor" > 0),
 -- How the refund was funded: the merchant's available balance first, the
 -- rest booked as owed by the merchant (receivable).
 "fromAvailableMinor" DECIMAL(50,0) NOT NULL CHECK ("fromAvailableMinor" >= 0),
 "fromReceivableMinor" DECIMAL(50,0) NOT NULL CHECK ("fromReceivableMinor" >= 0),
 state TEXT NOT NULL DEFAULT 'Queued' CHECK (state IN ('Queued','Pending','Succeeded','Failed')),
 "providerRefundRef" TEXT,
 "failureCode" TEXT,
 reason TEXT,
 "initiatedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("fromAvailableMinor" + "fromReceivableMinor" = "amountMinor")
);
CREATE UNIQUE INDEX "PlatformRefund_platformAccountId_providerRefundRef_key" ON "PlatformRefund"("platformAccountId","providerRefundRef");
CREATE INDEX "PlatformRefund_attemptId_idx" ON "PlatformRefund"("attemptId");

CREATE TABLE "PlatformDispute" (
 id TEXT PRIMARY KEY,
 "attemptId" TEXT NOT NULL REFERENCES "PlatformPayment"("attemptId"),
 "orgId" TEXT NOT NULL REFERENCES "Organization"(id),
 environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
 "platformAccountId" TEXT NOT NULL REFERENCES "PlatformAccount"(id),
 "providerDisputeRef" TEXT NOT NULL,
 asset TEXT NOT NULL,
 "amountMinor" DECIMAL(50,0) NOT NULL CHECK ("amountMinor" > 0),
 "feeMinor" DECIMAL(50,0) NOT NULL DEFAULT 0 CHECK ("feeMinor" >= 0),
 -- What was held back for the dispute and where it came from.
 "fromAvailableMinor" DECIMAL(50,0) NOT NULL CHECK ("fromAvailableMinor" >= 0),
 "fromReserveMinor" DECIMAL(50,0) NOT NULL CHECK ("fromReserveMinor" >= 0),
 "fromReceivableMinor" DECIMAL(50,0) NOT NULL CHECK ("fromReceivableMinor" >= 0),
 state TEXT NOT NULL CHECK (state IN ('Open','Won','Lost')),
 -- Fund-holding rails: the covered amount was moved out of the merchant's
 -- sub-account at the provider while the dispute is open.
 "fundsHeld" BOOLEAN NOT NULL DEFAULT false,
 reason TEXT,
 "evidenceDueBy" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK ("fromAvailableMinor" + "fromReserveMinor" + "fromReceivableMinor" = "amountMinor")
);
CREATE UNIQUE INDEX "PlatformDispute_platformAccountId_providerDisputeRef_key" ON "PlatformDispute"("platformAccountId","providerDisputeRef");
CREATE INDEX "PlatformDispute_orgId_environment_state_idx" ON "PlatformDispute"("orgId",environment,state);

CREATE TABLE "PlatformReconciliation" (
 id TEXT PRIMARY KEY,
 "linkId" TEXT NOT NULL REFERENCES "MerchantPlatformLink"(id),
 "orgId" TEXT NOT NULL,
 environment TEXT NOT NULL,
 "platformAccountId" TEXT NOT NULL REFERENCES "PlatformAccount"(id),
 asset TEXT NOT NULL,
 day TEXT NOT NULL CHECK (day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 "providerMinor" DECIMAL(50,0) NOT NULL,
 "ledgerMinor" DECIMAL(50,0) NOT NULL,
 result TEXT NOT NULL CHECK (result IN ('Matched','Mismatch')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PlatformReconciliation_linkId_asset_day_key" ON "PlatformReconciliation"("linkId",asset,day);

ALTER TABLE "PlatformEvent" DROP CONSTRAINT "PlatformEvent_kind_check";
ALTER TABLE "PlatformEvent" ADD CONSTRAINT "PlatformEvent_kind_check" CHECK (kind IN ('account','payment','payout','refund','dispute','other'));
