-- Merchants choose who pays fees: absorb them ("merchant") or pass them to
-- the customer ("customer"), by default and per payment. The original and
-- raised amounts live in the immutable paymentOptions of each payment.
ALTER TABLE "MerchantConfig" ADD COLUMN "feeBearer" TEXT NOT NULL DEFAULT 'merchant';
ALTER TABLE "MerchantConfig" ADD CONSTRAINT "MerchantConfig_feeBearer_check" CHECK ("feeBearer" IN ('merchant','customer'));
ALTER TABLE "PaymentIntent" ADD COLUMN "feeBearer" TEXT NOT NULL DEFAULT 'merchant';
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_feeBearer_check" CHECK ("feeBearer" IN ('merchant','customer'));
CREATE FUNCTION payment_fee_bearer_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."feeBearer" IS DISTINCT FROM OLD."feeBearer" THEN
  RAISE EXCEPTION 'Fee bearer is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_fee_bearer BEFORE UPDATE ON "PaymentIntent" FOR EACH ROW EXECUTE FUNCTION payment_fee_bearer_immutable();
