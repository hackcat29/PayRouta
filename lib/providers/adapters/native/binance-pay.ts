import { createHmac, randomBytes } from "node:crypto";
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
  object,
  amountField,
  checkEnvironment,
  redirect,
  stableId,
  mappedState,
  type NativeDeps,
} from "./common";

export const binanceConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("binance-pay"),
    certificateRef: secretRef,
    secretKeyRef: secretRef,
    currency: z.enum(["USDC", "USDT", "BTC", "BNB"]),
    returnUrl: httpsUrl,
    cancelUrl: httpsUrl,
    goodsType: z.enum(["01", "02"]),
    goodsCategory: z.string().regex(/^[0-9A-Z]{4}$/),
  })
  .strict();
export function binanceSignature(
  key: string,
  timestamp: string,
  nonce: string,
  body: string,
) {
  return createHmac("sha512", key)
    .update(`${timestamp}\n${nonce}\n${body}\n`)
    .digest("hex")
    .toUpperCase();
}
export function binanceExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(binanceConfigSchema, config);
  const call = async (path: string, input: unknown) => {
    // Binance publishes no public acquiring sandbox endpoint. Mock transports
    // exercise this contract; an actual sandbox configuration cannot hit live.
    if (c.environment !== "production")
      throw new PortalError("PROVIDER_SANDBOX_UNAVAILABLE", 409);
    const body = JSON.stringify(input),
      timestamp = String((deps.now?.() ?? new Date()).getTime()),
      nonce = randomBytes(16).toString("hex");
    const s = await request(deps, "https://bpay.binanceapi.com", {
      method: "POST",
      path,
      body,
      timeoutMs: c.timeoutMs,
      headers: {
        "BinancePay-Timestamp": timestamp,
        "BinancePay-Nonce": nonce,
        "BinancePay-Certificate-SN": await secret(deps, c.certificateRef),
        "BinancePay-Signature": binanceSignature(
          await secret(deps, c.secretKeyRef),
          timestamp,
          nonce,
          body,
        ),
      },
    });
    if (s.status !== "SUCCESS" || s.code !== "000000")
      throw new PortalError("PROVIDER_API_UNAVAILABLE", 503);
    return object(s.data);
  };
  const asset = {
    kind: "blockchain",
    identifier: `binance:${c.currency}`,
    network: "binance:pay",
  };
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      assertHints(intent, ["binance-pay"]);
      const a = object(intent.asset);
      if (
        intent.selectedMethod !== "crypto-app" ||
        a.kind !== asset.kind ||
        a.identifier !== asset.identifier ||
        a.network !== asset.network ||
        !/^(0|[1-9]\d*)(\.\d{1,8})?$/.test(intent.amount)
      )
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const tradeNo = stableId(attempt.key),
        description = `Payment ${stableId(intent.reference, 16)}`;
      const s = await call("/binancepay/openapi/v3/order", {
        env: { terminalType: "WEB" },
        merchantTradeNo: tradeNo,
        orderAmount: intent.amount,
        currency: c.currency,
        supportPayCurrency: c.currency,
        description,
        goodsDetails: [
          {
            goodsType: c.goodsType,
            goodsCategory: c.goodsCategory,
            referenceGoodsId: tradeNo,
            goodsName: description,
          },
        ],
        returnUrl: c.returnUrl,
        cancelUrl: c.cancelUrl,
      });
      return {
        state: "Requires action",
        reference: tradeNo,
        action: redirect("Binance Pay", s.checkoutUrl, ["pay.binance.com"]),
      };
    },
    async status(attempt) {
      const tradeNo = stableId(attempt.key),
        s = await call("/binancepay/openapi/order/query", {
          merchantTradeNo: tradeNo,
        });
      if (s.merchantTradeNo !== tradeNo || s.currency !== c.currency)
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      return {
        state: mappedState(s.status, {
          PAID: "Confirmed",
          INITIAL: "Pending",
          PENDING: "Pending",
          PAYING: "Pending",
          CANCELED: "Rejected",
          EXPIRED: "Rejected",
          ERROR: "Unknown",
        }),
        reference: tradeNo,
        amount: amountField(s.totalFee),
        asset,
      };
    },
  };
}
