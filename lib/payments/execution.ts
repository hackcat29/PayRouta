import { db } from "../portal/db";
import { localMode, secretManager } from "../portal/adapters";
import { PortalError } from "../portal/domain";
import { json } from "../portal/service";
import { providerRequest } from "../providers/adapters/http";
import { standardExecutionAdapter } from "../providers/standard/adapter";
import { configurableExecutionAdapter } from "../providers/adapters/configurable";
import type { PaymentAttempt, PaymentIntent } from "../generated/prisma/client";
export interface ExecutionAdapter {
  operations: readonly string[];
  create(
    attempt: PaymentAttempt,
    intent: PaymentIntent,
  ): Promise<{ state: string; reference: string }>;
  // Keyed by the attempt so each adapter resolves the provider-side identifier
  // it needs (a durable PayRouta key for the simulator, a provider payment id
  // for an external integration).
  status(attempt: PaymentAttempt): Promise<{
    state: string;
    reference: string;
    amount: string;
    asset: unknown;
  } | null>;
}
// Extends the existing simulator with restart-safe provider-side idempotency.
export const persistentSimulator: ExecutionAdapter = {
  operations: [
    "create-payment",
    "payment-status",
    "customer-action",
    "settlement-status",
    "transaction-report",
  ],
  async create(attempt, intent) {
    if (!localMode() || attempt.environment !== "sandbox")
      throw new PortalError("SANDBOX_ONLY");
    if (
      intent.scenario === "rejected" ||
      (intent.scenario === "fallback" && attempt.number === 1)
    )
      return { state: "Rejected", reference: "" };
    const record = await db.simulatorPayment.upsert({
      where: { key: attempt.key },
      create: {
        key: attempt.key,
        reference: `test-${attempt.id}`,
        state: intent.scenario === "action" ? "Requires action" : "Confirmed",
        amount: intent.amount,
        asset: json(intent.asset),
      },
      update: {},
    });
    if (intent.scenario === "timeout")
      return { state: "Unknown", reference: record.reference };
    return { state: record.state, reference: record.reference };
  },
  async status(attempt) {
    return db.simulatorPayment.findUnique({ where: { key: attempt.key } });
  },
};

export function sandboxInstructions(
  method: string,
  reference: string,
  amount: string,
  asset: unknown,
  expiresAt: Date,
) {
  const instructions: Record<string, string> = {
    "bank-transfer": `Fictional Test Bank. Beneficiary: Fictional Market. Test account: TEST-NOT-PAYABLE. Reference: ${reference}. Do not send money.`,
    card: "Provider sandbox card action. No card number or security code is collected. Complete the fictional authorization below.",
    "mobile-money":
      "Fictional mobile-money prompt issued. Complete the sandbox prompt below; no phone number or real wallet is charged.",
    stablecoin: `Fictional deposit address: TEST-NOT-PAYABLE-${reference}. This is not a valid blockchain address. Do not send tokens.`,
  };
  return {
    kind: "sandbox",
    method,
    reference,
    amount,
    asset,
    expiresAt: expiresAt.toISOString(),
    text: instructions[method] || "Fictional payment action.",
  };
}

import { monnifyExecutionAdapter } from "../providers/adapters/native/monnify";
import { paystackExecutionAdapter } from "../providers/adapters/native/paystack";
import { flutterwaveExecutionAdapter } from "../providers/adapters/native/flutterwave";

// Resolve by immutable integration configuration. No default-to-simulator path:
// unknown or unqualified adapters must never generate fictional financial facts.
export function resolveExecutionAdapter(integration: {
  environment: string;
  config: unknown;
}): ExecutionAdapter {
  const config = (integration.config ?? {}) as {
    adapter?: string;
    mode?: string;
  };
  if (config.adapter === "simulator") {
    if (integration.environment !== "sandbox" || !localMode())
      throw new PortalError("SANDBOX_ONLY", 409);
    return persistentSimulator;
  }
  if (config.mode === "STANDARD")
    return standardExecutionAdapter(config, {
      http: providerRequest,
      credentials: secretManager,
      clock: () => new Date(),
    });
  if (config.mode === "CONFIGURABLE")
    return configurableExecutionAdapter(config, {
      http: providerRequest,
      credentials: secretManager,
    });
  if (config.mode === "NATIVE") {
    if (config.adapter === "monnify")
      return monnifyExecutionAdapter(config, {
        http: providerRequest,
        credentials: secretManager,
        clock: () => new Date(),
      });
    if (config.adapter === "paystack")
      return paystackExecutionAdapter(config, {
        http: providerRequest,
        credentials: secretManager,
      });
    if (config.adapter === "flutterwave")
      return flutterwaveExecutionAdapter(config, {
        http: providerRequest,
        credentials: secretManager,
      });
  }
  throw new PortalError("EXECUTION_ADAPTER_NOT_QUALIFIED", 409);
}
