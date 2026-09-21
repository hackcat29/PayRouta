// Qualification transport only. Not registered with production execution until the
// durable orchestration, account scope, settlement reports, and quotes are qualified.
import https from "node:https";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { validateEndpoint } from "../../portal/ssrf";
import { minor } from "../contracts";
export type Provider = "paystack" | "flutterwave-v3";
export type HostedInput = {
  reference: string;
  amount: string;
  email: string;
  method: "bank-transfer" | "card";
  callbackUrl: string;
};
export type Transport = (
  url: string,
  secret: string,
  body?: unknown,
) => Promise<{ status: number; body: unknown }>;
export class ProviderBoundaryError extends Error {
  constructor(
    public code: string,
    public uncertain = false,
  ) {
    super(code);
    this.name = "ProviderBoundaryError";
  }
}
export const providerTransport: Transport = async (url, secret, body) => {
  const target = await validateEndpoint(url);
  return new Promise((resolve, reject) => {
    const request = https.request(
      target.url,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        servername: target.url.hostname,
        lookup: (_host, _options, cb) =>
          cb(null, target.address.address, target.address.family),
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 262144) {
            response.destroy();
            request.destroy(
              new ProviderBoundaryError(
                "RESPONSE_TOO_LARGE",
                body !== undefined,
              ),
            );
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          clearTimeout(deadline);
          try {
            // Node 24 supplies exact source text to revivers; never round provider money.
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"), ((
              _: string,
              value: unknown,
              context?: { source?: string },
            ) => {
              if (typeof value !== "number") return value;
              if (!context?.source)
                throw new ProviderBoundaryError("EXACT_JSON_UNAVAILABLE");
              return context.source;
            }) as (key: string, value: unknown) => unknown);
            resolve({ status: response.statusCode || 503, body: parsed });
          } catch {
            reject(
              new ProviderBoundaryError(
                "MALFORMED_RESPONSE",
                body !== undefined,
              ),
            );
          }
        });
      },
    );
    const deadline = setTimeout(
      () =>
        request.destroy(
          new ProviderBoundaryError("TIMEOUT", body !== undefined),
        ),
      8000,
    );
    request.on("error", (error) => {
      clearTimeout(deadline);
      reject(
        error instanceof ProviderBoundaryError
          ? error
          : new ProviderBoundaryError("NETWORK_FAILURE", body !== undefined),
      );
    });
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
};
const scalar = z
  .union([z.string(), z.number().int().safe().nonnegative()])
  .transform(String);
const hostedInput = z
  .object({
    reference: z.string().regex(/^[A-Za-z0-9.=-]{8,100}$/),
    amount: z.string().regex(/^[1-9]\d{0,12}(\.\d{1,2})?$/),
    email: z.email(),
    method: z.enum(["bank-transfer", "card"]),
    callbackUrl: z.url(),
  })
  .strict();
export class HostedQualificationAdapter {
  constructor(
    private provider: Provider,
    private config: {
      secret: string;
      accountId: string;
      channelRestrictionVerified: boolean;
    },
    private transport: Transport = providerTransport,
  ) {
    if (!config.accountId || !config.channelRestrictionVerified)
      throw new ProviderBoundaryError("ACCOUNT_QUALIFICATION_REQUIRED");
    // This implementation intentionally accepts only test credentials.
    if (
      provider === "paystack"
        ? !config.secret.startsWith("sk_test_")
        : !config.secret.startsWith("FLWSECK_TEST-")
    )
      throw new ProviderBoundaryError("SANDBOX_CREDENTIAL_REQUIRED");
  }
  async initialize(raw: HostedInput) {
    const input = hostedInput.parse(raw);
    const callback = new URL(input.callbackUrl);
    if (
      callback.username ||
      callback.password ||
      callback.protocol !== "https:"
    )
      throw new ProviderBoundaryError("INVALID_CALLBACK");
    const response =
      this.provider === "paystack"
        ? await this.transport(
            "https://api.paystack.co/transaction/initialize",
            this.config.secret,
            {
              reference: input.reference,
              amount: minor(input.amount, 2).toString(),
              currency: "NGN",
              email: input.email,
              channels: [input.method === "card" ? "card" : "bank_transfer"],
              callback_url: input.callbackUrl,
            },
          )
        : await this.transport(
            "https://api.flutterwave.com/v3/payments",
            this.config.secret,
            {
              tx_ref: input.reference,
              amount: input.amount,
              currency: "NGN",
              customer: { email: input.email },
              payment_options:
                input.method === "card" ? "card" : "banktransfer",
              redirect_url: input.callbackUrl,
            },
          );
    if (response.status < 200 || response.status >= 300)
      throw new ProviderBoundaryError("INITIALIZATION_UNRESOLVED", true);
    const envelope = z
      .object({
        status: z.union([z.boolean(), z.string()]),
        data: z.record(z.string(), z.unknown()),
      })
      .parse(response.body);
    if (envelope.status !== true && envelope.status !== "success")
      throw new ProviderBoundaryError("INITIALIZATION_UNRESOLVED", true);
    if (
      this.provider === "paystack" &&
      envelope.data.reference !== input.reference
    )
      throw new ProviderBoundaryError("REFERENCE_MISMATCH", true);
    const url = new URL(
      z
        .url()
        .parse(
          this.provider === "paystack"
            ? envelope.data.authorization_url
            : envelope.data.link,
        ),
    );
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname !==
        (this.provider === "paystack"
          ? "checkout.paystack.com"
          : "checkout.flutterwave.com")
    )
      throw new ProviderBoundaryError("UNTRUSTED_CUSTOMER_ACTION", true);
    return {
      state: "Requires action",
      reference: input.reference,
      action: { kind: "redirect", url: url.href, method: input.method },
    };
  }
  async status(raw: HostedInput) {
    const input = hostedInput.parse(raw);
    const url =
      this.provider === "paystack"
        ? `https://api.paystack.co/transaction/verify/${encodeURIComponent(input.reference)}`
        : `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(input.reference)}`;
    const response = await this.transport(url, this.config.secret);
    // Not found is not proof of non-execution; no blind create replay or fallback.
    if (response.status < 200 || response.status >= 300)
      return { state: "Unknown" as const, reference: input.reference };
    const envelope = z
      .object({
        status: z.union([z.boolean(), z.string()]),
        data: z.record(z.string(), z.unknown()),
      })
      .parse(response.body);
    if (envelope.status !== true && envelope.status !== "success")
      return { state: "Unknown" as const, reference: input.reference };
    const data = envelope.data;
    const reference = z
      .string()
      .parse(this.provider === "paystack" ? data.reference : data.tx_ref);
    if (reference !== input.reference || data.currency !== "NGN")
      throw new ProviderBoundaryError("PAYMENT_CONTEXT_MISMATCH");
    const amount = scalar.parse(data.amount);
    const expected = minor(input.amount, 2);
    if (
      this.provider === "paystack"
        ? !/^\d+$/.test(amount) || BigInt(amount) !== expected
        : minor(amount, 2) !== expected
    )
      throw new ProviderBoundaryError("AMOUNT_MISMATCH");
    const confirmed =
      data.status === (this.provider === "paystack" ? "success" : "successful");
    if (this.provider === "paystack" && data.domain !== "test")
      throw new ProviderBoundaryError("ENVIRONMENT_MISMATCH");
    if (
      this.provider === "flutterwave-v3" &&
      scalar.parse(data.account_id) !== this.config.accountId
    )
      throw new ProviderBoundaryError("ACCOUNT_MISMATCH");
    if (confirmed) {
      const method =
        this.provider === "paystack" ? data.channel : data.payment_type;
      const expectedMethod =
        input.method === "card"
          ? "card"
          : this.provider === "paystack"
            ? "bank_transfer"
            : "bank_transfer";
      if (method !== expectedMethod)
        throw new ProviderBoundaryError("METHOD_MISMATCH");
    }
    return {
      state: confirmed ? ("Confirmed" as const) : ("Unknown" as const),
      reference,
      amount: input.amount,
      asset: { kind: "fiat", identifier: "NGN", network: "" },
    };
  }
}
export function verifyPaystack(
  raw: Uint8Array,
  supplied: string,
  secret: string,
) {
  if (!/^[a-f0-9]{128}$/.test(supplied)) return false;
  const digest = createHmac("sha512", secret).update(raw).digest();
  return timingSafeEqual(digest, Buffer.from(supplied, "hex"));
}
// Flutterwave v3 documents a shared verif-hash, not a raw-body HMAC.
// Authenticate the notification then re-query status; never post its body as a fact.
export function verifyFlutterwaveV3(supplied: string, secret: string) {
  if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(secret))
    return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(secret));
}
