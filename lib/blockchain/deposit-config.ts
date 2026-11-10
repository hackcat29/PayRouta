import { z } from "zod";
import { depositConfigSchema } from "../providers/adapters/native/erc20-deposit";
import { solanaDepositConfigSchema } from "../providers/adapters/native/solana-deposit";
import { stellarDepositConfigSchema } from "../providers/adapters/native/stellar-deposit";
import { chain } from "./chains";
import { nativeDepositConfigSchema } from "../providers/adapters/native/evm-native-deposit";
import { intentsDepositConfigSchema } from "../providers/adapters/native/near-intents-deposit";
import { offrampConfigSchema } from "../providers/adapters/native/near-intents-offramp";
import { addressConfigSchema } from "../providers/adapters/native/near-intents-address";
// Receive-address pools, plus settlement into a merchant's NEAR Intents
// account (one account, no address pool) or straight to their bank through
// a cash-out partner (one funding address).
export const stablecoinDepositConfig = z.union([
  nativeDepositConfigSchema,
  depositConfigSchema,
  solanaDepositConfigSchema,
  stellarDepositConfigSchema,
  intentsDepositConfigSchema,
  offrampConfigSchema,
  addressConfigSchema,
]);
export const depositAdapters = [
  "evm-native-deposit",
  "erc20-deposit",
  "solana-deposit",
  "stellar-deposit",
  "near-intents-deposit",
  "near-intents-offramp",
  "near-intents-address",
];
export function isDepositAdapter(adapter?: string) {
  return depositAdapters.includes(adapter || "");
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
