import { createHash, createHmac, randomBytes } from "node:crypto";
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
  object,
  checkEnvironment,
  redirect,
  stableId,
  mappedState,
  type NativeDeps,
} from "./common";

export const paypayConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("paypay"),
    apiKeyRef: secretRef,
    secretKeyRef: secretRef,
    merchantId: z.string().min(1).max(100),
    returnUrl: httpsUrl,
  })
  .strict();
export function paypayAuthorization(
  apiKey: string,
  key: string,
  path: string,
  method: string,
  body: string | undefined,
  epoch: string,
  nonce: string,
) {
  const contentType = body === undefined ? "empty" : "application/json";
  const digest =
    body === undefined
      ? "empty"
      : createHash("md5").update(contentType).update(body).digest("base64");
  const sig = createHmac("sha256", key)
    .update([path, method, nonce, epoch, contentType, digest].join("\n"))
    .digest("base64");
  return `hmac OPA-Auth:${apiKey}:${sig}:${nonce}:${epoch}:${digest}`;
}
export function paypayExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(paypayConfigSchema, config),
    baseUrl =
      c.environment === "sandbox"
        ? "https://apigw.sandbox.paypay.ne.jp"
        : "https://apigw.paypay.ne.jp";
  const call = async (
    method: "POST" | "GET",
    path: string,
    input?: unknown,
  ) => {
    const body = input === undefined ? undefined : JSON.stringify(input),
      epoch = String(Math.floor((deps.now?.() ?? new Date()).getTime() / 1000)),
      nonce = randomBytes(8).toString("hex");
    const result = await request(deps, baseUrl, {
      method,
      path,
      body,
      timeoutMs: c.timeoutMs,
      headers: {
        Authorization: paypayAuthorization(
          await secret(deps, c.apiKeyRef),
          await secret(deps, c.secretKeyRef),
          path,
          method,
          body,
          epoch,
          nonce,
        ),
        "X-ASSUME-MERCHANT": c.merchantId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
    });
    if (object(result.resultInfo).code !== "SUCCESS")
      throw new PortalError("PROVIDER_API_UNAVAILABLE", 503);
    return object(result.data);
  };
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      assertHints(intent, ["paypay"]);
      const money = fiatMoney(intent);
      if (
        intent.selectedMethod !== "digital-wallet" ||
        money.currency !== "JPY"
      )
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const ref = stableId(attempt.key),
        s = await call("POST", "/v2/codes", {
          merchantPaymentId: ref,
          amount: { amount: money.value, currency: "JPY" },
          codeType: "ORDER_QR",
          orderDescription: `Payment ${intent.reference}`,
          isAuthorization: false,
          redirectType: "WEB_LINK",
          redirectUrl: c.returnUrl,
        });
      return {
        state: "Requires action",
        reference: ref,
        action: redirect("PayPay", s.url, [
          "qr.paypay.ne.jp",
          "stg-qr.paypay.ne.jp",
          "sandbox-qr.paypay.ne.jp",
        ]),
      };
    },
    async status(attempt) {
      const ref = stableId(attempt.key),
        s = await call("GET", `/v2/codes/payments/${ref}`);
      if (s.merchantPaymentId !== ref)
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      const amount = object(s.amount);
      if (amount.currency !== "JPY")
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      return {
        state: mappedState(s.status, {
          COMPLETED: "Confirmed",
          CREATED: "Pending",
          AUTHORIZED: "Pending",
          FAILED: "Rejected",
          CANCELED: "Rejected",
          EXPIRED: "Rejected",
        }),
        reference: ref,
        amount: minorAmount(amount.amount, "JPY"),
        asset: fiatAsset("JPY"),
      };
    },
  };
}
