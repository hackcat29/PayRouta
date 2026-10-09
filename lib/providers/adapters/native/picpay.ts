import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ExecutionAdapter } from "../../normalized";
import {
  nativeFields,
  assertHints,
  secretRef,
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
  uuidId,
  mappedState,
  type NativeDeps,
} from "./common";

export const picpayConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("picpay"),
    clientIdRef: secretRef,
    clientSecretRef: secretRef,
  })
  .strict();
const customerSchema = z.object({
  payer_name: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[\p{L} &\d]+$/u),
  payer_email: z.email(),
  payer_document_type: z.enum(["CPF", "CNPJ", "PASSPORT"]),
  payer_document: z
    .string()
    .regex(/^\d{11}$|^[A-Za-z0-9]{14}$|^(?=.*[A-Z])[A-Z0-9]{6,10}$/),
  payer_phone_country: z.string().regex(/^\d{1,3}$/),
  payer_phone_area: z.string().regex(/^\d{1,3}$/),
  payer_phone_number: z.string().regex(/^\d{6,15}$/),
  payer_ip: z.union([z.ipv4(), z.ipv6()]),
});
export function picpayExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(picpayConfigSchema, config);
  const origin =
    c.environment === "sandbox"
      ? "https://ecommerce-api.svcp.ppay.me"
      : "https://ecommerce-api.svcp.picpay.com";
  async function call(method: "GET" | "POST", path: string, body?: unknown) {
    const token = await request(deps, origin, {
      method: "POST",
      path: "/oauth2/token",
      timeoutMs: c.timeoutMs,
      body: JSON.stringify({
        client_id: await secret(deps, c.clientIdRef),
        client_secret: await secret(deps, c.clientSecretRef),
        grant_type: "client_credentials",
      }),
    });
    return request(deps, origin, {
      method,
      path,
      timeoutMs: c.timeoutMs,
      headers: {
        Authorization: `Bearer ${textField(token.access_token, 10000)}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  function walletTransaction(p: Record<string, unknown>, key: string) {
    if (
      p.merchantChargeId !== uuidId(key) ||
      !Array.isArray(p.transactions) ||
      p.transactions.length !== 1
    )
      throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
    const tx = object(p.transactions[0]);
    if (tx.paymentType !== "WALLET")
      throw new PortalError("PROVIDER_METHOD_MISMATCH", 502);
    return tx;
  }
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      assertHints(intent, ["picpay"]);
      const money = fiatMoney(intent);
      if (
        money.currency !== "BRL" ||
        intent.selectedMethod !== "digital-wallet" ||
        money.value > 2147483647
      )
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const parsed = customerSchema.safeParse(metadata(intent));
      if (!parsed.success)
        throw new PortalError("PICPAY_CUSTOMER_DETAILS_REQUIRED", 409);
      const m = parsed.data;
      const p = await call("POST", "/charge/wallet", {
        merchantChargeId: uuidId(attempt.key),
        paymentSource: "GATEWAY",
        lateCapture: false,
        customer: {
          name: m.payer_name,
          email: m.payer_email,
          documentType: m.payer_document_type,
          document: m.payer_document,
          phone: {
            countryCode: m.payer_phone_country,
            areaCode: m.payer_phone_area,
            number: m.payer_phone_number,
            type: "MOBILE",
          },
        },
        deviceInformation: { ip: m.payer_ip },
        expiration: 900,
        transactions: [{ paymentType: "WALLET", amount: money.value }],
      });
      const tx = walletTransaction(p, attempt.key),
        w = object(tx.wallet);
      const image = textField(w.qrCodeBase64, 60000);
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image))
        throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
      return {
        state: "Requires action",
        reference: uuidId(attempt.key),
        action: {
          kind: "qr",
          provider: "PicPay",
          image,
          code: textField(w.qrCode, 4096),
          text: "Scan this code with PicPay to pay.",
        },
      };
    },
    async status(attempt) {
      const p = await call("GET", `/charge/${uuidId(attempt.key)}`),
        tx = walletTransaction(p, attempt.key);
      const state =
        p.chargeStatus === "PAID" &&
        tx.transactionStatus === "PAID" &&
        p.refundedAmount === 0
          ? "Confirmed"
          : mappedState(p.chargeStatus, {
              PRE_AUTHORIZED: "Pending",
              DENIED: "Rejected",
              CANCELED: "Rejected",
              PARTIAL: "Pending",
            });
      return {
        state,
        reference: uuidId(attempt.key),
        amount: minorAmount(p.amount, "BRL"),
        asset: fiatAsset("BRL"),
      };
    },
  };
}
