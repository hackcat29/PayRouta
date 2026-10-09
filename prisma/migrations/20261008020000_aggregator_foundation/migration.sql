-- Aggregator foundation (docs/AGGREGATOR.md, phase 1). PayRouta companies,
-- their master accounts at providers, merchant underwriting state, and a
-- merchant-funds ledger book whose balances the database itself keeps
-- non-negative.

CREATE TABLE "LegalEntity" (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
 jurisdiction TEXT NOT NULL CHECK (jurisdiction ~ '^[A-Z]{2}(-[A-Z0-9]{1,3})?$'),
 -- Countries where this company itself is licensed to hold merchant funds
 -- (custody "payrouta-held"). Partner-held and split-settlement accounts rely
 -- on the provider's licence instead.
 "licensedCountries" JSONB NOT NULL DEFAULT '[]' CHECK (jsonb_typeof("licensedCountries") = 'array'),
 "updatedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL
);

-- A PayRouta master account at a provider (Stripe Connect platform, Adyen
-- balance platform, Paystack main account, ...). Secrets are secret-manager
-- references inside config, never values.
CREATE TABLE "PlatformAccount" (
 id TEXT PRIMARY KEY,
 "legalEntityId" TEXT NOT NULL REFERENCES "LegalEntity"(id),
 provider TEXT NOT NULL CHECK (provider ~ '^[a-z][a-z0-9-]{1,40}$'),
 environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
 custody TEXT NOT NULL CHECK (custody IN ('partner-held','split-settlement','payrouta-held')),
 "merchantCountries" JSONB NOT NULL CHECK (jsonb_typeof("merchantCountries") = 'array' AND jsonb_array_length("merchantCountries") > 0),
 config JSONB NOT NULL,
 enabled BOOLEAN NOT NULL DEFAULT false,
 "qualifiedAt" TIMESTAMP(3),
 qualification JSONB,
 "updatedBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (("qualifiedAt" IS NULL) = (qualification IS NULL))
);
CREATE UNIQUE INDEX "PlatformAccount_legalEntityId_provider_environment_key" ON "PlatformAccount"("legalEntityId",provider,environment);

-- One underwriting record per merchant and environment. Only "Live" may move
-- money through a PayRouta platform account; merchant-owned partner accounts
-- (custody "merchant-owned") never need one.
CREATE TABLE "MerchantAccount" (
 id TEXT PRIMARY KEY,
 "orgId" TEXT NOT NULL REFERENCES "Organization"(id),
 environment TEXT NOT NULL CHECK (environment IN ('sandbox','production')),
 state TEXT NOT NULL DEFAULT 'Submitted' CHECK (state IN ('Submitted','Underwriting','Returned','Live','Restricted','Offboarding','Closed')),
 "profileVersion" INTEGER NOT NULL,
 "legalEntityId" TEXT REFERENCES "LegalEntity"(id),
 "riskTier" TEXT CHECK ("riskTier" IN ('low','standard','elevated','high')),
 terms JSONB,
 version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 FOREIGN KEY ("orgId","profileVersion") REFERENCES "MerchantKybProfile"("orgId","version"),
 -- Underwriting decisions are recorded before a merchant can ever be live.
 CHECK (state IN ('Submitted','Underwriting','Returned') OR ("legalEntityId" IS NOT NULL AND "riskTier" IS NOT NULL AND terms IS NOT NULL))
);
CREATE UNIQUE INDEX "MerchantAccount_orgId_environment_key" ON "MerchantAccount"("orgId",environment);
CREATE INDEX "MerchantAccount_state_updatedAt_idx" ON "MerchantAccount"(state,"updatedAt");

CREATE TABLE "MerchantAccountTransition" (
 id TEXT PRIMARY KEY,
 "merchantAccountId" TEXT NOT NULL REFERENCES "MerchantAccount"(id),
 "from" TEXT,
 "to" TEXT NOT NULL,
 reason TEXT NOT NULL CHECK (length(reason) >= 10),
 "actorId" TEXT NOT NULL,
 evidence JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MerchantAccountTransition_merchantAccountId_createdAt_idx" ON "MerchantAccountTransition"("merchantAccountId","createdAt");
CREATE TRIGGER immutable_merchant_account_transition BEFORE UPDATE OR DELETE ON "MerchantAccountTransition" FOR EACH ROW EXECUTE FUNCTION deny_partner_record_mutation();

-- Merchant-funds book: what PayRouta owes each merchant for money held at a
-- platform account. Every entry names the platform account that holds the
-- funds, so balances reconcile against that provider's reports.
ALTER TABLE "JournalEntry" ADD COLUMN "platformAccountId" TEXT REFERENCES "PlatformAccount"(id);
ALTER TABLE "JournalEntry" ADD CONSTRAINT journal_platform_account_scope CHECK ((book = 'merchant-funds') = ("platformAccountId" IS NOT NULL));

CREATE FUNCTION merchant_funds_entry_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.book <> 'merchant-funds' THEN RETURN NEW; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM "MerchantAccount" m JOIN "PlatformAccount" p ON p."legalEntityId" = m."legalEntityId"
  WHERE m."orgId" = NEW."orgId" AND m.environment = NEW.environment AND p.id = NEW."platformAccountId"
   AND p.environment = NEW.environment AND m.state IN ('Live','Restricted','Offboarding')
 ) THEN
  RAISE EXCEPTION 'Merchant funds require an underwritten merchant on a platform account of its legal entity';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_merchant_funds_scope BEFORE INSERT ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION merchant_funds_entry_scope();

CREATE OR REPLACE FUNCTION payment_posting_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entrybook text;
BEGIN
 SELECT book INTO entrybook FROM "JournalEntry" WHERE id=NEW."entryId" AND "postingTransaction"=txid_current();
 IF entrybook IS NULL THEN RAISE EXCEPTION 'Cannot append postings to a previously committed journal entry'; END IF;
 IF (entrybook='provider-merchant-operational' AND NEW.account IN ('provider-clearing','merchant-payable','provider-fee','merchant-settled','conversion-clearing'))
 OR (entrybook='payrouta-platform-accrual' AND NEW.account IN ('platform-receivable','platform-fee-revenue'))
 OR (entrybook='merchant-funds' AND NEW.account IN ('funds-clearing','merchant-pending','merchant-available','merchant-reserve','merchant-dispute-hold','merchant-receivable','payout-in-transit','fee-collected')) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Account does not belong to this journal book';
END $$;

-- Running balance per merchant, asset and account (credit minus debit), kept
-- by the posting trigger below in the same transaction as the posting. The
-- row lock taken by the update serialises concurrent postings, and the CHECK
-- refuses any entry that would overdraw what PayRouta owes the merchant.
CREATE TABLE "MerchantBalance" (
 "orgId" TEXT NOT NULL,
 environment TEXT NOT NULL,
 asset TEXT NOT NULL,
 account TEXT NOT NULL,
 balance DECIMAL(50,0) NOT NULL DEFAULT 0,
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("orgId",environment,asset,account),
 CONSTRAINT merchant_balance_not_overdrawn CHECK (
  (account IN ('merchant-pending','merchant-available','merchant-reserve','merchant-dispute-hold','payout-in-transit','fee-collected') AND balance >= 0)
  OR (account = 'merchant-receivable' AND balance <= 0)
  OR account = 'funds-clearing'
 )
);

CREATE FUNCTION merchant_balance_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e "JournalEntry"%ROWTYPE;
BEGIN
 SELECT * INTO e FROM "JournalEntry" WHERE id = NEW."entryId";
 IF e.book <> 'merchant-funds' THEN RETURN NEW; END IF;
 -- Create the row at zero first: INSERT ... ON CONFLICT would check the CHECK
 -- constraint against the proposed row (the bare delta) before detecting the
 -- conflict, refusing a valid debit to an existing balance.
 INSERT INTO "MerchantBalance" ("orgId",environment,asset,account,balance,"updatedAt")
 VALUES (e."orgId", e.environment, e.asset, NEW.account, 0, CURRENT_TIMESTAMP)
 ON CONFLICT ("orgId",environment,asset,account) DO NOTHING;
 UPDATE "MerchantBalance" SET balance = balance + NEW.credit - NEW.debit, "updatedAt" = CURRENT_TIMESTAMP
 WHERE "orgId" = e."orgId" AND environment = e.environment AND asset = e.asset AND account = NEW.account;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_merchant_balance AFTER INSERT ON "JournalPosting" FOR EACH ROW EXECUTE FUNCTION merchant_balance_apply();

-- Balances change only through journal postings.
CREATE FUNCTION merchant_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF pg_trigger_depth() < 2 THEN RAISE EXCEPTION 'Merchant balances change only through journal postings'; END IF;
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Merchant balances are never deleted'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_merchant_balance BEFORE INSERT OR UPDATE OR DELETE ON "MerchantBalance" FOR EACH ROW EXECUTE FUNCTION merchant_balance_guard();
