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
  minorAmount,
  textField,
  checkEnvironment,
  stableId,
  redirect,
  mappedState,
  type NativeDeps,
} from "./common";

export const phonepeConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("phonepe"),
    clientIdRef: secretRef,
    clientSecretRef: secretRef,
    clientVersion: z.number().int().positive(),
    merchantId: z.string().min(1).max(100),
    returnUrl: httpsUrl,
    enabledModes: z
      .array(z.enum(["CARD", "UPI_INTENT", "UPI_QR", "NET_BANKING"]))
      .min(1),
  })
  .strict();

// Standard Checkout v2; UPI is a bank rail. This does not restrict which UPI
// app the payer uses, nor pretend a UPI debit is a PhonePe wallet-balance debit.
export function phonepeExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(phonepeConfigSchema, config);
  const sandbox = c.environment === "sandbox";
  const origin = sandbox
    ? "https://api-preprod.phonepe.com"
    : "https://api.phonepe.com";
  const root = sandbox ? "/apis/pg-sandbox" : "/apis/pg";
  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const form = new URLSearchParams({
      client_id: await secret(deps, c.clientIdRef),
      client_secret: await secret(deps, c.clientSecretRef),
      client_version: String(c.clientVersion),
      grant_type: "client_credentials",
    });
    const auth = await request(deps, origin, {
      method: "POST",
      path: `${sandbox ? root : "/apis/identity-manager"}/v1/oauth/token`,
      timeoutMs: c.timeoutMs,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    return request(deps, origin, {
      method,
      path: `${root}${path}`,
      timeoutMs: c.timeoutMs,
      headers: {
        Authorization: `O-Bearer ${textField(auth.access_token, 10000)}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      assertHints(intent, [], ["upi", "net-banking"]);
      const money = fiatMoney(intent);
      if (money.currency !== "INR")
        throw new PortalError("UNSUPPORTED_PAYMENT_ASSET", 409);
      const rail = (intent.metadata as Record<string, unknown> | null)
        ?.payment_rail;
      const modes = c.enabledModes
        .filter((mode) =>
          rail === "upi"
            ? mode.startsWith("UPI_")
            : rail === "net-banking"
              ? mode === "NET_BANKING"
              : true,
        )
        .filter((mode) =>
          intent.selectedMethod === "card"
            ? mode === "CARD"
            : intent.selectedMethod === "bank-transfer"
              ? mode !== "CARD"
              : false,
        );
      if (!modes.length)
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const merchantOrderId = stableId(attempt.key);
      const p = await call("POST", "/checkout/v2/pay", {
        merchantOrderId,
        amount: money.value,
        expireAfter: 1200,
        disablePaymentRetry: true,
        paymentFlow: {
          type: "PG_CHECKOUT",
          merchantUrls: { redirectUrl: c.returnUrl },
          paymentModeConfig: {
            enabledPaymentModes: modes.map((type) => ({ type })),
          },
        },
      });
      return {
        state: "Requires action",
        reference: merchantOrderId,
        action: redirect("PhonePe", p.redirectUrl, [
          "mercury.phonepe.com",
          "mercury-t2.phonepe.com",
          "mercury-uat.phonepe.com",
        ]),
      };
    },
    async status(attempt) {
      const ref = stableId(attempt.key);
      const p = await call(
        "GET",
        `/checkout/v2/order/${ref}/status?details=true`,
      );
      if (p.merchantOrderId !== ref || p.merchantId !== c.merchantId)
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      return {
        state: mappedState(p.state, {
          COMPLETED: "Confirmed",
          FAILED: "Rejected",
          PENDING: "Pending",
        }),
        reference: ref,
        amount: minorAmount(p.amount, "INR"),
        asset: fiatAsset("INR"),
      };
    },
  };
}
