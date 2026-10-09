import { z } from "zod";
import { depositConfigSchema } from "../providers/adapters/native/erc20-deposit";
import { solanaDepositConfigSchema } from "../providers/adapters/native/solana-deposit";
import { stellarDepositConfigSchema } from "../providers/adapters/native/stellar-deposit";
import { chain } from "./chains";
import { nativeDepositConfigSchema } from "../providers/adapters/native/evm-native-deposit";
export const stablecoinDepositConfig = z.union([
  nativeDepositConfigSchema,
  depositConfigSchema,
  solanaDepositConfigSchema,
  stellarDepositConfigSchema,
]);
export function isDepositAdapter(adapter?: string) {
  return [
    "evm-native-deposit",
    "erc20-deposit",
    "solana-deposit",
    "stellar-deposit",
  ].includes(adapter || "");
}
export function depositAdapterKind(network: string, identifier = "") {
  const family = chain(network)?.family;
  return family === "evm"
    ? identifier.startsWith("native:")
      ? "evm-native-deposit"
      : "erc20-deposit"
    : family === "solana"
      ? "solana-deposit"
      : family === "stellar"
        ? "stellar-deposit"
        : undefined;
}
