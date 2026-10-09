CREATE TABLE "MerchantKybProfile" ("id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL REFERENCES "Organization"("id"), "version" INTEGER NOT NULL CHECK ("version" > 0), "data" JSONB NOT NULL, "fingerprint" TEXT NOT NULL CHECK ("fingerprint" ~ '^[a-f0-9]{64}$'), "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "MerchantKybProfile_orgId_version_key" ON "MerchantKybProfile"("orgId","version");

CREATE TABLE "MerchantScreening" ("id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL REFERENCES "Organization"("id"), "profileVersion" INTEGER NOT NULL, "provider" TEXT NOT NULL, "verdict" TEXT NOT NULL CHECK ("verdict" IN ('clear','review','match')), "results" JSONB NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY ("orgId","profileVersion") REFERENCES "MerchantKybProfile"("orgId","version"));
CREATE INDEX "MerchantScreening_orgId_profileVersion_createdAt_idx" ON "MerchantScreening"("orgId","profileVersion","createdAt");

CREATE TABLE "PartnerConnection" ("id" TEXT PRIMARY KEY, "partnerId" TEXT NOT NULL, "environment" TEXT NOT NULL CHECK ("environment" IN ('sandbox','production')), "config" JSONB NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false, "updatedBy" TEXT NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "PartnerConnection_partnerId_environment_key" ON "PartnerConnection"("partnerId","environment");

CREATE TABLE "PartnerConsent" ("id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL REFERENCES "Organization"("id"), "partnerId" TEXT NOT NULL, "environment" TEXT NOT NULL CHECK ("environment" IN ('sandbox','production')), "profileVersion" INTEGER NOT NULL, "fields" JSONB NOT NULL, "disclosureFingerprint" TEXT NOT NULL, "grantedBy" TEXT NOT NULL, "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3), "revokedBy" TEXT, FOREIGN KEY ("orgId","profileVersion") REFERENCES "MerchantKybProfile"("orgId","version"), CHECK (("revokedAt" IS NULL) = ("revokedBy" IS NULL)));
CREATE INDEX "PartnerConsent_orgId_partnerId_environment_idx" ON "PartnerConsent"("orgId","partnerId","environment");

CREATE TABLE "PartnerApplication" ("id" TEXT PRIMARY KEY, "orgId" TEXT NOT NULL REFERENCES "Organization"("id"), "partnerId" TEXT NOT NULL, "environment" TEXT NOT NULL CHECK ("environment" IN ('sandbox','production')), "consentId" TEXT NOT NULL REFERENCES "PartnerConsent"("id"), "profileVersion" INTEGER NOT NULL, "state" TEXT NOT NULL DEFAULT 'Queued' CHECK ("state" IN ('Queued','Pending provider','Action required','Under review','Approved','Restricted','Rejected','Disconnected','Failed')), "accountRef" TEXT, "providerAccountId" TEXT, "requirements" JSONB NOT NULL DEFAULT '[]', "paymentsEnabled" BOOLEAN NOT NULL DEFAULT false, "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false, "reason" TEXT, "disclosedFingerprint" TEXT, "integrationId" TEXT REFERENCES "Integration"("id"), "submittedAt" TIMESTAMP(3), "approvedAt" TIMESTAMP(3), "lastCheckedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE UNIQUE INDEX "PartnerApplication_orgId_partnerId_environment_key" ON "PartnerApplication"("orgId","partnerId","environment");
CREATE UNIQUE INDEX "PartnerApplication_partnerId_environment_accountRef_key" ON "PartnerApplication"("partnerId","environment","accountRef");
CREATE INDEX "PartnerApplication_state_lastCheckedAt_idx" ON "PartnerApplication"("state","lastCheckedAt");

CREATE TABLE "PartnerEvent" ("id" TEXT PRIMARY KEY, "partnerId" TEXT NOT NULL, "environment" TEXT NOT NULL, "eventId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL, "type" TEXT NOT NULL, "accountRef" TEXT, "providerAccountId" TEXT, "state" TEXT NOT NULL DEFAULT 'Received', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "PartnerEvent_partnerId_environment_eventId_key" ON "PartnerEvent"("partnerId","environment","eventId");

-- What a merchant declared, what was screened and what they agreed to share
-- are evidence for partners: never edited or deleted.
CREATE FUNCTION deny_partner_record_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME; END $$;
CREATE TRIGGER immutable_kyb_profile BEFORE UPDATE OR DELETE ON "MerchantKybProfile" FOR EACH ROW EXECUTE FUNCTION deny_partner_record_mutation();
CREATE TRIGGER immutable_merchant_screening BEFORE UPDATE OR DELETE ON "MerchantScreening" FOR EACH ROW EXECUTE FUNCTION deny_partner_record_mutation();
CREATE TRIGGER immutable_partner_consent_delete BEFORE DELETE ON "PartnerConsent" FOR EACH ROW EXECUTE FUNCTION deny_partner_record_mutation();
CREATE FUNCTION protect_partner_consent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD."revokedAt" IS NOT NULL OR (to_jsonb(NEW) - 'revokedAt' - 'revokedBy') IS DISTINCT FROM (to_jsonb(OLD) - 'revokedAt' - 'revokedBy') THEN RAISE EXCEPTION 'Consent can only be revoked once; grant a new consent instead'; END IF; RETURN NEW; END $$;
CREATE TRIGGER revoke_only_partner_consent BEFORE UPDATE ON "PartnerConsent" FOR EACH ROW EXECUTE FUNCTION protect_partner_consent();
