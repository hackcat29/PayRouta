-- Universal checkout: intents for one order that the customer chooses
-- between (fiat methods and credit, or crypto). Only one of a group can be
-- paid; the group is enforced in lib/payments/universal.ts.
ALTER TABLE "PaymentIntent" ADD COLUMN "checkoutGroup" TEXT;
CREATE INDEX "PaymentIntent_checkoutGroup_idx" ON "PaymentIntent"("checkoutGroup");
