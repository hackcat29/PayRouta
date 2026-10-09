-- Aggregator phase 2a (docs/AGGREGATOR.md): a merchant's sub-account under a
-- PayRouta platform account, payments taken through it, and platform fees
-- withheld at source instead of invoiced monthly.

-- The merchant's sub-account at the provider (for Stripe, a connected
-- account PayRouta controls). States mirror partner applications.
CREATE TABLE "MerchantPlatformLink" (
 id TEXT PRIMARY KEY,
 "orgId" TEXT NOT NULL REFERENCES "Organization"(id),
 "platformAccountId" TEXT NOT NULL REFERENCES "PlatformAccount"(id),
 environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
 "profileVersion" INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'Queued' CHECK (state IN ('Queued','Pending provider','Action required','Under review','Approved','Restricted','Rejected','Disconnected','Failed')),
 "providerAccountId" TEXT,
 requirements JSONB NOT NULL DEFAULT '[]',
 "paymentsEnabled" BOOLEAN NOT NULL DEFAULT false,
 "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
 reason TEXT,
 "integrationId" TEXT REFERENCES "Integration"(id),
 "lastCheckedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("orgId","profileVersion") REFERENCES "MerchantKybProfile"("orgId","version"),
 CHECK (state <> 'Approved' OR "providerAccountId" IS NOT NULL)
);
CREATE UNIQUE INDEX "MerchantPlatformLink_orgId_platformAccountId_key" ON "MerchantPlatformLink"("orgId","platformAccountId");
CREATE UNIQUE INDEX "MerchantPlatformLink_platformAccountId_providerAccountId_key" ON "MerchantPlatformLink"("platformAccountId","providerAccountId");
CREATE INDEX "MerchantPlatformLink_state_lastCheckedAt_idx" ON "MerchantPlatformLink"(state,"lastCheckedAt");

-- One row per confirmed payment through a platform account: what was taken,
-- what PayRouta withheld, and when the merchant's share becomes available
-- and its reserve is released.
CREATE TABLE "PlatformPayment" (
 "attemptId" TEXT PRIMARY KEY REFERENCES "PaymentAttempt"(id),
 "intentId" TEXT NOT NULL UNIQUE REFERENCES "PaymentIntent"(id),
 "orgId" TEXT NOT NULL,
 environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
 "platformAccountId" TEXT NOT NULL REFERENCES "PlatformAccount"(id),
 "linkId" TEXT NOT NULL REFERENCES "MerchantPlatformLink"(id),
 asset TEXT NOT NULL,
 reference TEXT NOT NULL,
 "grossMinor" DECIMAL(50,0) NOT NULL CHECK ("grossMinor" > 0),
 "feeMinor" DECIMAL(50,0) NOT NULL CHECK ("feeMinor" >= 0 AND "feeMinor" <= "grossMinor"),
 "reserveMinor" DECIMAL(50,0) CHECK ("reserveMinor" >= 0 AND "reserveMinor" <= "grossMinor" - "feeMinor"),
 "providerPaymentRef" TEXT,
 "providerTransferRef" TEXT,
 "availableAt" TIMESTAMP(3),
 "reserveReleaseAt" TIMESTAMP(3),
 state TEXT NOT NULL DEFAULT 'Pending' CHECK (state IN ('Pending','Available','Released')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (state = 'Pending' OR ("availableAt" IS NOT NULL AND "reserveMinor" IS NOT NULL)),
 CHECK (state <> 'Available' OR ("reserveMinor" > 0 AND "reserveReleaseAt" IS NOT NULL))
);
CREATE INDEX "PlatformPayment_orgId_environment_state_idx" ON "PlatformPayment"("orgId",environment,state);

-- Fees taken at source are revenue already collected: monthly statements
-- invoice only fees still owed.
ALTER TABLE "PaymentFee" ADD COLUMN collection TEXT NOT NULL DEFAULT 'invoice' CHECK (collection IN ('invoice','withheld'));
