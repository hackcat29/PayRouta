import { test } from "node:test";
import assert from "node:assert/strict";
import { verifySolanaNativeTransfer } from "../lib/blockchain/solana-native-proof";
import type { DepositBinding } from "../lib/blockchain/deposit-types";
const b: DepositBinding = {
  attemptId: "a",
  attemptKey: "k",
  integrationId: "i",
  environment: "sandbox",
  network: "solana:devnet",
  identifier: "native:SOL",
  address: "recipient",
  amount: "0.000001001",
  precision: 9,
  startBlock: 100n,
};
const receipt = () => ({
  slot: 101,
  meta: {
    err: null,
    preBalances: [1000000, 20000],
    postBalances: [993999, 21001],
  },
  transaction: {
    signatures: ["signature"],
    message: {
      accountKeys: ["payer", "recipient"],
      instructions: [
        {
          programId: "11111111111111111111111111111111",
          parsed: {
            type: "transfer",
            info: { source: "payer", destination: "recipient", lamports: 1001 },
          },
        },
      ],
    },
  },
});
test("native SOL requires exact successful System Program credit", () => {
  assert.equal(
    verifySolanaNativeTransfer(receipt(), b, "signature")?.amount,
    b.amount,
  );
});
test("SOL balance-only credits, mismatched amounts, wrong signatures and failed transfers cannot confirm", () => {
  const balanceOnly = receipt();
  balanceOnly.transaction.message.instructions = [];
  assert.equal(verifySolanaNativeTransfer(balanceOnly, b, "signature"), null);
  const wrong = receipt();
  wrong.meta.postBalances[1]++;
  assert.throws(
    () => verifySolanaNativeTransfer(wrong, b, "signature"),
    /AMOUNT_MISMATCH/,
  );
  assert.throws(
    () => verifySolanaNativeTransfer(receipt(), b, "another-signature"),
    /RECEIPT_MISMATCH/,
  );
  const failed = {
    ...receipt(),
    meta: { ...receipt().meta, err: { InstructionError: [0, "failed"] } },
  };
  assert.throws(
    () => verifySolanaNativeTransfer(failed, b, "signature"),
    /RECEIPT_MISMATCH/,
  );
  const self = receipt();
  self.transaction.message.instructions[0].parsed.info.source = b.address;
  assert.throws(
    () => verifySolanaNativeTransfer(self, b, "signature"),
    /SELF_TRANSFER/,
  );
  const duplicate = receipt();
  duplicate.transaction.message.instructions.push(
    duplicate.transaction.message.instructions[0],
  );
  assert.throws(
    () => verifySolanaNativeTransfer(duplicate, b, "signature"),
    /MULTIPLE_TRANSFERS/,
  );
});
