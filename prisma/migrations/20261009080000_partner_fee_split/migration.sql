-- Pricing v2: PayRouta's fee plus the partner's standard fee where PayRouta
-- pays the partner. Additive columns with zero defaults; existing rows keep
-- their original (v1) amounts.
ALTER TABLE "PaymentFee" ADD COLUMN "partnerFeeMinor" DECIMAL(50,0) NOT NULL DEFAULT 0;
ALTER TABLE "PlatformPayment" ADD COLUMN "partnerFeeMinor" DECIMAL(50,0) NOT NULL DEFAULT 0;
ALTER TABLE "PaymentFee" ADD CONSTRAINT "PaymentFee_partnerFeeMinor_nonnegative" CHECK ("partnerFeeMinor" >= 0);
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_partnerFeeMinor_nonnegative" CHECK ("partnerFeeMinor" >= 0 AND "partnerFeeMinor" <= "feeMinor");
