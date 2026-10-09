import { chain } from "./chains";
import {
  paymentAsset as tokenAsset,
  validPaymentAmount as validStablecoinAmount,
} from "./crypto-assets";
import type { DepositPayment } from "./wallet-payment";
export function validateStablecoinPayment(p: DepositPayment) {
  const token = tokenAsset(p.network, p.identifier),
    network = chain(p.network);
  if (
    !token ||
    !network ||
    !validStablecoinAmount(p.network, p.identifier, p.amount)
  )
    throw new Error("Invalid stablecoin payment instructions");
  const valid =
    network.family === "evm"
      ? /^0x[0-9a-f]{40}$/.test(p.address) &&
        p.address !== `0x${"0".repeat(40)}`
      : network.family === "solana"
        ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(p.address)
        : /^G[A-Z2-7]{55}$/.test(p.address);
  if (!valid) throw new Error("Invalid stablecoin receive address");
  return { token, network };
}

// Format decimal strings without rounding or converting large token values to Number.
export function displayTokenAmount(amount: string): string {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(amount)) return amount;
  const [whole, fraction = ""] = amount.split(".");
  return `${whole}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}
