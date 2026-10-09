import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ExecutionAdapter } from "../../normalized";
import {
  nativeFields,
  secretRef,
  httpsUrl,
  parseConfig,
  secret,
  request,
  fiatMoney,
  fiatAsset,
  amountField,
  textField,
  checkEnvironment,
  redirect,
  mappedState,
  type NativeDeps,
} from "./common";

export const xenditConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("xendit"),
    secretKeyRef: secretRef,
    currency: z.enum(["IDR", "PHP", "THB"]),
    returnUrl: httpsUrl,
    cancelUrl: httpsUrl,
    enabledWallets: z.array(z.enum(["SHOPEEPAY", "GCASH", "GRABPAY"])).min(1),
  })
  .strict();
const hints: Record<string, string> = {
  shopeepay: "SHOPEEPAY",
  gcash: "GCASH",
  grabpay: "GRABPAY",
};
export function xenditExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(xenditConfigSchema, config);
  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const key = await secret(deps, c.secretKeyRef);
    if (
      !key.startsWith(
        c.environment === "sandbox" ? "xnd_development_" : "xnd_production_",
      )
    )
      throw new PortalError("PROVIDER_ENVIRONMENT_MISMATCH", 409);
    return request(deps, "https://api.xendit.co", {
      method,
      path,
      timeoutMs: c.timeoutMs,
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      const money = fiatMoney(intent);
      if (
        intent.selectedMethod !== "digital-wallet" ||
        money.currency !== c.currency
      )
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const m = intent.metadata as Record<string, unknown> | null;
      const hint = m?.preferred_wallet;
      const methods = c.enabledWallets.filter(
        (w) =>
          hint === undefined || (typeof hint === "string" && hints[hint] === w),
      );
      if (!methods.length)
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const value = Number(money.amount);
      // Xendit invoices accept numeric major units. Verify exact round-trip,
      // rather than rounding a decimal or sending minor units as major units.
      if (
        amountField(value) !==
        money.amount.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")
      )
        throw new PortalError("INVALID_PROVIDER_AMOUNT", 409);
      const i = await call("POST", "/v2/invoices", {
        external_id: attempt.key,
        amount: value,
        currency: money.currency,
        description: `Payment ${intent.reference}`,
        payment_methods: methods,
        should_send_email: false,
        success_redirect_url: c.returnUrl,
        failure_redirect_url: c.cancelUrl,
      });
      return {
        state: "Requires action",
        reference: textField(i.id),
        action: redirect("Xendit", i.invoice_url, ["checkout.xendit.co"]),
      };
    },
    async status(attempt) {
      if (!attempt.providerReference) return null;
      const i = await call(
        "GET",
        `/v2/invoices/${encodeURIComponent(attempt.providerReference)}`,
      );
      if (
        i.id !== attempt.providerReference ||
        i.external_id !== attempt.key ||
        i.currency !== c.currency
      )
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      // Only an allowed wallet receipt can confirm this wallet checkout.
      if (
        ["PAID", "SETTLED"].includes(String(i.status)) &&
        (i.payment_method !== "EWALLET" ||
          !c.enabledWallets.includes(i.ewallet_type as never))
      )
        throw new PortalError("PROVIDER_METHOD_MISMATCH", 502);
      return {
        state: mappedState(i.status, {
          PAID: "Confirmed",
          SETTLED: "Confirmed",
          PENDING: "Pending",
          EXPIRED: "Rejected",
        }),
        reference: attempt.providerReference,
        amount: amountField(i.paid_amount ?? i.amount),
        asset: fiatAsset(c.currency),
      };
    },
  };
}
