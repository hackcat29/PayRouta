-- Which receive stablecoin payments in other tokens settle into (lib/intents/checkout.ts).
ALTER TABLE "MerchantConfig" ADD COLUMN "swapSettlement" JSONB;
