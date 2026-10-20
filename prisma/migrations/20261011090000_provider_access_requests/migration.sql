-- Provider access is by invitation. Requests from the public form wait here
-- for an operations admin to approve (which creates the organization and an
-- owner invitation) or decline.
CREATE TABLE "ProviderAccessRequest" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "providerType" TEXT NOT NULL,
    "methods" TEXT NOT NULL,
    "markets" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "orgId" TEXT,
    "invitationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProviderAccessRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProviderAccessRequest_state_check" CHECK ("state" IN ('Pending','Approved','Declined'))
);
CREATE UNIQUE INDEX "ProviderAccessRequest_submissionId_key" ON "ProviderAccessRequest"("submissionId");
CREATE INDEX "ProviderAccessRequest_state_createdAt_idx" ON "ProviderAccessRequest"("state", "createdAt");
CREATE INDEX "ProviderAccessRequest_email_idx" ON "ProviderAccessRequest"("email");
