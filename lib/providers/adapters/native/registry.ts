import {
  solanaDepositConfigSchema,
  solanaDepositExecutionAdapter,
} from "./solana-deposit";
import {
  stellarDepositConfigSchema,
  stellarDepositExecutionAdapter,
} from "./stellar-deposit";
import { depositConfigSchema, depositExecutionAdapter } from "./erc20-deposit";
import {
  nativeDepositConfigSchema,
  nativeDepositExecutionAdapter,
} from "./evm-native-deposit";
import { opayConfigSchema, opayExecutionAdapter } from "./opay";
import { venmoConfigSchema, venmoExecutionAdapter } from "./paypal-venmo";
import { z } from "zod";
import type { ExecutionAdapter } from "../../normalized";
import type { NativeDeps } from "./common";
import { stripeConfigSchema, stripeExecutionAdapter } from "./stripe";
import { adyenConfigSchema, adyenExecutionAdapter } from "./adyen";
import { mtnConfigSchema, mtnExecutionAdapter } from "./mtn-momo";
import { paypayConfigSchema, paypayExecutionAdapter } from "./paypay";
import {
  coinbaseConfigSchema,
  coinbaseExecutionAdapter,
} from "./coinbase-business";
import { binanceConfigSchema, binanceExecutionAdapter } from "./binance-pay";

import { phonepeConfigSchema, phonepeExecutionAdapter } from "./phonepe";
import { xenditConfigSchema, xenditExecutionAdapter } from "./xendit";

import { mercadoConfigSchema, mercadoExecutionAdapter } from "./mercado-pago";

import { picpayConfigSchema, picpayExecutionAdapter } from "./picpay";

// Static allowlist. Provider configuration cannot import executable code.
export const nativeModules: readonly {
  id: string;
  schema: z.ZodType;
  create(config: unknown, deps: NativeDeps): ExecutionAdapter;
}[] = [
  {
    id: "evm-native-deposit",
    schema: nativeDepositConfigSchema,
    create: nativeDepositExecutionAdapter,
  },
  { id: "opay", schema: opayConfigSchema, create: opayExecutionAdapter },
  {
    id: "paypal-venmo",
    schema: venmoConfigSchema,
    create: venmoExecutionAdapter,
  },
  {
    id: "erc20-deposit",
    schema: depositConfigSchema,
    create: depositExecutionAdapter,
  },
  {
    id: "solana-deposit",
    schema: solanaDepositConfigSchema,
    create: solanaDepositExecutionAdapter,
  },
  {
    id: "stellar-deposit",
    schema: stellarDepositConfigSchema,
    create: stellarDepositExecutionAdapter,
  },
  { id: "picpay", schema: picpayConfigSchema, create: picpayExecutionAdapter },
  {
    id: "mercado-pago",
    schema: mercadoConfigSchema,
    create: mercadoExecutionAdapter,
  },
  {
    id: "phonepe",
    schema: phonepeConfigSchema,
    create: phonepeExecutionAdapter,
  },
  { id: "xendit", schema: xenditConfigSchema, create: xenditExecutionAdapter },
  { id: "stripe", schema: stripeConfigSchema, create: stripeExecutionAdapter },
  { id: "adyen", schema: adyenConfigSchema, create: adyenExecutionAdapter },
  { id: "mtn-momo", schema: mtnConfigSchema, create: mtnExecutionAdapter },
  { id: "paypay", schema: paypayConfigSchema, create: paypayExecutionAdapter },
  {
    id: "coinbase-business",
    schema: coinbaseConfigSchema,
    create: coinbaseExecutionAdapter,
  },
  {
    id: "binance-pay",
    schema: binanceConfigSchema,
    create: binanceExecutionAdapter,
  },
];

// Only the explicitly enabled sandbox simulator may invent settlement facts
// or repeat a creation after a lookup returned no payment.
export function simulatedIntegration(integration: {
  environment: string;
  config: unknown;
}) {
  return (
    integration.environment === "sandbox" &&
    (integration.config as { adapter?: string } | null)?.adapter === "simulator"
  );
}
