export interface DepositBinding {
  attemptId: string;
  attemptKey: string;
  integrationId: string;
  environment: string;
  network: string;
  identifier: string;
  address: string;
  amount: string;
  precision: number;
  startBlock: bigint;
  acceptBefore?: Date | null;
}
export interface DepositStore {
  claimed?(binding: DepositBinding): Promise<{
    txHash: string;
    logIndex: string;
    blockHash: string;
    amount: string;
  } | null>;
  checkpoint?(
    binding: DepositBinding,
  ): Promise<{ nextBlock: bigint; cursor: string | null }>;
  advanceCheckpoint?(
    binding: DepositBinding,
    nextBlock: bigint,
    cursor: string | null,
    expected: { nextBlock: bigint; cursor: string | null },
  ): Promise<void>;
  scanStart?(binding: DepositBinding): Promise<bigint>;
  advanceScan?(binding: DepositBinding, nextBlock: bigint): Promise<void>;
  allocate(
    input: Omit<DepositBinding, "address" | "integrationId"> & {
      addresses: string[];
    },
  ): Promise<DepositBinding>;
  find(attemptId: string): Promise<DepositBinding | null>;
  claim(
    binding: DepositBinding,
    evidence: {
      txHash: string;
      logIndex: string;
      blockHash: string;
      amount: string;
    },
  ): Promise<void>;
}
