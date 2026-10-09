-- PayRouta-owned onboarding (docs/AGGREGATOR.md §3a). Merchants give their
-- identity and payout details to PayRouta only; PayRouta passes them to its
-- processing partner by API. The details themselves live encrypted in the
-- secret store; these rows hold the reference and a masked summary.
CREATE TABLE "MerchantVerificationDetails" (
 id TEXT PRIMARY KEY,
 "orgId" TEXT NOT NULL REFERENCES "Organization"(id),
 version INTEGER NOT NULL CHECK (version > 0),
 "secretRef" TEXT NOT NULL,
 summary JSONB NOT NULL,
 fingerprint TEXT NOT NULL CHECK (fingerprint ~ '^[a-f0-9]{64}$'),
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "MerchantVerificationDetails_orgId_version_key" ON "MerchantVerificationDetails"("orgId",version);
CREATE TRIGGER immutable_verification_details BEFORE UPDATE OR DELETE ON "MerchantVerificationDetails" FOR EACH ROW EXECUTE FUNCTION deny_partner_record_mutation();

-- Acceptance of PayRouta's merchant terms (which incorporate the processing
-- partner's connected-account agreement): evidence the partner requires.
CREATE TABLE "MerchantAgreement" (
 id TEXT PRIMARY KEY,
 "orgId" TEXT NOT NULL REFERENCES "Organization"(id),
 version TEXT NOT NULL CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 "acceptedBy" TEXT NOT NULL,
 ip TEXT NOT NULL CHECK (length(ip) BETWEEN 2 AND 64),
 "userAgent" TEXT NOT NULL CHECK (length("userAgent") BETWEEN 1 AND 500),
 "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MerchantAgreement_orgId_acceptedAt_idx" ON "MerchantAgreement"("orgId","acceptedAt");
CREATE TRIGGER immutable_merchant_agreement BEFORE UPDATE OR DELETE ON "MerchantAgreement" FOR EACH ROW EXECUTE FUNCTION deny_partner_record_mutation();

-- What a merchant submitted for underwriting, and what each sub-account was
-- opened with.
ALTER TABLE "MerchantAccount" ADD COLUMN "detailsVersion" INTEGER, ADD COLUMN "agreementId" TEXT REFERENCES "MerchantAgreement"(id);
ALTER TABLE "MerchantAccount" ADD FOREIGN KEY ("orgId","detailsVersion") REFERENCES "MerchantVerificationDetails"("orgId",version);
ALTER TABLE "MerchantPlatformLink" ADD COLUMN "detailsVersion" INTEGER, ADD COLUMN "agreementId" TEXT REFERENCES "MerchantAgreement"(id);
ALTER TABLE "MerchantPlatformLink" ADD FOREIGN KEY ("orgId","detailsVersion") REFERENCES "MerchantVerificationDetails"("orgId",version);
