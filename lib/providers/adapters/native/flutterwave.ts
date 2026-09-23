import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ProviderHttpOptions } from "../http";
import type { ExecutionAdapter } from "../../normalized";

export const flutterwaveConfigSchema = z
  .object({
    adapter: z.literal("flutterwave").default("flutterwave"),
    mode: z.literal("NATIVE").default("NATIVE"),
    maintainedBy: z.literal("PAYROUTA").default("PAYROUTA"),
    baseUrl: z
      .string()
      .default("https://api.flutterwave.com"),
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
      let paymentOptions = "card,banktransfer,mobilemoney";
      if (intent.selectedMethod === "card") paymentOptions = "card";
      else if (intent.selectedMethod === "bank-transfer") paymentOptions = "banktransfer,account";
      else if (intent.selectedMethod === "mobile-money")
        paymentOptions = "mobilemoneyghana,mobilemoneyfranco,mobilemoneyuganda,mobilemoneyrwanda,mobilemoneyzambia";

      const payload = {
        tx_ref: attempt.key,
        amount: intent.amount,
        currency: "NGN",
        redirect_url: "https://payrouta.internal/checkout/callback",
        payment_options: paymentOptions,
        customer: {
          email: "customer@payrouta.internal",
          name: "PayRouta Customer",
        },
      };

      const res = await call("POST", "/v3/payments", JSON.stringify(payload));
      if (res.status !== "success" || !res.data) {
        return { state: "Rejected", reference: "" };
      }

      return {
        state: "Pending",
        reference: attempt.key,
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
        reference: String(res.data.id || ref),
        amount: String(res.data.amount || "0"),
        asset: { kind: "fiat", identifier: res.data.currency || "NGN", network: "" },
      };
    },
    async cancel() {
      return { state: "Rejected" };
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
