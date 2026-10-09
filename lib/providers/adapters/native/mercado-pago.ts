import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ExecutionAdapter } from "../../normalized";
import {
  nativeFields,
  assertHints,
  secretRef,
  httpsUrl,
  parseConfig,
  secret,
  request,
  fiatMoney,
  fiatAsset,
  amountField,
  textField,
  object,
  checkEnvironment,
  redirect,
  type NativeDeps,
} from "./common";
import { toMinorUnits, currencyExponent } from "../../../partners/money";

export const mercadoConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("mercado-pago"),
    accessTokenRef: secretRef,
    collectorId: z.string().regex(/^\d+$/),
    currency: z.enum(["BRL", "ARS", "MXN", "CLP", "COP", "PEN", "UYU"]),
    returnUrl: httpsUrl,
    cancelUrl: httpsUrl,
  })
  .strict();
const hosts = [
  "www.mercadopago.com.br",
  "www.mercadopago.com.ar",
  "www.mercadopago.com.mx",
  "www.mercadopago.cl",
  "www.mercadopago.com.co",
  "www.mercadopago.com.pe",
  "www.mercadopago.com.uy",
];
export function mercadoExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(mercadoConfigSchema, config);
  const call = async (method: "GET" | "POST", path: string, body?: unknown) =>
    request(deps, "https://api.mercadopago.com", {
      method,
      path,
      timeoutMs: c.timeoutMs,
      headers: {
        Authorization: `Bearer ${await secret(deps, c.accessTokenRef)}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      assertHints(intent, ["mercado-pago"]);
      const money = fiatMoney(intent);
      if (
        intent.selectedMethod !== "digital-wallet" ||
        money.currency !== c.currency
      )
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const value = Number(money.amount);
      if (
        toMinorUnits(
          amountField(value),
          currencyExponent(c.currency)!,
          c.currency,
        ) !== money.minor
      )
        throw new PortalError("INVALID_PROVIDER_AMOUNT", 409);
      const p = await call("POST", "/checkout/preferences", {
        external_reference: attempt.key,
        purpose: "wallet_purchase",
        items: [
          {
            id: attempt.key,
            title: `Payment ${intent.reference}`,
            quantity: 1,
            currency_id: c.currency,
            unit_price: value,
          },
        ],
        back_urls: {
          success: c.returnUrl,
          pending: c.returnUrl,
          failure: c.cancelUrl,
        },
      });
      if (String(p.collector_id) !== c.collectorId)
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      return {
        state: "Requires action",
        reference: textField(p.id),
        action: redirect(
          "Mercado Pago",
          c.environment === "sandbox" ? p.sandbox_init_point : p.init_point,
          hosts,
        ),
      };
    },
    async status(attempt) {
      // Search is an authenticated lookup by the durable order key, never a
      // second preference creation. Multiple receipts need reconciliation.
      const result = await call(
        "GET",
        `/v1/payments/search?external_reference=${encodeURIComponent(attempt.key)}&limit=2`,
      );
      const paging = object(result.paging);
      if (paging.total === 0) return null;
      if (
        paging.total !== 1 ||
        !Array.isArray(result.results) ||
        result.results.length !== 1
      )
        throw new PortalError("PROVIDER_MULTIPLE_RECEIPTS", 409);
      const p = object(result.results[0]);
      if (
        p.external_reference !== attempt.key ||
        String(p.collector_id) !== c.collectorId ||
        p.currency_id !== c.currency ||
        p.live_mode !== (c.environment === "production")
      )
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      if (!attempt.providerReference)
        throw new PortalError("PROVIDER_REFERENCE_RECOVERY_REQUIRED", 409);
      // A failed individual payment can be retried within the same wallet
      // preference. Do not conclude that the whole checkout is rejected.
      return {
        state: p.status === "approved" ? "Confirmed" : "Pending",
        reference: attempt.providerReference,
        amount: amountField(p.transaction_amount),
        asset: fiatAsset(c.currency),
      };
    },
  };
}
