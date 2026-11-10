-- PayRouta's fee on NEAR Intents checkouts, withheld at source by 1Click.
ALTER TABLE "CrossChainPayment" ADD COLUMN "appFeeMinor" TEXT;
ALTER TABLE "CrossChainPayment" ADD COLUMN "appFeeBps" INTEGER;
