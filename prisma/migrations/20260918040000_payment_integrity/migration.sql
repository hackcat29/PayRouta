ALTER TABLE "JournalEntry" ADD COLUMN "postingTransaction" bigint NOT NULL DEFAULT txid_current();
CREATE FUNCTION payment_posting_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "JournalEntry" WHERE id=NEW."entryId" AND "postingTransaction"=txid_current()) THEN
  RAISE EXCEPTION 'Cannot append postings to a previously committed journal entry';
 END IF;
 IF NEW.account NOT IN ('provider-clearing','merchant-payable','provider-fee','merchant-settled','conversion-clearing') THEN
  RAISE EXCEPTION 'Unknown operational account';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_posting_scope BEFORE INSERT ON "JournalPosting" FOR EACH ROW EXECUTE FUNCTION payment_posting_scope();
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT exact_settlement_totals CHECK (gross ~ '^[0-9]+$' AND fee ~ '^[0-9]+$' AND net ~ '^[0-9]+$' AND gross::numeric=fee::numeric+net::numeric);
ALTER TABLE "SettlementAllocation" ADD CONSTRAINT positive_allocation CHECK (amount ~ '^[0-9]+$' AND amount::numeric > 0);
