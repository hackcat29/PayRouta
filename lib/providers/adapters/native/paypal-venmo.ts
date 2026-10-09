import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import type { ExecutionAdapter } from "../../normalized";
import {
  assertHints,
  checkEnvironment,
  fiatMoney,
  fiatAsset,
  nativeFields,
  object,
  parseConfig,
  request,
  secret,
  secretRef,
  stableId,
  textField,
  amountField,
  type NativeDeps,
} from "./common";
import { toMinorUnits } from "../../../partners/money";
export const venmoConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("paypal-venmo").default("paypal-venmo"),
    clientIdRef: secretRef,
    clientSecretRef: secretRef,
    merchantId: z.string().regex(/^[A-Z0-9]{8,20}$/),
    merchantCountry: z.literal("US"),
    venmoApproved: z.literal(true),
  })
  .strict();
export function venmoExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(venmoConfigSchema, config),
    base =
      c.environment === "sandbox"
        ? "https://api-m.sandbox.paypal.com"
        : "https://api-m.paypal.com";
  const custom = (key: string) => `pr_${stableId(key, 48)}`;
  async function call(
    method: "GET" | "POST",
    path: string,
    data?: object,
    id?: string,
  ) {
    const clientId = await secret(deps, c.clientIdRef),
      key = await secret(deps, c.clientSecretRef);
    const auth = await request(deps, base, {
      method: "POST",
      path: "/v1/oauth2/token",
      body: "grant_type=client_credentials",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${key}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeoutMs: c.timeoutMs,
    });
    const p = await request(deps, base, {
      method,
      path,
      body: data === undefined ? undefined : JSON.stringify(data),
      headers: {
        Authorization: `Bearer ${textField(auth.access_token, 8192)}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(id ? { "PayPal-Request-Id": id } : {}),
      },
      timeoutMs: c.timeoutMs,
    });
    return p;
  }
  function verify(
    p: Record<string, unknown>,
    key: string,
    reference?: string | null,
  ) {
    const id = textField(p.id);
    if (
      !/^[A-Z0-9]{10,40}$/.test(id) ||
      (reference && id !== reference) ||
      !Array.isArray(p.purchase_units) ||
      p.purchase_units.length !== 1
    )
      throw new PortalError("VENMO_RECEIPT_MISMATCH", 502);
    const u = object(p.purchase_units[0]),
      m = object(u.amount),
      payee = object(u.payee);
    const value = amountField(m.value);
    if (
      u.custom_id !== custom(key) ||
      m.currency_code !== "USD" ||
      payee.merchant_id !== c.merchantId ||
      toMinorUnits(value, 2, "USD") === null
    )
      throw new PortalError("VENMO_RECEIPT_MISMATCH", 502);
    return { id, u, amount: value };
  }
  return {
    operations: ["create-payment", "payment-status"],
    async create(a, i) {
      checkEnvironment(c, a);
      assertHints(i, ["venmo"]);
      const m = fiatMoney(i);
      if (i.selectedMethod !== "digital-wallet" || m.currency !== "USD")
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const p = await call(
        "POST",
        "/v2/checkout/orders",
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              reference_id: "default",
              custom_id: custom(a.key),
              payee: { merchant_id: c.merchantId },
              amount: { currency_code: "USD", value: m.amount },
            },
          ],
          payment_source: {
            venmo: {
              experience_context: { shipping_preference: "NO_SHIPPING" },
            },
          },
        },
        custom(a.key),
      );
      const verified = verify(p, a.key);
      if (toMinorUnits(verified.amount, 2, "USD") !== m.minor)
        throw new PortalError("VENMO_RECEIPT_MISMATCH", 502);
      const clientId = await secret(deps, c.clientIdRef);
      if (!/^[A-Za-z0-9_-]{10,200}$/.test(clientId))
        throw new PortalError("VENMO_CLIENT_ID_INVALID", 409);
      return {
        state: "Requires action",
        reference: verified.id,
        action: {
          kind: "paypal-venmo",
          provider: "Venmo",
          text: "Approve this payment in Venmo. Availability depends on your device and location.",
          orderId: verified.id,
          clientId,
          merchantId: c.merchantId,
          environment: c.environment,
        },
      };
    },
    async status(a, i) {
      if (!a.providerReference) return null;
      if (!/^[A-Z0-9]{10,40}$/.test(a.providerReference))
        throw new PortalError("VENMO_RECEIPT_MISMATCH", 502);
      let p = await call("GET", `/v2/checkout/orders/${a.providerReference}`);
      let v = verify(p, a.key, a.providerReference);
      if (
        ["APPROVED", "COMPLETED"].includes(String(p.status)) &&
        !object(p.payment_source).venmo
      )
        throw new PortalError("VENMO_FUNDING_MISMATCH", 502);
      if (p.status === "APPROVED") {
        // Capture is a financial mutation. Check the immutable invoice before it.
        if (!i) throw new PortalError("VENMO_INVOICE_REQUIRED", 409);
        const expected = fiatMoney(i);
        assertHints(i, ["venmo"]);
        if (
          i.selectedMethod !== "digital-wallet" ||
          expected.currency !== "USD" ||
          toMinorUnits(v.amount, 2, "USD") !== expected.minor
        )
          throw new PortalError("VENMO_RECEIPT_MISMATCH", 502);
        p = await call(
          "POST",
          `/v2/checkout/orders/${v.id}/capture`,
          {},
          `capture-${v.id}`,
        );
        v = verify(p, a.key, a.providerReference);
      }
      let state = p.status === "VOIDED" ? "Rejected" : "Pending";
      let paid = v.amount;
      if (p.status === "COMPLETED") {
        const payments = object(v.u.payments),
          caps = payments.captures;
        if (!Array.isArray(caps) || caps.length !== 1)
          throw new PortalError("VENMO_CAPTURE_MISMATCH", 502);
        const cap = object(caps[0]),
          m = object(cap.amount);
        paid = amountField(m.value);
        if (
          m.currency_code !== "USD" ||
          cap.final_capture !== true ||
          toMinorUnits(paid, 2, "USD") !== toMinorUnits(v.amount, 2, "USD")
        )
          throw new PortalError("VENMO_CAPTURE_MISMATCH", 502);
        state =
          cap.status === "COMPLETED"
            ? "Confirmed"
            : ["DECLINED", "FAILED"].includes(String(cap.status))
              ? "Rejected"
              : "Pending";
      }
      return { state, reference: v.id, amount: paid, asset: fiatAsset("USD") };
    },
  };
}
