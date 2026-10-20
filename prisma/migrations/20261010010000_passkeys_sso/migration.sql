-- Passkeys (WebAuthn) and company single sign-on (SAML/OIDC).
CREATE TABLE "Passkey" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT,
  "publicKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "credentialID" TEXT NOT NULL,
  "counter" INTEGER NOT NULL,
  "deviceType" TEXT NOT NULL,
  "backedUp" BOOLEAN NOT NULL,
  "transports" TEXT,
  "createdAt" TIMESTAMP(3),
  "aaguid" TEXT
);
CREATE INDEX "Passkey_userId_idx" ON "Passkey"("userId");
CREATE INDEX "Passkey_credentialID_idx" ON "Passkey"("credentialID");

CREATE TABLE "SsoProvider" (
  "id" TEXT PRIMARY KEY,
  "issuer" TEXT NOT NULL,
  "oidcConfig" TEXT,
  "samlConfig" TEXT,
  "userId" TEXT REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "providerId" TEXT NOT NULL,
  "organizationId" TEXT,
  "domain" TEXT NOT NULL,
  "domainVerified" BOOLEAN
);
CREATE UNIQUE INDEX "SsoProvider_providerId_key" ON "SsoProvider"("providerId");
CREATE INDEX "SsoProvider_organizationId_idx" ON "SsoProvider"("organizationId");
CREATE INDEX "SsoProvider_domain_idx" ON "SsoProvider"("domain");
