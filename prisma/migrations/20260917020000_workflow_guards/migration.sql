-- Submission content is immutable even if a future application path attempts to mutate it.
CREATE FUNCTION deny_submission_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Submission snapshots are immutable'; END $$;
CREATE TRIGGER immutable_submission BEFORE UPDATE OR DELETE ON "Submission" FOR EACH ROW EXECUTE FUNCTION deny_submission_mutation();
ALTER TABLE "Membership" ADD CONSTRAINT valid_provider_role CHECK (role IN ('Owner','Admin','Developer','Compliance','Analyst'));
ALTER TABLE "User" ADD CONSTRAINT valid_internal_role CHECK ("internalRole" IS NULL OR "internalRole" IN ('Reviewer','Operations admin'));
ALTER TABLE "Application" ADD CONSTRAINT valid_application_state CHECK (state IN ('Draft','Submitted','Under review','Changes requested','Resubmitted','Approved','Rejected','Withdrawn'));
ALTER TABLE "Transaction" ADD CONSTRAINT exact_amount CHECK (amount ~ '^(0|[1-9][0-9]{0,29})(\.[0-9]{1,18})?$');
ALTER TABLE "Settlement" ADD CONSTRAINT exact_settlement_amount CHECK (amount ~ '^(0|[1-9][0-9]{0,29})(\.[0-9]{1,18})?$');
ALTER TABLE "Transaction" ADD CONSTRAINT transaction_tenant_key UNIQUE (id,"orgId",environment);
ALTER TABLE "Settlement" ADD CONSTRAINT settlement_transaction_tenant FOREIGN KEY ("transactionId","orgId",environment) REFERENCES "Transaction"(id,"orgId",environment);
ALTER TABLE "Capability" ADD CONSTRAINT capability_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE "Integration" ADD CONSTRAINT integration_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE "Transaction" ADD CONSTRAINT transaction_environment CHECK (environment IN ('sandbox','production'));
ALTER TABLE "Credential" ADD CONSTRAINT credential_environment CHECK (environment IN ('sandbox','production'));
