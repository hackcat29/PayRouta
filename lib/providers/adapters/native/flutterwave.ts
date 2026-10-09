import { timingSafeEqual } from "node:crypto";
import { fiatMoney, fiatAsset, amountField, metadata, redirect, httpsUrl } from "./common";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ProviderHttpOptions } from "../http";
import type { ExecutionAdapter } from "../../normalized";

export const flutterwaveConfigSchema = z
  .object({
    adapter: z.literal("flutterwave").default("flutterwave"),
    mode: z.literal("NATIVE").default("NATIVE"),
    maintainedBy: z.literal("PAYROUTA").default("PAYROUTA"),
    baseUrl: z.literal("https://api.flutterwave.com").default("https://api.flutterwave.com"),
    returnUrl: httpsUrl.optional(),
    paymentOptionsControlled: z.boolean().default(false),
    secretKeyRef: z.string().max(100).optional(),
    webhookSecretRef: z.string().max(100).optional(),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

export type FlutterwaveConfig = z.infer<typeof flutterwaveConfigSchema>;

export type FlutterwaveDeps = {
  http: (
    baseUrl: string,
    options: ProviderHttpOptions,
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  credentials: { get(ref: string): Promise<string> };
};

export function flutterwaveExecutionAdapter(
  config: unknown,
  deps: FlutterwaveDeps,
): ExecutionAdapter {
  const parsed = flutterwaveConfigSchema.safeParse(config);
  if (!parsed.success) throw new PortalError("INVALID_CONFIGURATION", 409);
  const c = parsed.data;

  async function getSecret(): Promise<string> {
    if (!c.secretKeyRef) {
      throw new PortalError("FLUTTERWAVE_CREDENTIALS_NOT_CONFIGURED", 409);
    }
    const secret = await deps.credentials.get(c.secretKeyRef);
    if (!secret) {
      throw new PortalError("FLUTTERWAVE_CREDENTIALS_NOT_CONFIGURED", 409);
    }
    return secret;
  }

  async function call(
    method: ProviderHttpOptions["method"],
    path: string,
    body?: string,
  ) {
    const secret = await getSecret();
    const response = await deps.http(c.baseUrl, {
      method,
      path,
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body,
      timeoutMs: c.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new PortalError("FLUTTERWAVE_API_ERROR", 502);
    }
    return response.body ? JSON.parse(response.body) : {};
  }

  return {
    operations: [
      "create-payment",
      "payment-status",
      "cancel-payment",
      "payout",
      "verify-event",
    ],
    async create(attempt, intent) {
      await getSecret();
      const money = fiatMoney(intent), m = metadata(intent);
      if (!c.returnUrl || !z.email().safeParse(m.payer_email).success || !c.paymentOptionsControlled)
        throw new PortalError("PROVIDER_CUSTOMER_DETAILS_REQUIRED", 409);
      const mobile: Record<string, string> = { KES: "mpesa", GHS: "mobilemoneyghana", UGX: "mobilemoneyuganda", RWF: "mobilemoneyrwanda", ZMW: "mobilemoneyzambia", TZS: "mobilemoneytanzania", XAF: "mobilemoneyfranco", XOF: "mobilemoneyfranco" };
      const paymentOptions = intent.selectedMethod === "card" ? "card"
        : intent.selectedMethod === "bank-transfer" && money.currency === "NGN" ? "banktransfer"
        : intent.selectedMethod === "ussd" && money.currency === "NGN" ? "ussd"
        : intent.selectedMethod === "mobile-money" ? mobile[money.currency] : undefined;
      if (!paymentOptions) throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const key = await getSecret();
      if ((/TEST/i.test(key)) !== (attempt.environment === "sandbox"))
        throw new PortalError("PROVIDER_ENVIRONMENT_MISMATCH", 409);

      const payload = {
        tx_ref: attempt.key,
        amount: intent.amount,
        currency: money.currency,
        redirect_url: c.returnUrl,
        payment_options: paymentOptions,
        customer: {
          email: m.payer_email,
        },
      };

      const res = await call("POST", "/v3/payments", JSON.stringify(payload));
      if (res.status !== "success" || !res.data) {
        return { state: "Rejected", reference: "" };
      }

      return {
        state: "Requires action",
        reference: attempt.key,
        action: redirect("Flutterwave", res.data.link, ["checkout.flutterwave.com", "ravemodal-dev.herokuapp.com"]),
      };
    },
    async status(attempt) {
      const ref = attempt.providerReference || attempt.key;
      if (!ref) return null;

      const res = await call(
        "GET",
        `/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(ref)}`,
      );
      if (res.status !== "success" || !res.data) {
        return null;
      }

      const pStatus = (res.data.status || "").toLowerCase();
      let state = "Pending";
      if (pStatus === "successful") state = "Confirmed";
      else if (pStatus === "failed") state = "Rejected";

      return {
        state,
        reference: String(res.data.tx_ref || ref),
        amount: amountField(res.data.amount),
        asset: fiatAsset(String(res.data.currency ?? "")),
      };
    },
    async cancel() {
      throw new PortalError("UNSUPPORTED_OPERATION", 409);
    },
    async payout(input) {
      const res = await call(
        "POST",
        "/v3/transfers",
        JSON.stringify({
          account_bank: (input.destination as { bankCode?: string })?.bankCode || "044",
          account_number: (input.destination as { accountNumber?: string })?.accountNumber || "",
          amount: Number(input.amount),
          narration: `Payout ${input.reference}`,
          currency: "NGN",
          reference: input.reference,
        }),
      );
      const state = res.status === "success" && res.data?.status === "SUCCESSFUL" ? "Confirmed" : "Pending";
      return { state, reference: String(res.data?.id || input.reference) };
    },
    async verifyWebhook(input: unknown) {
      if (!c.webhookSecretRef) return false;
      const secret = await deps.credentials.get(c.webhookSecretRef);
      if (!secret) return false;
      const { signature } = (input ?? {}) as { signature?: string };
      if (!signature) return false;
      return verifyFlutterwaveWebhook(secret, signature);
    },
  };
}

export function verifyFlutterwaveWebhook(
  secret: string,
  suppliedSignature: string,
): boolean {
  if (!suppliedSignature || secret.length !== suppliedSignature.length) return false;
  return timingSafeEqual(Buffer.from(secret), Buffer.from(suppliedSignature));
}
