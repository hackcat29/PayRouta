-- Split-settlement rails (Paystack, Flutterwave subaccounts): the provider may
-- take its processing fee from the merchant's share, and pays the merchant
-- directly rather than holding funds for a PayRouta payout.
ALTER TABLE "PlatformPayment" ADD COLUMN "providerFeeMinor" DECIMAL(50,0) NOT NULL DEFAULT 0 CHECK ("providerFeeMinor" >= 0);
ALTER TABLE "PlatformPayment" ADD COLUMN "settledDirectly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlatformPayment" ADD CONSTRAINT platform_payment_shares CHECK ("feeMinor" + "providerFeeMinor" <= "grossMinor");
