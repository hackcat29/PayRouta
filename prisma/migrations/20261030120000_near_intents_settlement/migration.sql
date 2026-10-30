-- NEAR Intents settlement (lib/intents): crypto checkouts settle into a
-- merchant-owned NEAR Intents account, and the merchant pays out or refunds
-- from it by signing intents in their own wallet.
ALTER TABLE "CrossChainPayment" ADD COLUMN "recipientType" TEXT NOT NULL DEFAULT 'DESTINATION_CHAIN';
ALTER TABLE "CrossChainPayment" ADD COLUMN "details" JSONB;

CREATE TABLE "IntentsAccount" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "publicKey" TEXT,
    "proof" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntentsAccount_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IntentsAccount_orgId_environment_createdAt_idx" ON "IntentsAccount"("orgId", "environment", "createdAt");

CREATE TABLE "IntentsChallenge" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "standard" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IntentsChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IntentsPayout" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "intentId" TEXT,
    "originAsset" TEXT NOT NULL,
    "destinationAsset" TEXT NOT NULL,
    "destinationChain" TEXT NOT NULL,
    "destinationSymbol" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "amountIn" TEXT NOT NULL,
    "amountInFormatted" TEXT NOT NULL,
    "amountOutFormatted" TEXT NOT NULL,
    "depositAddress" TEXT NOT NULL,
    "quote" JSONB NOT NULL,
    "payload" JSONB NOT NULL,
    "intentHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_SIGNATURE',
    "details" JSONB,
    "note" TEXT,
    "createdBy" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IntentsPayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IntentsPayout_depositAddress_key" ON "IntentsPayout"("depositAddress");
CREATE INDEX "IntentsPayout_orgId_environment_createdAt_idx" ON "IntentsPayout"("orgId", "environment", "createdAt");
CREATE INDEX "IntentsPayout_intentId_idx" ON "IntentsPayout"("intentId");

-- A checkout settling into a NEAR Intents account binds "<account>/<24 hex>":
-- one account receives every checkout, so each binding gets its own reference
-- under it. The slash keeps it from ever matching a chain address.
ALTER TABLE "DepositBinding" DROP CONSTRAINT "DepositBinding_address_check";
ALTER TABLE "DepositBinding" ADD CONSTRAINT "DepositBinding_address_check" CHECK (
 ("network" ~ '^eip155:[0-9]+$' AND "address" ~ '^0x[0-9a-f]{40}$') OR
 ("network" IN ('solana:mainnet','solana:devnet') AND "address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') OR
 ("network" IN ('stellar:pubnet','stellar:testnet') AND "address" ~ '^G[A-Z2-7]{55}$') OR
 ("environment" = 'production' AND "address" ~ '^(0x[0-9a-f]{40}|[0-9a-f]{64}|(([a-z0-9]+[-_])*[a-z0-9]+\.)+([a-z0-9]+[-_])*[a-z0-9]+)/[0-9a-f]{24}$')
);
