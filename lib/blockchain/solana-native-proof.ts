import type { DepositBinding } from "./deposit-types";
import { tokenMinor } from "./assets";
import { object } from "../providers/adapters/native/common";
import { PortalError } from "../portal/domain";
const integer = (value: unknown) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new PortalError("INVALID_RPC_RESPONSE", 502);
  return value;
};
// Both a successful System Program transfer and the exact recipient credit are
// required. A balance change, account creation or another mint cannot pay SOL.
export function verifySolanaNativeTransfer(
  raw: unknown,
  b: DepositBinding,
  txHash: string,
) {
  const r = object(raw),
    meta = object(r.meta),
    transaction = object(r.transaction),
    message = object(transaction.message);
  if (
    meta.err !== null ||
    !Array.isArray(transaction.signatures) ||
    transaction.signatures[0] !== txHash ||
    BigInt(integer(r.slot)) < b.startBlock ||
    !Array.isArray(message.accountKeys) ||
    !Array.isArray(message.instructions) ||
    !Array.isArray(meta.preBalances) ||
    !Array.isArray(meta.postBalances)
  )
    throw new PortalError("DEPOSIT_RECEIPT_MISMATCH", 502);
  const keys = message.accountKeys.map((k) =>
      typeof k === "string" ? k : object(k).pubkey,
    ),
    index = keys.indexOf(b.address);
  if (index < 0) return null;
  const instructions = [...message.instructions];
  if (Array.isArray(meta.innerInstructions))
    for (const inner of meta.innerInstructions) {
      const v = object(inner);
      if (!Array.isArray(v.instructions))
        throw new PortalError("INVALID_RPC_RESPONSE", 502);
      instructions.push(...v.instructions);
    }
  const incoming: { index: number; units: bigint }[] = [];
  for (const [i, rawInstruction] of instructions.entries()) {
    const instruction = object(rawInstruction);
    if (
      instruction.programId !== "11111111111111111111111111111111" ||
      !instruction.parsed
    )
      continue;
    const parsed = object(instruction.parsed),
      info = object(parsed.info);
    if (parsed.type !== "transfer" || info.destination !== b.address) continue;
    if (info.source === b.address)
      throw new PortalError("DEPOSIT_SELF_TRANSFER", 409);
    incoming.push({ index: i, units: BigInt(integer(info.lamports)) });
  }
  if (!incoming.length) return null;
  if (incoming.length !== 1)
    throw new PortalError("DEPOSIT_MULTIPLE_TRANSFERS", 409);
  const credited =
    BigInt(integer(meta.postBalances[index])) -
    BigInt(integer(meta.preBalances[index]));
  if (
    credited !== incoming[0].units ||
    credited !== tokenMinor(b.amount, b.precision)
  )
    throw new PortalError("DEPOSIT_AMOUNT_MISMATCH", 409);
  return {
    slot: integer(r.slot),
    logIndex: `ix:${incoming[0].index}`,
    amount: b.amount,
  };
}
