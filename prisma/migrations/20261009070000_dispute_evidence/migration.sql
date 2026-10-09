-- Evidence a merchant submitted through PayRouta for a dispute, as sent to
-- the processing partner. Submitted once; the provider decides.
ALTER TABLE "PlatformDispute" ADD COLUMN evidence JSONB, ADD COLUMN "evidenceSubmittedAt" TIMESTAMP(3), ADD COLUMN "evidenceSubmittedBy" TEXT;
ALTER TABLE "PlatformDispute" ADD CONSTRAINT dispute_evidence_recorded CHECK ((evidence IS NULL) = ("evidenceSubmittedAt" IS NULL) AND (evidence IS NULL) = ("evidenceSubmittedBy" IS NULL));
