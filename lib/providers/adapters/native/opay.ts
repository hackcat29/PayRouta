import { createHmac } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ExecutionAdapter } from "../../normalized";
import {
  assertHints,
  checkEnvironment,
  fiatMoney,
  fiatAsset,
  minorAmount,
  nativeFields,
  object,
  parseConfig,
  request,
  secret,
  secretRef,
  stableId,
  textField,
  type NativeDeps,
} from "./common";
import { assertPaymentHost } from "../../../partners/contract";
export const opayConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("opay").default("opay"),
    merchantId: z.string().regex(/^\d{8,30}$/),
    secretKeyRef: secretRef,
  })
  .strict();
export function opayExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(opayConfigSchema, config),
    base =
      c.environment === "sandbox"
        ? "https://testapi.opaycheckout.com"
        : "https://liveapi.opaycheckout.com";
  const ref = (key: string) => `pr_${stableId(key, 48)}`;
  async function call(path: string, input: object) {
    const body = JSON.stringify(input),
      key = await secret(deps, c.secretKeyRef);
    const res = await request(deps, base, {
      method: "POST",
      path: `/api/v1/international/${path}`,
      body,
      headers: {
        "Content-Type": "application/json",
        MerchantId: c.merchantId,
        Authorization: `Bearer ${createHmac("sha512", key).update(body).digest("hex")}`,
      },
      timeoutMs: c.timeoutMs,
    });
    if (res.code === "02006" && path === "cashier/status") return null;
    if (res.code !== "00000")
      throw new PortalError("OPAY_API_UNAVAILABLE", 502);
    return object(res.data);
  }
  function receipt(
    p: Record<string, unknown>,
    key: string,
    providerRef?: string | null,
  ) {
    const a = object(p.amount),
      reference = textField(p.orderNo);
    if (
      p.reference !== ref(key) ||
      (providerRef && reference !== providerRef) ||
      a.currency !== "NGN" ||
      p.isVoided === true
    )
      throw new PortalError("OPAY_RECEIPT_MISMATCH", 502);
    return {
      reference,
      amount: minorAmount(a.total, "NGN"),
      asset: fiatAsset("NGN"),
    };
  }
  return {
    operations: ["create-payment", "payment-status"],
    async create(a, i) {
      checkEnvironment(c, a);
      assertHints(i, ["opay"]);
      const m = fiatMoney(i);
      if (i.selectedMethod !== "digital-wallet" || m.currency !== "NGN")
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const p = await call("payment/create", {
        amount: { currency: "NGN", total: m.value },
        country: "NG",
        payMethod: "OpayWalletNgQR",
        product: { name: `Payment ${i.reference}`.slice(0, 100) },
        reference: ref(a.key),
      });
      if (!p) throw new PortalError("PROVIDER_RESPONSE_INVALID", 502);
      const verified = receipt(p, a.key);
      if (verified.amount !== m.amount)
        throw new PortalError("OPAY_RECEIPT_MISMATCH", 502);
      const next = object(p.nextAction);
      if (next.actionType !== "SCAN_QR_CODE")
        throw new PortalError("PROVIDER_CUSTOMER_ACTION_REQUIRED", 502);
      const code = assertPaymentHost(
        ["qrm.operapay.com"],
        textField(next.qrCode, 2048),
      );
      const image = await QRCode.toDataURL(code, {
        type: "image/png",
        errorCorrectionLevel: "M",
        width: 240,
        margin: 2,
      });
      return {
        state: "Requires action",
        reference: verified.reference,
        action: {
          kind: "qr",
          provider: "OPay",
          text: "Scan this code in OPay to approve the wallet payment.",
          image,
          code,
        },
      };
    },
    async status(a) {
      const p = await call("cashier/status", {
        country: "NG",
        reference: ref(a.key),
      });
      if (!p) return null;
      const r = receipt(p, a.key, a.providerReference);
      const state =
        (
          {
            INITIAL: "Pending",
            PENDING: "Pending",
            SUCCESS: "Confirmed",
            FAIL: "Rejected",
            CLOSE: "Rejected",
          } as Record<string, string>
        )[String(p.status)] ?? "Unknown";
      return { ...r, state };
    },
  };
}
