import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { z } from "zod";
import { PortalError } from "../../../portal/domain";
import { tokenAsset } from "../../../blockchain/assets";
import type { ExecutionAdapter } from "../../normalized";
import {
  nativeFields,
  assertHints,
  secretRef,
  httpsUrl,
  parseConfig,
  secret,
  request,
  textField,
  object,
  amountField,
  checkEnvironment,
  redirect,
  uuidId,
  mappedState,
  type NativeDeps,
} from "./common";

export const coinbaseConfigSchema = z
  .object({
    ...nativeFields,
    adapter: z.literal("coinbase-business"),
    keyIdRef: secretRef,
    privateKeyRef: secretRef,
    returnUrl: httpsUrl,
    cancelUrl: httpsUrl,
  })
  .strict();
export function coinbaseJwt(
  keyId: string,
  pem: string,
  method: string,
  path: string,
  now: Date,
) {
  const key = createPrivateKey(pem);
  if (
    key.asymmetricKeyType !== "ec" ||
    key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
  )
    throw new PortalError("COINBASE_ECDSA_KEY_REQUIRED", 409);
  const epoch = Math.floor(now.getTime() / 1000);
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${enc({ alg: "ES256", typ: "JWT", kid: keyId, nonce: randomBytes(16).toString("hex") })}.${enc({ sub: keyId, iss: "cdp", nbf: epoch, exp: epoch + 120, uri: `${method} business.coinbase.com${path}` })}`;
  return `${input}.${sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
export function coinbaseExecutionAdapter(
  config: unknown,
  deps: NativeDeps,
): ExecutionAdapter {
  const c = parseConfig(coinbaseConfigSchema, config),
    root =
      c.environment === "sandbox"
        ? "/sandbox/api/v1/checkouts"
        : "/api/v1/checkouts";
  const call = async (
    method: "POST" | "GET",
    path: string,
    input?: unknown,
    key?: string,
  ) =>
    request(deps, "https://business.coinbase.com", {
      method,
      path,
      timeoutMs: c.timeoutMs,
      headers: {
        Authorization: `Bearer ${coinbaseJwt(await secret(deps, c.keyIdRef), await secret(deps, c.privateKeyRef), method, path, deps.now?.() ?? new Date())}`,
        ...(key ? { "X-Idempotency-Key": key } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
  return {
    operations: ["create-payment", "payment-status"],
    async create(attempt, intent) {
      checkEnvironment(c, attempt);
      assertHints(intent, ["coinbase", "coinbase-commerce"]);
      const a = object(intent.asset),
        token = tokenAsset(String(a.network), String(a.identifier));
      if (
        intent.selectedMethod !== "crypto-app" ||
        a.kind !== "blockchain" ||
        token?.symbol !== "USDC" ||
        token.network !== "eip155:8453" ||
        (intent.precision !== undefined && intent.precision !== 6) ||
        !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(intent.amount)
      )
        throw new PortalError("PROVIDER_METHOD_UNAVAILABLE", 409);
      const s = await call(
        "POST",
        root,
        {
          amount: intent.amount,
          currency: "USDC",
          description: `Payment ${intent.reference}`,
          metadata: { payrouta_attempt: attempt.key },
          successRedirectUrl: c.returnUrl,
          failRedirectUrl: c.cancelUrl,
        },
        uuidId(attempt.key),
      );
      return {
        state: "Requires action",
        reference: textField(s.id),
        action: redirect("Coinbase", s.url, [
          "payments.coinbase.com",
          "business.coinbase.com",
        ]),
      };
    },
    async status(attempt) {
      if (!attempt.providerReference) return null;
      const s = await call(
        "GET",
        `${root}/${encodeURIComponent(attempt.providerReference)}`,
      );
      const token = tokenAsset(
        "eip155:8453",
        `erc20:${String(s.tokenAddress).toLowerCase()}`,
      );
      if (
        s.id !== attempt.providerReference ||
        object(s.metadata).payrouta_attempt !== attempt.key ||
        s.currency !== "USDC" ||
        s.network !== "base" ||
        token?.symbol !== "USDC"
      )
        throw new PortalError("PROVIDER_RESPONSE_SCOPE_MISMATCH", 502);
      return {
        state: mappedState(s.status, {
          COMPLETED: "Confirmed",
          PROCESSING: "Pending",
          ACTIVE: "Pending",
          FAILED: "Rejected",
          EXPIRED: "Rejected",
          DEACTIVATED: "Rejected",
        }),
        reference: attempt.providerReference,
        amount: amountField(s.amount),
        asset: {
          kind: "blockchain",
          identifier: token.identifier,
          network: token.network,
        },
      };
    },
  };
}
