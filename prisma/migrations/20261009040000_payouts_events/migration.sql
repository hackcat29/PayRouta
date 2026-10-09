-- Aggregator phase 2b (docs/AGGREGATOR.md): payouts PayRouta initiates from a
-- merchant's balance at a fund-holding platform account, and verified
-- provider events that prompt status re-reads.
CREATE TABLE "Payout" (
 id TEXT PRIMARY KEY,
 "orgId" TEXT NOT NULL REFERENCES "Organization"(id),
 environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
 "platformAccountId" TEXT NOT NULL REFERENCES "PlatformAccount"(id),
 "linkId" TEXT NOT NULL REFERENCES "MerchantPlatformLink"(id),
 asset TEXT NOT NULL,
 "amountMinor" DECIMAL(50,0) NOT NULL CHECK ("amountMinor" > 0),
 state TEXT NOT NULL DEFAULT 'Queued' CHECK (state IN ('Queued','In transit','Paid','Failed')),
 "providerPayoutRef" TEXT,
 "failureCode" TEXT,
 "initiatedBy" TEXT NOT NULL,
 -- Schedule period ("daily:2026-10-09") for scheduled payouts; null for
 -- payouts a merchant or operator requested.
 period TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (state <> 'Paid' OR "providerPayoutRef" IS NOT NULL)
);
CREATE UNIQUE INDEX "Payout_period_key" ON "Payout"("orgId",environment,"platformAccountId",asset,period) WHERE period IS NOT NULL;
CREATE UNIQUE INDEX "Payout_platformAccountId_providerPayoutRef_key" ON "Payout"("platformAccountId","providerPayoutRef");
CREATE INDEX "Payout_orgId_environment_createdAt_idx" ON "Payout"("orgId",environment,"createdAt");
CREATE INDEX "Payout_state_updatedAt_idx" ON "Payout"(state,"updatedAt");

CREATE TABLE "PlatformEvent" (
 id TEXT PRIMARY KEY,
 "platformAccountId" TEXT NOT NULL REFERENCES "PlatformAccount"(id),
 "eventId" TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 type TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('account','payment','payout','other')),
 "accountRef" TEXT,
 "objectRef" TEXT,
 state TEXT NOT NULL DEFAULT 'Received' CHECK (state IN ('Received','Processed','Unmatched','Ignored')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PlatformEvent_platformAccountId_eventId_key" ON "PlatformEvent"("platformAccountId","eventId");
