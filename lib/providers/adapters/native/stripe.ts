import { stripeBankTransfer } from "./stripe-bank-transfer";
import { z } from "zod";
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
  minorAmount,
  textField,
  checkEnvironment,
  metadata,
  redirect,
  mappedState,
  type NativeDeps,
} from "./common";
import { selectStripeTypes, stripePaymentTypes } from "./stripe-methods";
import { PortalError } from "../../../portal/domain";

export const stripeConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("stripe"),
    secretKeyRef: secretRef,
    accountId: z
      .string()
      .regex(/^acct_\w{1,64}$/)
      .optional(),
    returnUrl: httpsUrl,
    cancelUrl: httpsUrl,
    euBankTransferCountry: z.enum(["DE", "FR", "IE", "NL"]).default("DE"),
    enabledPaymentTypes: z
      .array(z.enum(stripePaymentTypes))
      .min(1)
      .default(["card"]),
  })
  .strict();
export function stripeExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(stripeConfigSchema, config);
  const call = async (
    method: "GET" | "POST",
    path: string,
    body?: URLSearchParams,
    key?: string,
  ) => {
    const token = await secret(deps, c.secretKeyRef);
    if (
      !token.startsWith(c.environment === "sandbox" ? "sk_test_" : "sk_live_")
    )
      throw new PortalError("PROVIDER_ENVIRONMENT_MISMATCH", 409);
    return request(deps, "https://api.stripe.com", {
      method,
      path,
      timeoutMs: c.timeoutMs,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(c.accountId ? { "Stripe-Account": c.accountId } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body?.toString(),
    });
  };
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      const money = fiatMoney(intent),
        m = metadata(intent);
      const types = selectStripeTypes(
        intent.selectedMethod ?? "",
        money.currency,
        c.enabledPaymentTypes,
        m.preferred_wallet ?? m.payment_rail,
      );
      const form = new URLSearchParams({
        mode: "payment",
        success_url: c.returnUrl,
        cancel_url: c.cancelUrl,
        client_reference_id: attempt.key,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": money.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": money.minor.toString(),
        "line_items[0][price_data][product_data][name]": `Payment ${intent.reference}`,
        "metadata[payrouta_attempt]": attempt.key,
      });
      types.forEach((type, i) => form.set(`payment_method_types[${i}]`, type));
      if (types.includes("wechat_pay"))
        form.set("payment_method_options[wechat_pay][client]", "web");
      if (types.includes("customer_balance")) {
        const options = stripeBankTransfer(types, money.currency, m.stripe_customer_id, c.euBankTransferCountry);
        form.set("customer", options.customer!);
        form.set("payment_method_options[customer_balance][funding_type]", "bank_transfer");
        form.set("payment_method_options[customer_balance][bank_transfer][type]", options.payment_method_options!.customer_balance.bank_transfer.type);
        if (money.currency === "EUR") form.set("payment_method_options[customer_balance][bank_transfer][eu_bank_transfer][country]", c.euBankTransferCountry);
      }
      const s = await call("POST", "/v1/checkout/sessions", form, attempt.key);
      return {
        state: "Requires action",
        reference: textField(s.id),
        action: redirect("Stripe", s.url, ["checkout.stripe.com"]),
      };
    },
    async status(attempt) {
      if (!attempt.providerReference) return null; // Never replay creation on a missing provider reference.
      const s = await call(
        "GET",
        `/v1/checkout/sessions/${encodeURIComponent(attempt.providerReference)}`,
      );
      if (
        s.id !== attempt.providerReference ||
        s.client_reference_id !== attempt.key ||
        s.livemode !== (c.environment === "production")
      )
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      const currency = textField(s.currency, 3).toUpperCase();
      const state =
        s.payment_status === "paid" && s.status === "complete"
          ? "Confirmed"
          : mappedState(s.status, {
              open: "Pending",
              complete: "Pending",
              expired: "Rejected",
            });
      return {
        state,
        reference: attempt.providerReference,
        amount: minorAmount(s.amount_total, currency),
        asset: fiatAsset(currency),
      };
    },
  };
}
