CREATE TABLE "DepositBinding" (
 "attemptId" TEXT PRIMARY KEY REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT,
 "attemptKey" TEXT NOT NULL UNIQUE,
 "integrationId" TEXT NOT NULL REFERENCES "Integration"("id") ON DELETE RESTRICT,
 "environment" TEXT NOT NULL CHECK ("environment" IN ('sandbox','production')),
 "network" TEXT NOT NULL,
 "identifier" TEXT NOT NULL,
 "address" TEXT NOT NULL CHECK ("address" ~ '^0x[0-9a-f]{40}$'),
 "amount" TEXT NOT NULL,
 "precision" INTEGER NOT NULL,
 "startBlock" BIGINT NOT NULL CHECK ("startBlock" >= 0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("network","address")
);
CREATE TABLE "DepositClaim" (
 "id" TEXT PRIMARY KEY,
 "attemptId" TEXT NOT NULL UNIQUE REFERENCES "DepositBinding"("attemptId") ON DELETE RESTRICT,
 "network" TEXT NOT NULL,
 "txHash" TEXT NOT NULL,
 "logIndex" TEXT NOT NULL,
 "blockHash" TEXT NOT NULL,
 "amount" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("network","txHash","logIndex")
);
CREATE FUNCTION payrouta_deposit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Deposit bindings and claims are immutable'; END;
$$;
CREATE TRIGGER deposit_binding_immutable BEFORE UPDATE OR DELETE ON "DepositBinding" FOR EACH ROW EXECUTE FUNCTION payrouta_deposit_immutable();
CREATE TRIGGER deposit_claim_immutable BEFORE UPDATE OR DELETE ON "DepositClaim" FOR EACH ROW EXECUTE FUNCTION payrouta_deposit_immutable();
