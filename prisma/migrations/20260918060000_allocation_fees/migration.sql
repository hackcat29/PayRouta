ALTER TABLE "SettlementAllocation" ADD COLUMN fee text NOT NULL DEFAULT '0';
UPDATE "SettlementAllocation" a SET fee=s.fee FROM "PaymentSettlement" s WHERE a."settlementId"=s.id AND (SELECT count(*) FROM "SettlementAllocation" x WHERE x."settlementId"=s.id)=1;
ALTER TABLE "SettlementAllocation" ADD CONSTRAINT allocation_fee CHECK (fee ~ '^[0-9]+$' AND fee::numeric <= amount::numeric);
