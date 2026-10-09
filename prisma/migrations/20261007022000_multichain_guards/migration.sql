-- Preserve permanent receive-address uniqueness and immutability across all chain families.
ALTER TABLE "DepositBinding" DROP CONSTRAINT "DepositBinding_address_check";
ALTER TABLE "DepositBinding" ADD CONSTRAINT "DepositBinding_address_check" CHECK (
 ("network" ~ '^eip155:[0-9]+$' AND "address" ~ '^0x[0-9a-f]{40}$') OR
 ("network" IN ('solana:mainnet','solana:devnet') AND "address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') OR
 ("network" IN ('stellar:pubnet','stellar:testnet') AND "address" ~ '^G[A-Z2-7]{55}$')
);
-- Quoted choices are immutable. Only an offered choice may replace pre-payment terms.
CREATE OR REPLACE FUNCTION payment_fee_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE offered jsonb;
BEGIN
 IF NEW."paymentOptions" IS DISTINCT FROM OLD."paymentOptions" THEN
  RAISE EXCEPTION 'Quoted payment options are immutable';
 END IF;
 IF OLD."paymentOptions" IS NULL THEN
  IF NEW."feeSnapshot" IS DISTINCT FROM OLD."feeSnapshot" THEN
   RAISE EXCEPTION 'Payment fee terms are immutable';
  END IF;
 ELSIF NEW."selectedOption" IS DISTINCT FROM OLD."selectedOption" OR
       NEW.amount IS DISTINCT FROM OLD.amount OR NEW.asset IS DISTINCT FROM OLD.asset OR
       NEW.precision IS DISTINCT FROM OLD.precision OR NEW.settlement IS DISTINCT FROM OLD.settlement OR
       NEW."contextId" IS DISTINCT FROM OLD."contextId" OR NEW."feeSnapshot" IS DISTINCT FROM OLD."feeSnapshot" THEN
  IF OLD.state <> 'Open' OR NEW.state <> 'Open' OR EXISTS(SELECT 1 FROM "PaymentAttempt" WHERE "intentId"=OLD.id) THEN
   RAISE EXCEPTION 'Payment token and network are locked after an attempt';
  END IF;
  SELECT v INTO offered FROM jsonb_array_elements(OLD."paymentOptions") v WHERE v->>'id'=NEW."selectedOption";
  IF offered IS NULL OR NEW.amount IS DISTINCT FROM offered->>'amount' OR NEW.asset IS DISTINCT FROM offered->'asset' OR
     NEW.precision IS DISTINCT FROM (offered->>'precision')::integer OR NEW.settlement IS DISTINCT FROM offered->'settlement' OR
     NEW."contextId" IS DISTINCT FROM offered->>'contextId' OR NEW."feeSnapshot" IS DISTINCT FROM offered->'feeSnapshot' THEN
   RAISE EXCEPTION 'Payment terms must match an immutable merchant quote';
  END IF;
 END IF;
 RETURN NEW;
END $$;
