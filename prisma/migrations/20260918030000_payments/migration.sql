-- CreateTable
CREATE TABLE "MerchantConfig" (
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "returnOrigin" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'NG',
    "policy" TEXT NOT NULL DEFAULT 'balanced',
    "webhookUrl" TEXT,
    "webhookSecretRef" TEXT,
    "webhookKeyId" TEXT NOT NULL DEFAULT 'v1',

    CONSTRAINT "MerchantConfig_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "PaymentIntent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "asset" JSONB NOT NULL,
    "precision" INTEGER NOT NULL,
    "methods" JSONB NOT NULL,
    "settlement" JSONB NOT NULL,
    "returnUrl" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "selectedMethod" TEXT,
    "contextId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "routeId" TEXT,
    "scenario" TEXT NOT NULL DEFAULT 'success',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckoutSession" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "verifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CheckoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRoute" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "profileId" TEXT NOT NULL,
    "providerOrgId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Created',
    "providerReference" TEXT,
    "action" JSONB,
    "dispatchedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulatorPayment" (
    "key" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "asset" JSONB NOT NULL,
    "settlementState" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatorPayment_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PaymentInbox" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentInbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantEvent" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantDelivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "history" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchantDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSettlement" (
    "id" TEXT NOT NULL,
    "providerOrgId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "asset" JSONB NOT NULL,
    "gross" TEXT NOT NULL,
    "fee" TEXT NOT NULL,
    "net" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "reconciliation" TEXT NOT NULL DEFAULT 'Unverified',
    "evidence" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SettlementAllocation" (
    "id" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,

    CONSTRAINT "SettlementAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "reversalOf" TEXT,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalPosting" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "debit" DECIMAL(50,0) NOT NULL,
    "credit" DECIMAL(50,0) NOT NULL,

    CONSTRAINT "JournalPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReconciliation" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentException" (
    "id" TEXT NOT NULL,
    "intentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Unresolved',
    "timeline" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentIntent_orgId_environment_createdAt_idx" ON "PaymentIntent"("orgId", "environment", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentIntent_orgId_environment_key_key" ON "PaymentIntent"("orgId", "environment", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_key_key" ON "PaymentAttempt"("key");

-- CreateIndex
CREATE INDEX "PaymentAttempt_providerOrgId_environment_state_idx" ON "PaymentAttempt"("providerOrgId", "environment", "state");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_intentId_number_key" ON "PaymentAttempt"("intentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_integrationId_environment_providerReference_key" ON "PaymentAttempt"("integrationId", "environment", "providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "SimulatorPayment_reference_key" ON "SimulatorPayment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentInbox_integrationId_environment_eventId_key" ON "PaymentInbox"("integrationId", "environment", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantEvent_intentId_type_version_key" ON "MerchantEvent"("intentId", "type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantDelivery_eventId_key" ON "MerchantDelivery"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettlement_integrationId_environment_reference_key" ON "PaymentSettlement"("integrationId", "environment", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "SettlementAllocation_settlementId_intentId_key" ON "SettlementAllocation"("settlementId", "intentId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_source_key" ON "JournalEntry"("source");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReconciliation_fingerprint_key" ON "PaymentReconciliation"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentException_intentId_code_key" ON "PaymentException"("intentId", "code");

-- AddForeignKey
ALTER TABLE "CheckoutSession" ADD CONSTRAINT "CheckoutSession_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SettlementAllocation" ADD CONSTRAINT "SettlementAllocation_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "PaymentSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalPosting" ADD CONSTRAINT "JournalPosting_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Posted entries and lines are append-only, including direct database writes.
CREATE FUNCTION payment_journal_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial journal is immutable; append a reversal'; END $$;
CREATE TRIGGER immutable_entry BEFORE UPDATE OR DELETE ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION payment_journal_immutable();
CREATE TRIGGER immutable_posting BEFORE UPDATE OR DELETE ON "JournalPosting" FOR EACH ROW EXECUTE FUNCTION payment_journal_immutable();
ALTER TABLE "JournalPosting" ADD CONSTRAINT posting_nonnegative CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0));
CREATE FUNCTION payment_journal_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid text;
BEGIN
  IF TG_TABLE_NAME = 'JournalEntry' THEN eid := NEW.id; ELSE eid := NEW."entryId"; END IF;
  IF (SELECT count(*) < 2 OR COALESCE(sum(debit-credit),1) <> 0 FROM "JournalPosting" WHERE "entryId"=eid) THEN
    RAISE EXCEPTION 'Journal must have at least two balanced lines';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER balanced_entry AFTER INSERT ON "JournalEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_journal_balance();
CREATE CONSTRAINT TRIGGER balanced_posting AFTER INSERT ON "JournalPosting" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION payment_journal_balance();
CREATE UNIQUE INDEX one_active_payment_attempt ON "PaymentAttempt"("intentId") WHERE state IN ('Created','Dispatching','Requires action','Pending','Unknown','Confirmed');
