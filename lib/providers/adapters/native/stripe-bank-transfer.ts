import { PortalError } from "../../../portal/domain";
import type { StripePaymentType } from "./stripe-methods";
// Stripe supplies the bank instructions and reconciles customer cash balance.
// PayRouta never constructs account numbers or treats a transfer claim as paid.
export function stripeBankTransfer(
  types: readonly StripePaymentType[],
  currency: string,
  customer: unknown,
  country = "DE",
) {
  if (!types.includes("customer_balance")) return {};
  if (typeof customer !== "string" || !/^cus_\w{1,100}$/.test(customer))
    throw new PortalError("STRIPE_CUSTOMER_REQUIRED", 409);
  if (
    !(["EUR", "USD"] as string[]).includes(currency) ||
    !["DE", "FR", "IE", "NL"].includes(country)
  )
    throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
  return {
    customer,
    payment_method_options: {
      customer_balance: {
        funding_type: "bank_transfer",
        bank_transfer: {
          type: currency === "EUR" ? "eu_bank_transfer" : "us_bank_transfer",
          ...(currency === "EUR" ? { eu_bank_transfer: { country } } : {}),
        },
      },
    },
  };
}
