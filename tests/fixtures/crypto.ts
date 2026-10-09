import {
  Account,
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { chain } from "../../lib/blockchain/chains";
export function stellarAccountData(address: string) {
  return xdr.LedgerEntryData.account(
    new xdr.AccountEntry({
      accountId: Keypair.fromPublicKey(address).xdrPublicKey(),
      balance: 1000000000n,
      seqNum: 12n,
      numSubEntries: 0,
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: Buffer.from([1, 1, 1, 1]),
      signers: [],
      ext: xdr.AccountEntryExt.fromXdrObject({ v: 0 }),
    }),
  ).toXDR("base64");
}
export function stellarPaymentReceipt(
  network: string,
  payer: Keypair,
  recipient: string,
  amount: string,
  asset = Asset.native(),
) {
  const tx = new TransactionBuilder(new Account(payer.publicKey(), "12"), {
    fee: "100",
    networkPassphrase: chain(network)!.passphrase!,
  })
    .addOperation(Operation.payment({ destination: recipient, asset, amount }))
    .setTimebounds(0, 2000000000)
    .build();
  tx.sign(payer);
  const result = new xdr.TransactionResult({
    feeCharged: 100n,
    result: xdr.TransactionResultResult.txSuccess([
      xdr.OperationResult.opInner(
        xdr.OperationResultTr.payment(xdr.PaymentResult.paymentSuccess()),
      ),
    ]),
    ext: xdr.TransactionResultExt.fromXdrObject({ v: 0 }),
  });
  return {
    status: "SUCCESS",
    ledger: 101,
    txHash: Buffer.from(tx.hash()).toString("hex"),
    envelopeXdr: tx.toXDR(),
    resultXdr: result.toXDR("base64"),
  };
}
