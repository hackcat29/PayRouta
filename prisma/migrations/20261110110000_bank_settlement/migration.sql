-- Crypto checkouts settled straight to the merchant's bank: the cash out is
-- funded by the checkout's own delivery rather than a signed payout.
ALTER TABLE "FiatPayout" ALTER COLUMN "payoutId" DROP NOT NULL;
ALTER TABLE "FiatPayout" ADD COLUMN "crossChainPaymentId" TEXT;
ALTER TABLE "FiatPayout" ADD COLUMN "intentId" TEXT;
CREATE UNIQUE INDEX "FiatPayout_crossChainPaymentId_key" ON "FiatPayout"("crossChainPaymentId");
ALTER TABLE "FiatPayoutAccount" ADD COLUMN "settleCheckouts" BOOLEAN NOT NULL DEFAULT false;
