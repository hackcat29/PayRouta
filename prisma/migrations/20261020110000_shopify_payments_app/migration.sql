-- Shopify payments app: installed shops, payment sessions and refund sessions.
CREATE TABLE "ShopifyShop" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orgId" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'sandbox',
    "accessTokenRef" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "methods" JSONB NOT NULL,
    "cryptoOptions" JSONB NOT NULL,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopifyShop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopifyShop_shop_key" ON "ShopifyShop"("shop");

CREATE TABLE "ShopifyPaymentSession" (
    "id" TEXT NOT NULL,
    "gid" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "checkoutGroup" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "test" BOOLEAN NOT NULL,
    "cancelUrl" TEXT NOT NULL,
    "checkoutKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "nextActionUrl" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopifyPaymentSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopifyPaymentSession_gid_key" ON "ShopifyPaymentSession"("gid");
CREATE UNIQUE INDEX "ShopifyPaymentSession_checkoutGroup_key" ON "ShopifyPaymentSession"("checkoutGroup");
CREATE INDEX "ShopifyPaymentSession_shop_createdAt_idx" ON "ShopifyPaymentSession"("shop", "createdAt");

CREATE TABLE "ShopifyRefundSession" (
    "id" TEXT NOT NULL,
    "gid" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "refundId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopifyRefundSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopifyRefundSession_gid_key" ON "ShopifyRefundSession"("gid");
