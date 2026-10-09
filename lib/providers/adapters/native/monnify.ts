import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { toMinorUnits } from "../../../partners/money";
import { PortalError } from "../../../portal/domain";
import type { ExecutionAdapter } from "../../normalized";
import {
  assertHints,
  checkEnvironment,
  fiatMoney,
  fiatAsset,
  amountField,
  nativeFields,
  metadata,
  object,
  parseConfig,
  request,
  secret,
  secretRef,
  redirect,
  httpsUrl,
  textField,
  type NativeDeps,
} from "./common";
export const monnifyConfigSchema = z
  .object({
    ...nativeFields,
    environment: z.enum(["sandbox", "production"]).default("sandbox"),
    adapter: z.literal("monnify").default("monnify"),
    baseUrl: z
      .enum(["https://sandbox.monnify.com", "https://api.monnify.com"])
      .optional(),
    apiKeyRef: secretRef.optional(),
    secretKeyRef: secretRef.optional(),
    contractCode: z.string().min(1).max(100).optional(),
    returnUrl: httpsUrl.optional(),
    webhookSecretRef: secretRef.optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      c.baseUrl &&
      c.baseUrl !==
        (c.environment === "sandbox"
          ? "https://sandbox.monnify.com"
          : "https://api.monnify.com")
    )
      ctx.addIssue({
        code: "custom",
        message: "Monnify origin/environment mismatch",
      });
  });
export type MonnifyConfig = z.infer<typeof monnifyConfigSchema>;
export type MonnifyDeps = NativeDeps & { clock?: () => Date };
export function monnifyExecutionAdapter(
  config: unknown,
  deps: MonnifyDeps,
): ExecutionAdapter {
  const c = parseConfig(monnifyConfigSchema, config),
    base =
      c.environment === "sandbox"
        ? "https://sandbox.monnify.com"
        : "https://api.monnify.com";
  async function call(method: "GET" | "POST", path: string, data?: object) {
    if (!c.apiKeyRef || !c.secretKeyRef)
      throw new PortalError("MONNIFY_CREDENTIALS_NOT_CONFIGURED", 409);
    let apiKey: string, key: string;
    try {
      apiKey = await secret(deps, c.apiKeyRef);
      key = await secret(deps, c.secretKeyRef);
    } catch {
      throw new PortalError("MONNIFY_CREDENTIALS_NOT_CONFIGURED", 409);
    }
    const login = await request(deps, base, {
      method: "POST",
      path: "/api/v1/auth/login",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${key}`).toString("base64")}`,
      },
      timeoutMs: c.timeoutMs,
    });
    if (login.requestSuccessful !== true)
      throw new PortalError("MONNIFY_AUTH_FAILED", 502);
    const res = await request(deps, base, {
      method,
      path,
      body: data === undefined ? undefined : JSON.stringify(data),
      headers: {
        Authorization: `Bearer ${textField(object(login.responseBody).accessToken, 8192)}`,
        "Content-Type": "application/json",
      },
      timeoutMs: c.timeoutMs,
    });
    if (res.requestSuccessful !== true)
      throw new PortalError("MONNIFY_API_ERROR", 502);
    return object(res.responseBody);
  }
  function validateReceipt(
    p: Record<string, unknown>,
    key: string,
    reference?: string | null,
  ) {
    const id = textField(p.transactionReference),
      currency = textField(p.currencyCode, 3);
    if (
      p.paymentReference !== key ||
      (reference && id !== reference) ||
      currency !== "NGN"
    )
      throw new PortalError("MONNIFY_RECEIPT_MISMATCH", 502);
    return { id, currency };
  }
  return {
    operations: ["create-payment", "payment-status", "verify-event"],
    async create(a, i) {
      checkEnvironment(c, a);
      assertHints(i, [], ["nip"]);
      const m = fiatMoney(i);
      if (
        !["card", "bank-transfer"].includes(i.selectedMethod ?? "") ||
        m.currency !== "NGN"
      )
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      if (!c.contractCode)
        throw new PortalError("MONNIFY_CONTRACT_CODE_NOT_CONFIGURED", 409);
      const fields = metadata(i),
        email = z.email().safeParse(fields.payer_email),
        name = z.string().min(1).max(100).safeParse(fields.payer_name);
      if (!email.success || !name.success)
        throw new PortalError("MONNIFY_CUSTOMER_REQUIRED", 409);
      if (!c.returnUrl)
        throw new PortalError("PROVIDER_RETURN_URL_REQUIRED", 409);
      const p = await call(
        "POST",
        "/api/v1/merchant/transactions/init-transaction",
        {
          amount: m.amount,
          customerName: name.data,
          customerEmail: email.data,
          paymentReference: a.key,
          paymentDescription: `Payment ${i.reference}`.slice(0, 100),
          currencyCode: "NGN",
          contractCode: c.contractCode,
          redirectUrl: c.returnUrl,
          paymentMethods: [
            i.selectedMethod === "card" ? "CARD" : "ACCOUNT_TRANSFER",
          ],
        },
      );
      // The documented initialization response has reference, methods and URL,
      // but no required amount/currency. It is instructions, never paid evidence.
      const v = { id: textField(p.transactionReference) };
      const method = i.selectedMethod === "card" ? "CARD" : "ACCOUNT_TRANSFER";
      if (
        p.paymentReference !== a.key ||
        !Array.isArray(p.enabledPaymentMethod) ||
        p.enabledPaymentMethod.length !== 1 ||
        p.enabledPaymentMethod[0] !== method ||
        (p.currencyCode !== undefined && p.currencyCode !== "NGN") ||
        (p.amount !== undefined &&
          toMinorUnits(amountField(p.amount), 2, "NGN") !== m.minor)
      )
        throw new PortalError("MONNIFY_RECEIPT_MISMATCH", 502);
      return {
        state: "Requires action",
        reference: v.id,
        action: redirect("Monnify", p.checkoutUrl, [
          c.environment === "sandbox"
            ? "sandbox.sdk.monnify.com"
            : "sdk.monnify.com",
        ]),
      };
    },
    async status(a) {
      const p = await call(
        "GET",
        `/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(a.key)}`,
      );
      const v = validateReceipt(p, a.key, a.providerReference);
      const state =
        (
          {
            PAID: "Confirmed",
            PENDING: "Pending",
            UNPAID: "Pending",
            PARTIALLY_PAID: "Pending",
            FAILED: "Rejected",
            CANCELLED: "Rejected",
            EXPIRED: "Rejected",
          } as Record<string, string>
        )[String(p.paymentStatus)] ?? "Unknown";
      return {
        state,
        reference: v.id,
        amount: amountField(
          p.paymentStatus === "PAID"
            ? p.amountPaid
            : (p.amount ?? p.totalPayable),
        ),
        asset: fiatAsset(v.currency),
      };
    },
    async verifyWebhook(input) {
      if (!c.webhookSecretRef) return false;
      return verifyMonnifyWebhook(
        await secret(deps, c.webhookSecretRef),
        input,
      );
    },
  };
}
// Legacy transaction-hash format only. It is not a substitute for authenticated
// query receipts and never directly changes a payment's state.
export function verifyMonnifyWebhook(
  secretKey: string,
  input: unknown,
): boolean {
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
  if (
    !eventData ||
    typeof transactionHash !== "string" ||
    !/^[0-9a-f]{128}$/.test(transactionHash)
  )
    return false;
  const expected = createHash("sha512")
    .update(
      `${secretKey}|${eventData.paymentReference ?? ""}|${eventData.amountPaid ?? ""}|${eventData.paidOn ?? ""}|${eventData.transactionReference ?? ""}`,
    )
    .digest();
  return timingSafeEqual(expected, Buffer.from(transactionHash, "hex"));
}
