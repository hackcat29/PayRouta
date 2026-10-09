import { PortalError } from "../../../portal/domain";
import type { PaymentMethodId } from "../../normalized";

// Explicit provider API types. Apple/Google Pay are card wallets in Stripe
// Checkout and cannot be isolated from plain cards there; use Adyen's distinct
// wallet types when the requested PayRouta method is digital-wallet.
export const stripePaymentTypes = [
  "card",
  "alipay",
  "wechat_pay",
  "grabpay",
  "cashapp",
  "revolut_pay",
  "paypay",
  "paypal",
  "klarna",
  "affirm",
  "sepa_debit",
  "us_bank_account",
  "pix",
  "customer_balance",
] as const;
export type StripePaymentType = (typeof stripePaymentTypes)[number];
export const stripeMethod: Record<StripePaymentType, PaymentMethodId> = {
  card: "card",
  alipay: "digital-wallet",
  wechat_pay: "digital-wallet",
  grabpay: "digital-wallet",
  cashapp: "digital-wallet",
  revolut_pay: "digital-wallet",
  paypay: "digital-wallet",
  paypal: "digital-wallet",
  klarna: "bnpl",
  affirm: "bnpl",
  sepa_debit: "direct-debit",
  us_bank_account: "direct-debit",
  pix: "bank-transfer",
  customer_balance: "bank-transfer",
};
const currencies: Partial<Record<StripePaymentType, readonly string[]>> = {
  grabpay: ["SGD", "MYR"],
  cashapp: ["USD"],
  paypay: ["JPY"],
  affirm: ["USD", "CAD"],
  sepa_debit: ["EUR"],
  us_bank_account: ["USD"],
  pix: ["BRL"],
  customer_balance: ["EUR", "USD"],
};
const hints: Record<string, StripePaymentType> = {
  "wechat-pay": "wechat_pay",
  "cash-app": "cashapp",
  "revolut-pay": "revolut_pay",
  alipay: "alipay",
  grabpay: "grabpay",
  paypay: "paypay",
  paypal: "paypal",
  klarna: "klarna",
  affirm: "affirm",
  sepa: "sepa_debit",
  ach: "us_bank_account",
  pix: "pix",
  customer_balance: "customer_balance",
};
export function selectStripeTypes(
  method: string,
  currency: string,
  enabled: readonly StripePaymentType[],
  hint?: unknown,
) {
  if (
    method === "bank-transfer" &&
    (hint === "sepa" ||
      hint === "ach" ||
      hint === "sepa-credit" ||
      hint === "us-bank-transfer")
  )
    hint = "customer_balance";
  let types = enabled.filter(
    (t) =>
      stripeMethod[t] === method &&
      (!currencies[t] || currencies[t]!.includes(currency)),
  );
  if (hint !== undefined) {
    const preferred = typeof hint === "string" ? hints[hint] : undefined;
    types = preferred ? types.filter((t) => t === preferred) : [];
  }
  if (!types.length) throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
  return types;
}
