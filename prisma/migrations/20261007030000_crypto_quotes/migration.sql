ALTER TABLE "DepositBinding" ADD COLUMN "acceptBefore" TIMESTAMP(3);
ALTER TABLE "PaymentIntent" ADD COLUMN "cryptoQuoteId" TEXT;
CREATE TABLE "CryptoQuote" (
 "id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, "environment" TEXT NOT NULL,
 "key" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "request" JSONB NOT NULL,
 "terms" JSONB NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CryptoQuote_orgId_environment_key_key" ON "CryptoQuote"("orgId","environment","key");
CREATE TRIGGER crypto_quote_immutable BEFORE UPDATE OR DELETE ON "CryptoQuote" FOR EACH ROW EXECUTE FUNCTION payrouta_deposit_immutable();
CREATE FUNCTION payrouta_crypto_intent_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."cryptoQuoteId" IS DISTINCT FROM OLD."cryptoQuoteId" OR
    (OLD."cryptoQuoteId" IS NOT NULL AND NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt")
 THEN RAISE EXCEPTION 'Crypto quote terms are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER crypto_intent_immutable BEFORE UPDATE ON "PaymentIntent" FOR EACH ROW EXECUTE FUNCTION payrouta_crypto_intent_guard();
ALTER TABLE "PaymentIntent" ADD CONSTRAINT "PaymentIntent_cryptoQuoteId_fkey" FOREIGN KEY ("cryptoQuoteId") REFERENCES "CryptoQuote"("id");
