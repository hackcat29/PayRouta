-- CreateTable
CREATE TABLE "BillingCustomer" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "meters" JSONB NOT NULL,
    "methods" JSONB NOT NULL,
    "crypto" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Incomplete',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "slug" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "amount" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'Open',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "checkoutPath" TEXT,
    "checkoutExpiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "remindedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "quantity" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "invoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingCustomer_orgId_environment_email_key" ON "BillingCustomer"("orgId", "environment", "email");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_orgId_environment_createdAt_idx" ON "SubscriptionPlan"("orgId", "environment", "createdAt");

-- CreateIndex
CREATE INDEX "Subscription_orgId_environment_createdAt_idx" ON "Subscription"("orgId", "environment", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_slug_key" ON "SubscriptionInvoice"("slug");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_orgId_environment_createdAt_idx" ON "SubscriptionInvoice"("orgId", "environment", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_subscriptionId_number_key" ON "SubscriptionInvoice"("subscriptionId", "number");

-- CreateIndex
CREATE INDEX "UsageRecord_subscriptionId_meter_occurredAt_idx" ON "UsageRecord"("subscriptionId", "meter", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_subscriptionId_idempotencyKey_key" ON "UsageRecord"("subscriptionId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "BillingCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
