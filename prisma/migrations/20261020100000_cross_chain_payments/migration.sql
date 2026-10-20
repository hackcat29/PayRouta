-- Cross-chain payments through an intents network (lib/intents). Records
-- quotes and deposit instructions only; confirmation stays on-chain.
CREATE TABLE "CrossChainPayment" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "originAsset" TEXT NOT NULL,
    "originChain" TEXT NOT NULL,
    "originSymbol" TEXT NOT NULL,
    "destinationAsset" TEXT NOT NULL,
    "depositAddress" TEXT NOT NULL,
    "depositMemo" TEXT,
    "amountIn" TEXT NOT NULL,
    "amountInFormatted" TEXT NOT NULL,
    "amountOut" TEXT NOT NULL,
    "refundTo" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "quote" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_DEPOSIT',
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrossChainPayment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CrossChainPayment_depositAddress_key" ON "CrossChainPayment"("depositAddress");
CREATE INDEX "CrossChainPayment_attemptId_createdAt_idx" ON "CrossChainPayment"("attemptId", "createdAt");
