CREATE TABLE "DepositScan" (
 "attemptId" TEXT PRIMARY KEY REFERENCES "DepositBinding"("attemptId") ON DELETE RESTRICT,
 "nextBlock" BIGINT NOT NULL CHECK ("nextBlock" >= 0),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
