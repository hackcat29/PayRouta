CREATE TABLE "Secret" ("id" TEXT PRIMARY KEY CHECK ("id" ~ '^[a-f0-9-]{36}$'), "keyId" TEXT NOT NULL, "iv" BYTEA NOT NULL, "tag" BYTEA NOT NULL, "ciphertext" BYTEA, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "rotatedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3), CHECK (("revokedAt" IS NULL) = ("ciphertext" IS NOT NULL)));
CREATE INDEX "Secret_keyId_idx" ON "Secret"("keyId");
