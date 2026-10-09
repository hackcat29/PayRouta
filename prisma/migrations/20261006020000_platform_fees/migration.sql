ALTER TABLE "PaymentIntent" ADD COLUMN "feeSnapshot" JSONB;
CREATE TABLE "PaymentFee" (
 "intentId" TEXT PRIMARY KEY REFERENCES "PaymentIntent"(id) ON DELETE RESTRICT,
 "orgId" TEXT NOT NULL, environment TEXT NOT NULL, method TEXT NOT NULL, currency TEXT NOT NULL,
 precision INTEGER NOT NULL, "amountMinor" DECIMAL(50,0) NOT NULL CHECK ("amountMinor" >= 0),
 billable BOOLEAN NOT NULL, terms JSONB NOT NULL, "effectiveAt" TIMESTAMP(3) NOT NULL,
 CHECK (environment IN ('sandbox','production')),
 CHECK ((environment='sandbox' AND NOT billable AND "amountMinor"=0) OR (environment='production' AND billable AND currency ~ '^[A-Z]{3}$')),
 CHECK (precision BETWEEN 0 AND 3)
);
CREATE INDEX "PaymentFee_orgId_environment_effectiveAt_idx" ON "PaymentFee"("orgId",environment,"effectiveAt");
CREATE TABLE "BillingStatement" (
 id TEXT PRIMARY KEY, "orgId" TEXT NOT NULL, environment TEXT NOT NULL CHECK (environment='production'),
 month TEXT NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'), currency TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
 precision INTEGER NOT NULL CHECK (precision BETWEEN 0 AND 3), "amountMinor" DECIMAL(50,0) NOT NULL CHECK ("amountMinor">=0),
 lines JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "BillingStatement_orgId_environment_month_currency_precision_key" ON "BillingStatement"("orgId",environment,month,currency,precision);
CREATE TRIGGER immutable_platform_fee BEFORE UPDATE OR DELETE ON "PaymentFee" FOR EACH ROW EXECUTE FUNCTION payment_journal_immutable();
CREATE TRIGGER immutable_billing_statement BEFORE UPDATE OR DELETE ON "BillingStatement" FOR EACH ROW EXECUTE FUNCTION payment_journal_immutable();
CREATE FUNCTION payment_fee_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."feeSnapshot" IS DISTINCT FROM OLD."feeSnapshot" THEN RAISE EXCEPTION 'Payment fee terms are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_fee_snapshot BEFORE UPDATE ON "PaymentIntent" FOR EACH ROW EXECUTE FUNCTION payment_fee_snapshot_immutable();
CREATE OR REPLACE FUNCTION payment_posting_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entrybook text;
BEGIN
 SELECT book INTO entrybook FROM "JournalEntry" WHERE id=NEW."entryId" AND "postingTransaction"=txid_current();
 IF entrybook IS NULL THEN RAISE EXCEPTION 'Cannot append postings to a previously committed journal entry'; END IF;
 IF (entrybook='provider-merchant-operational' AND NEW.account IN ('provider-clearing','merchant-payable','provider-fee','merchant-settled','conversion-clearing'))
 OR (entrybook='payrouta-platform-accrual' AND NEW.account IN ('platform-receivable','platform-fee-revenue')) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Account does not belong to this journal book';
END $$;
CREATE FUNCTION payment_fee_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "PaymentIntent" i WHERE i.id=NEW."intentId" AND i."orgId"=NEW."orgId" AND i.environment=NEW.environment AND i.state='Confirmed' AND i."selectedMethod"=NEW.method AND i."feeSnapshot"=NEW.terms) THEN
  RAISE EXCEPTION 'Platform fee requires confirmed payment and matching immutable terms';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER platform_fee_scope BEFORE INSERT ON "PaymentFee" FOR EACH ROW EXECUTE FUNCTION payment_fee_scope();
