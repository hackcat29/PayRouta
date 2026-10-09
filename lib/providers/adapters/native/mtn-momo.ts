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
  amountField,
  textField,
  metadata,
  checkEnvironment,
  uuidId,
  mappedState,
  type NativeDeps,
} from "./common";

export const mtnConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("mtn-momo"),
    apiUserRef: secretRef,
    apiKeyRef: secretRef,
    subscriptionKeyRef: secretRef,
    targetEnvironment: z.string().regex(/^[a-z][a-z0-9]{1,30}$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export function mtnExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(mtnConfigSchema, config);
  if ((c.targetEnvironment === "sandbox") !== (c.environment === "sandbox"))
    throw new PortalError("PROVIDER_ENVIRONMENT_MISMATCH", 409);
  const baseUrl =
    c.environment === "sandbox"
      ? "https://sandbox.momodeveloper.mtn.com"
      : "https://proxy.momoapi.mtn.com";
  const headers = async () => {
    const sub = await secret(deps, c.subscriptionKeyRef);
    const user = await secret(deps, c.apiUserRef),
      key = await secret(deps, c.apiKeyRef);
    const token = await request(deps, baseUrl, {
      method: "POST",
      path: "/collection/token/",
      timeoutMs: c.timeoutMs,
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}`,
        "Ocp-Apim-Subscription-Key": sub,
      },
    });
    return {
      Authorization: `Bearer ${textField(token.access_token, 4096)}`,
      "Ocp-Apim-Subscription-Key": sub,
      "X-Target-Environment": c.targetEnvironment,
    };
  };
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      assertHints(intent, ["mtn-momo"]);
      const money = fiatMoney(intent),
        phone = metadata(intent).payer_phone;
      if (
        intent.selectedMethod !== "mobile-money" ||
        money.currency !== c.currency
      )
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      if (typeof phone !== "string" || !/^\d{8,15}$/.test(phone))
        throw new PortalError("PAYER_PHONE_REQUIRED", 409);
      const ref = uuidId(attempt.key);
      // MTN's reference UUID names the obligation. Status lookup uses that
      // same UUID after a timeout; it never issues another wallet prompt.
      const res = await deps.http(baseUrl, {
        method: "POST",
        path: "/collection/v1_0/requesttopay",
        timeoutMs: c.timeoutMs,
        headers: { ...(await headers()), "X-Reference-Id": ref },
        body: JSON.stringify({
          amount: money.amount,
          currency: money.currency,
          externalId: attempt.key,
          payer: { partyIdType: "MSISDN", partyId: phone },
          payerMessage: `Payment ${intent.reference}`.slice(0, 100),
          payeeNote: intent.reference.slice(0, 100),
        }),
      });
      if (res.status !== 202)
        throw new PortalError("PROVIDER_API_UNAVAILABLE", 503);
      return { state: "Pending", reference: ref };
    },
    async status(attempt) {
      const ref = uuidId(attempt.key);
      const res = await deps.http(baseUrl, {
        method: "GET",
        path: `/collection/v1_0/requesttopay/${ref}`,
        timeoutMs: c.timeoutMs,
        headers: await headers(),
      });
      if (res.status === 404) return null;
      if (res.status !== 200)
        throw new PortalError("PROVIDER_API_UNAVAILABLE", 503);
      const s = JSON.parse(res.body) as Record<string, unknown>;
      if (s.externalId !== attempt.key || s.currency !== c.currency)
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      return {
        state: mappedState(s.status, {
          SUCCESSFUL: "Confirmed",
          FAILED: "Rejected",
          PENDING: "Pending",
        }),
        reference: ref,
        amount: amountField(s.amount),
        asset: fiatAsset(c.currency),
      };
    },
  };
}
