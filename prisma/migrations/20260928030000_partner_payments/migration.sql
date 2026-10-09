ALTER TABLE "PartnerConnection" ADD COLUMN "qualifiedAt" TIMESTAMP(3), ADD COLUMN "qualification" JSONB;
ALTER TABLE "PartnerConnection" ADD CONSTRAINT partner_qualification_evidence CHECK (("qualifiedAt" IS NULL) = ("qualification" IS NULL));
ALTER TABLE "PartnerEvent" ADD COLUMN "objectRef" TEXT;
CREATE INDEX "PartnerEvent_partnerId_environment_objectRef_idx" ON "PartnerEvent"("partnerId","environment","objectRef");
