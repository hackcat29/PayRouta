import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ExecutionAdapter, PaymentMethodId } from "../../normalized";
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
  object,
  metadata,
  checkEnvironment,
  redirect,
  mappedState,
  type NativeDeps,
} from "./common";

export const adyenPaymentTypes = [
  "scheme",
  "applepay",
  "googlepay",
  "alipay",
  "wechatpayWeb",
  "gcash",
  "grabpay_SG",
  "grabpay_MY",
  "kakaopay",
  "cashapp",
  "paypal",
  "paypay",
  "paytm",
  "wero",
  "klarna",
  "affirm",
  "pix",
  "sepadirectdebit",
] as const;
export const adyenMethod: Record<
  (typeof adyenPaymentTypes)[number],
  PaymentMethodId
> = {
  scheme: "card",
  applepay: "digital-wallet",
  googlepay: "digital-wallet",
  alipay: "digital-wallet",
  wechatpayWeb: "digital-wallet",
  gcash: "digital-wallet",
  grabpay_SG: "digital-wallet",
  grabpay_MY: "digital-wallet",
  kakaopay: "digital-wallet",
  cashapp: "digital-wallet",
  paypal: "digital-wallet",
  paypay: "digital-wallet",
  paytm: "digital-wallet",
  wero: "digital-wallet",
  klarna: "bnpl",
  affirm: "bnpl",
  pix: "bank-transfer",
  sepadirectdebit: "direct-debit",
};
const walletHints: Record<string, readonly string[]> = {
  "apple-pay": ["applepay"],
  "google-pay": ["googlepay"],
  alipay: ["alipay"],
  "wechat-pay": ["wechatpayWeb"],
  gcash: ["gcash"],
  grabpay: ["grabpay_SG", "grabpay_MY"],
  kakaopay: ["kakaopay"],
  "cash-app": ["cashapp"],
  paypal: ["paypal"],
  paypay: ["paypay"],
  paytm: ["paytm"],
  wero: ["wero"],
  klarna: ["klarna"],
  affirm: ["affirm"],
  pix: ["pix"],
  sepa: ["sepadirectdebit"],
};
export const adyenConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("adyen"),
    apiKeyRef: secretRef,
    webhookSecretRef: secretRef.optional(),
    merchantAccount: z.string().min(1).max(80),
    baseUrl: httpsUrl.refine((raw) => {
      const u = new URL(raw);
      return (
        u.origin === "https://checkout-test.adyen.com" ||
        /^https:\/\/[a-z0-9-]+-checkout-live\.adyenpayments\.com$/.test(
          u.origin,
        )
      );
    }),
    returnUrl: httpsUrl,
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    enabledPaymentTypes: z.array(z.enum(adyenPaymentTypes)).min(1),
  })
  .strict();
export function adyenExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(adyenConfigSchema, config);
  if (
    (new URL(c.baseUrl).hostname === "checkout-test.adyen.com") !==
    (c.environment === "sandbox")
  )
    throw new PortalError("PROVIDER_ENVIRONMENT_MISMATCH", 409);
  const call = async (
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    key?: string,
  ) =>
    request(deps, c.baseUrl, {
      method,
      path: `/v71${path}`,
      timeoutMs: c.timeoutMs,
      headers: {
        "X-API-Key": await secret(deps, c.apiKeyRef),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      const money = fiatMoney(intent),
        m = metadata(intent);
      let types = c.enabledPaymentTypes.filter(
        (t) => adyenMethod[t] === intent.selectedMethod,
      );
      const hint = m.preferred_wallet ?? m.payment_rail;
      if (hint !== undefined)
        types = types.filter(
          (t) => typeof hint === "string" && walletHints[hint]?.includes(t),
        );
      if (!types.length)
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      let lineItems;
      if (types.some((t) => adyenMethod[t] === "bnpl")) {
        const lines = z
          .array(
            z
              .object({
                id: z.string().min(1).max(80),
                description: z.string().min(1).max(100),
                quantity: z.number().int().positive().max(1000),
                amountIncludingTax: z
                  .number()
                  .int()
                  .positive()
                  .max(Number.MAX_SAFE_INTEGER),
              })
              .strict(),
          )
          .min(1)
          .max(8);
        try {
          lineItems = lines.parse(JSON.parse(String(m.order_lines ?? "")));
        } catch {
          throw new PortalError("PROVIDER_ORDER_LINES_REQUIRED", 409);
        }
        if (
          lineItems.reduce(
            (n, l) => n + BigInt(l.amountIncludingTax) * BigInt(l.quantity),
            0n,
          ) !== money.minor
        )
          throw new PortalError("PROVIDER_ORDER_LINES_AMOUNT_MISMATCH", 409);
      }
      const s = await call(
        "POST",
        "/paymentLinks",
        {
          reference: attempt.key,
          merchantAccount: c.merchantAccount,
          amount: { value: money.value, currency: money.currency },
          countryCode: c.countryCode,
          returnUrl: c.returnUrl,
          allowedPaymentMethods: types,
          reusable: false,
          ...(lineItems ? { lineItems } : {}),
          description: `Payment ${intent.reference}`,
        },
        attempt.key,
      );
      return {
        state: "Requires action",
        reference: textField(s.id),
        action: redirect("Adyen", s.url, [
          "test.adyen.link",
          "eu.adyen.link",
          "us.adyen.link",
          "au.adyen.link",
        ]),
      };
    },
    async status(attempt) {
      if (!attempt.providerReference) return null;
      const s = await call(
        "GET",
        `/paymentLinks/${encodeURIComponent(attempt.providerReference)}`,
      );
      if (
        s.id !== attempt.providerReference ||
        s.reference !== attempt.key ||
        s.merchantAccount !== c.merchantAccount
      )
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      const amount = object(s.amount),
        currency = textField(amount.currency, 3);
      // A completed link proves authorization, not capture or settlement. A
      // verified CAPTURE event is required before recognizing payer value.
      return {
        state: mappedState(s.status, {
          active: "Pending",
          paymentPending: "Pending",
          completed: "Pending",
          expired: "Pending",
        }),
        reference: attempt.providerReference,
        amount: minorAmount(amount.value, currency),
        asset: fiatAsset(currency),
      };
    },
  };
}

// Adyen Standard webhook signing uses the field canonicalization defined in
// their webhook contract, NOT an HMAC over the raw JSON. Every item is checked.
export function verifyAdyenItem(
  item: Record<string, unknown>,
  key: string,
): boolean {
  try {
    if (!/^[a-f\d]{64}$/i.test(key)) return false;
    const amount = object(item.amount),
      data = object(item.additionalData);
    const fields = [
      item.pspReference,
      item.originalReference ?? "",
      item.merchantAccountCode,
      item.merchantReference,
      amount.value,
      amount.currency,
      item.eventCode,
      item.success,
    ];
    if (
      fields.some(
        (v) =>
          typeof v !== "string" &&
          !(typeof v === "number" && Number.isSafeInteger(v)),
      )
    )
      return false;
    const payload = fields
      .map((v) => String(v).replace(/\\/g, "\\\\").replace(/:/g, "\\:"))
      .join(":");
    const expected = createHmac("sha256", Buffer.from(key, "hex"))
      .update(payload)
      .digest();
    const supplied = Buffer.from(textField(data.hmacSignature), "base64");
    return (
      supplied.length === expected.length && timingSafeEqual(expected, supplied)
    );
  } catch {
    return false;
  }
}
