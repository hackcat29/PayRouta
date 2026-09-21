ALTER TABLE "Membership" ADD COLUMN "merchantRole" TEXT CHECK ("merchantRole" IN ('Owner','Admin','Developer','Finance','Analyst'));
ALTER TABLE "Invitation" ADD COLUMN "participation" TEXT NOT NULL DEFAULT 'provider' CHECK ("participation" IN ('provider','merchant'));
-- Preserve existing access only for organizations already configured as merchants.
UPDATE "Membership" m SET "merchantRole" = CASE WHEN m.role IN ('Owner','Admin','Developer','Analyst') THEN m.role ELSE 'Analyst' END WHERE EXISTS (SELECT 1 FROM "MerchantConfig" c WHERE c."orgId"=m."orgId");
