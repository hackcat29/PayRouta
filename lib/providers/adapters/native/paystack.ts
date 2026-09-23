import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ProviderHttpOptions } from "../http";
import type { ExecutionAdapter } from "../../normalized";

export const paystackConfigSchema = z
  .object({
    adapter: z.literal("paystack").default("paystack"),
    mode: z.literal("NATIVE").default("NATIVE"),
    maintainedBy: z.literal("PAYROUTA").default("PAYROUTA"),
    baseUrl: z
      .string()
      .default("https://api.paystack.co"),
    secretKeyRef: z.string().max(100).optional(),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

export type PaystackConfig = z.infer<typeof paystackConfigSchema>;

export type PaystackDeps = {
  http: (
    baseUrl: string,
    options: ProviderHttpOptions,
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  credentials: { get(ref: string): Promise<string> };
};

export function paystackExecutionAdapter(
  config: unknown,
  deps: PaystackDeps,
): ExecutionAdapter {
  const parsed = paystackConfigSchema.safeParse(config);
  if (!parsed.success) throw new PortalError("INVALID_CONFIGURATION", 409);
  const c = parsed.data;

  async function getSecret(): Promise<string> {
    if (!c.secretKeyRef) {
      throw new PortalError("PAYSTACK_CREDENTIALS_NOT_CONFIGURED", 409);
    }
    const secret = await deps.credentials.get(c.secretKeyRef);
    if (!secret) {
      throw new PortalError("PAYSTACK_CREDENTIALS_NOT_CONFIGURED", 409);
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
      throw new PortalError("PAYSTACK_API_ERROR", 502);
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
      let channels: string[] = ["card", "bank_transfer", "ussd"];
      if (intent.selectedMethod === "card") channels = ["card"];
      else if (intent.selectedMethod === "bank-transfer") channels = ["bank_transfer", "dedicated_nuban"];
      else if (intent.selectedMethod === "ussd") channels = ["ussd"];

      // Paystack expects amounts in minor currency units (e.g. kobo for NGN)
      const minorAmount = Math.round(Number(intent.amount) * 100);

      const payload = {
        reference: attempt.key,
        amount: minorAmount,
        currency: "NGN",
        email: "customer@payrouta.internal",
        channels,
        callback_url: "https://payrouta.internal/checkout/callback",
      };

      const res = await call("POST", "/transaction/initialize", JSON.stringify(payload));
      if (!res.status || !res.data) {
        return { state: "Rejected", reference: "" };
      }

      return {
        state: "Pending",
        reference: res.data.reference || attempt.key,
      };
    },
    async status(attempt) {
      const ref = attempt.providerReference || attempt.key;
      if (!ref) return null;

      const res = await call("GET", `/transaction/verify/${encodeURIComponent(ref)}`);
      if (!res.status || !res.data) {
        return null;
      }

      const pStatus = (res.data.status || "").toLowerCase();
      let state = "Pending";
      if (pStatus === "success") state = "Confirmed";
      else if (["failed", "abandoned"].includes(pStatus)) state = "Rejected";

      const majorAmount = (Number(res.data.amount || 0) / 100).toFixed(2);
      return {
        state,
        reference: res.data.reference || ref,
        amount: majorAmount,
        asset: { kind: "fiat", identifier: "NGN", network: "" },
      };
    },
    async cancel() {
      return { state: "Rejected" };
    },
    async payout(input) {
      const minorAmount = Math.round(Number(input.amount) * 100);
      const res = await call(
        "POST",
        "/transfer",
        JSON.stringify({
          source: "balance",
          amount: minorAmount,
          reference: input.reference,
          recipient: input.destination,
          reason: `Payout ${input.reference}`,
        }),
      );
      const state = res.status && res.data?.status === "success" ? "Confirmed" : "Pending";
      return { state, reference: res.data?.transfer_code || input.reference };
    },
    async verifyWebhook(input: unknown) {
      if (!c.secretKeyRef) return false;
      const secret = await deps.credentials.get(c.secretKeyRef);
      if (!secret) return false;
      const { body, signature } = (input ?? {}) as { body?: string; signature?: string };
      if (!body || !signature) return false;
      return verifyPaystackWebhook(secret, body, signature);
    },
  };
}

export function verifyPaystackWebhook(
  secret: string,
  rawBody: string,
  signature: string,
): boolean {
  if (!rawBody || !signature || !/^[a-f0-9]{128}$/i.test(signature)) return false;
  const hash = createHmac("sha512", secret).update(rawBody).digest("hex");
  return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(signature, "hex"));
}
