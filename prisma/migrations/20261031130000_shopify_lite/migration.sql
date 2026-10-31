-- Shopify with a manual payment method (lib/integrations/shopify-lite.ts).
CREATE TABLE "ShopifyLiteShop" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "accessTokenRef" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "cancelAfterHours" INTEGER NOT NULL,
    "methods" JSONB NOT NULL,
    "cryptoOptions" JSONB NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopifyLiteShop_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopifyLiteShop_shop_key" ON "ShopifyLiteShop"("shop");

CREATE TABLE "ShopifyLiteOrder" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "test" BOOLEAN NOT NULL,
    "statusUrl" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL,
    "checkoutKey" TEXT,
    "checkoutGroup" TEXT,
    "returnToken" TEXT,
    "state" TEXT NOT NULL DEFAULT 'Pending',
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ShopifyLiteOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShopifyLiteOrder_checkoutGroup_key" ON "ShopifyLiteOrder"("checkoutGroup");
CREATE UNIQUE INDEX "ShopifyLiteOrder_returnToken_key" ON "ShopifyLiteOrder"("returnToken");
CREATE UNIQUE INDEX "ShopifyLiteOrder_shop_orderId_key" ON "ShopifyLiteOrder"("shop", "orderId");
