-- The merchant's logo at checkout.
CREATE TABLE "MerchantLogo" (
    "orgId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MerchantLogo_pkey" PRIMARY KEY ("orgId"),
    CONSTRAINT "MerchantLogo_mime_check" CHECK ("mime" IN ('image/png', 'image/jpeg', 'image/webp')),
    CONSTRAINT "MerchantLogo_size_check" CHECK (octet_length("bytes") BETWEEN 8 AND 262144)
);
CREATE UNIQUE INDEX "MerchantLogo_key_key" ON "MerchantLogo"("key");
