-- Token and chain logos for the crypto checkout, served from PayRouta.
CREATE TABLE "TokenLogo" (
    "key" TEXT NOT NULL,
    "mime" TEXT,
    "bytes" BYTEA,
    "missing" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenLogo_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "TokenLogo_size_check" CHECK ("bytes" IS NULL OR octet_length("bytes") <= 262144)
);
