import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ProviderHttpOptions } from "../http";
import type { ExecutionAdapter } from "../../normalized";

export const monnifyConfigSchema = z
  .object({
    adapter: z.literal("monnify").default("monnify"),
    mode: z.literal("NATIVE").default("NATIVE"),
    maintainedBy: z.literal("PAYROUTA").default("PAYROUTA"),
    baseUrl: z
      .string()
      .default("https://api.monnify.com"),
    apiKeyRef: z.string().max(100).optional(),
    secretKeyRef: z.string().max(100).optional(),
    contractCode: z.string().max(100).optional(),
    webhookSecretRef: z.string().max(100).optional(),
    timeoutMs: z.number().int().min(500).max(15000).default(8000),
  })
  .strict();

export type MonnifyConfig = z.infer<typeof monnifyConfigSchema>;

export type MonnifyDeps = {
  http: (
    baseUrl: string,
    options: ProviderHttpOptions,
  ) => Promise<{ status: number; headers: Record<string, string>; body: string }>;
  credentials: { get(ref: string): Promise<string> };
  clock?: () => Date;
};

export function monnifyExecutionAdapter(
  config: unknown,
  deps: MonnifyDeps,
): ExecutionAdapter {
  const parsed = monnifyConfigSchema.safeParse(config);
  if (!parsed.success) throw new PortalError("INVALID_CONFIGURATION", 409);
  const c = parsed.data;

  async function getAccessToken(): Promise<string> {
    if (!c.apiKeyRef || !c.secretKeyRef) {
      throw new PortalError("MONNIFY_CREDENTIALS_NOT_CONFIGURED", 409);
    }
    const apiKey = await deps.credentials.get(c.apiKeyRef);
    const secretKey = await deps.credentials.get(c.secretKeyRef);
    if (!apiKey || !secretKey) {
      throw new PortalError("MONNIFY_CREDENTIALS_NOT_CONFIGURED", 409);
    }

    const authHeader = `Basic ${Buffer.from(`${apiKey}:${secretKey}`).toString("base64")}`;
    const response = await deps.http(c.baseUrl, {
      method: "POST",
      path: "/api/v1/auth/login",
      headers: { Authorization: authHeader },
      timeoutMs: c.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new PortalError("MONNIFY_AUTH_FAILED", 502);
    }

    try {
      const data = JSON.parse(response.body || "{}");
      if (data.requestSuccessful && data.responseBody?.accessToken) {
        return data.responseBody.accessToken;
      }
    } catch {
      // ignore
    }
    throw new PortalError("MONNIFY_AUTH_FAILED", 502);
  }

  async function call(
    method: ProviderHttpOptions["method"],
    path: string,
    body?: string,
  ) {
    const token = await getAccessToken();
    const response = await deps.http(c.baseUrl, {
      method,
      path,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
      timeoutMs: c.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new PortalError("MONNIFY_API_ERROR", 502);
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
      if (!c.contractCode) {
        throw new PortalError("MONNIFY_CONTRACT_CODE_NOT_CONFIGURED", 409);
      }

      const methodKey = intent.selectedMethod === "card" ? "CARD" : "ACCOUNT_TRANSFER";
      const payload = {
        amount: intent.amount,
        customerName: "PayRouta Customer",
        customerEmail: "customer@payrouta.internal",
        paymentReference: attempt.key,
        paymentDescription: `PayRouta transaction ${intent.reference}`,
        currencyCode: "NGN",
        contractCode: c.contractCode,
        redirectUrl: "https://payrouta.internal/checkout/callback",
        paymentMethods: [methodKey],
      };

      const res = await call("POST", "/api/v1/merchant/transactions/init-transaction", JSON.stringify(payload));
      if (!res.requestSuccessful || !res.responseBody) {
        return { state: "Rejected", reference: "" };
      }

      return {
        state: "Pending",
        reference: res.responseBody.transactionReference || res.responseBody.paymentReference || attempt.key,
      };
    },
    async status(attempt) {
      const ref = attempt.providerReference || attempt.key;
      if (!ref) return null;

      const res = await call("GET", `/api/v2/transactions/${encodeURIComponent(ref)}`);
      if (!res.requestSuccessful || !res.responseBody) {
        return null;
      }

      const pStatus = (res.responseBody.paymentStatus || "").toUpperCase();
      let state = "Pending";
      if (pStatus === "PAID") state = "Confirmed";
      else if (["FAILED", "CANCELLED", "EXPIRED"].includes(pStatus)) state = "Rejected";

      return {
        state,
        reference: res.responseBody.transactionReference || ref,
        amount: String(res.responseBody.amountPaid ?? res.responseBody.amount ?? "0"),
        asset: { kind: "fiat", identifier: "NGN", network: "" },
      };
    },
    async cancel() {
      return { state: "Rejected" };
    },
    async payout(input) {
      const res = await call(
        "POST",
        "/api/v2/disbursements/single",
        JSON.stringify({
          amount: input.amount,
          reference: input.reference,
          narration: `Payout ${input.reference}`,
          currency: "NGN",
          destination: input.destination,
        }),
      );
      const state = res.requestSuccessful && res.responseBody?.status === "SUCCESS" ? "Confirmed" : "Pending";
      return { state, reference: res.responseBody?.reference || input.reference };
    },
    async verifyWebhook(input: unknown) {
      if (!c.webhookSecretRef) return false;
      const secret = await deps.credentials.get(c.webhookSecretRef);
      if (!secret) return false;
      return verifyMonnifyWebhook(secret, input);
    },
  };
}

export function verifyMonnifyWebhook(secret: string, input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  const { eventData, transactionHash } = input as {
    eventData?: {
      paymentReference?: string;
      amountPaid?: string | number;
      paidOn?: string;
      transactionReference?: string;
    };
    transactionHash?: string;
  };

  if (!transactionHash || !eventData) return false;

  const raw = `${secret}|${eventData.paymentReference ?? ""}|${eventData.amountPaid ?? ""}|${eventData.paidOn ?? ""}|${eventData.transactionReference ?? ""}`;
  const calculated = createHash("sha512").update(raw).digest("hex");

  if (calculated.length !== transactionHash.length) return false;
  return timingSafeEqual(Buffer.from(calculated, "hex"), Buffer.from(transactionHash, "hex"));
}
