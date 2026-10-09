import { createHmac, timingSafeEqual } from "node:crypto";
export type Environment = "sandbox" | "production";
export type Page<T> = { data: T[]; nextCursor: string | null };
export type Asset = {
  kind: "fiat" | "blockchain";
  identifier: string;
  network: string;
};
export type IntentInput = {
  reference: string;
  payerCountry?: string;
  amount: string;
  asset: Asset;
  precision: number;
  methods: (
    | "bank-transfer"
    | "card"
    | "mobile-money"
    | "digital-wallet"
    | "ussd"
    | "direct-debit"
    | "bnpl"
    | "stablecoin"
    | "crypto-app"
  )[];
  settlement: Asset;
  paymentOptions?: {
    asset: Asset;
    amount: string;
    precision: number;
    settlement: Asset;
  }[];
  returnUrl: string;
  metadata?: Record<string, string>;
  scenario?:
    | "success"
    | "timeout"
    | "action"
    | "rejected"
    | "fallback"
    | "settlement-pending"
    | "fee-mismatch"
    | "late";
};
export type Payment = {
  id: string;
  environment: Environment;
  reference: string;
  amount: string;
  asset: Asset;
  precision: number;
  state: string;
  selectedMethod: string | null;
  createdAt: string;
  expiresAt: string;
};
export type CryptoCheckoutInput = {
  reference: string;
  payerCountry: string;
  usdAmount: string;
  options: { network: string; identifier: string }[];
};
export type CheckoutSession = {
  id: string;
  intentId: string;
  expiresAt: string;
  checkoutPath: string;
};
export class PayRoutaError extends Error {
  constructor(
    public code: string,
    public status: number | null,
    public requestId: string | null,
    public uncertain = false,
  ) {
    super(code);
    this.name = "PayRoutaError";
  }
}
export class PayRouta {
  private base: URL;
  constructor(
    private options: {
      baseUrl: string;
      secretKey: string;
      environment: Environment;
      timeoutMs?: number;
      transport?: typeof fetch;
      sleep?: (ms: number) => Promise<void>;
    },
  ) {
    this.base = new URL(
      options.baseUrl.endsWith("/") ? options.baseUrl : options.baseUrl + "/",
    );
    if (
      this.base.username ||
      this.base.password ||
      this.base.search ||
      this.base.hash ||
      !(
        this.base.protocol === "https:" ||
        (this.base.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(this.base.hostname))
      )
    )
      throw new Error("Use HTTPS or local loopback");
    if (!options.secretKey.startsWith(`pr_${options.environment}_`))
      throw new Error("Key environment mismatch");
    if ((options.timeoutMs ?? 10000) <= 0)
      throw new Error("Timeout must be positive");
  }
  createCryptoCheckout(input: CryptoCheckoutInput, idempotencyKey: string) {
    return this.request<CheckoutSession>(
      "POST",
      "crypto-checkouts",
      input,
      idempotencyKey,
    );
  }
  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    if (/^(?:[a-z]+:|\/)/i.test(path) || path.includes(".."))
      throw new Error("Relative API resource required");
    const url = new URL(path, this.base);
    if (
      url.origin !== this.base.origin ||
      !url.pathname.startsWith(this.base.pathname)
    )
      throw new Error("API path escaped base URL");
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await (this.options.transport || fetch)(url, {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 10000),
          headers: {
            Authorization: `Bearer ${this.options.secretKey}`,
            "PayRouta-Environment": this.options.environment,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        throw new PayRoutaError(
          "TRANSPORT_ERROR",
          null,
          null,
          method !== "GET",
        );
      }
      if (
        method === "GET" &&
        [429, 502, 503, 504].includes(response.status) &&
        attempt < 2
      ) {
        const hint = response.headers.get("retry-after");
        const seconds =
          hint && /^\d+$/.test(hint)
            ? Number(hint)
            : hint
              ? Math.max(0, (Date.parse(hint) - Date.now()) / 1000)
              : 2 ** attempt;
        if (!Number.isFinite(seconds) || seconds > 60)
          throw new PayRoutaError(
            "RETRY_LATER",
            response.status,
            response.headers.get("x-request-id"),
          );
        await response.body?.cancel();
        await (
          this.options.sleep ||
          ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
        )(seconds * 1000);
        continue;
      }
      let data;
      try {
        data = await response.json();
      } catch {
        throw new PayRoutaError(
          "INVALID_RESPONSE",
          response.status,
          response.headers.get("x-request-id"),
          method !== "GET",
        );
      }
      if (!response.ok)
        throw new PayRoutaError(
          data?.error?.code || "API_ERROR",
          response.status,
          response.headers.get("x-request-id"),
          method !== "GET" && response.status >= 500,
        );
      return data as T;
    }
  }
  createIntent(input: IntentInput, key: string) {
    return this.request<Payment>("POST", "payment-intents", input, key);
  }
  getPayment(id: string) {
    return this.request<Payment>("GET", `payments/${encodeURIComponent(id)}`);
  }
  createCheckoutSession(intentId: string, key: string) {
    return this.request<CheckoutSession>(
      "POST",
      "checkout-sessions",
      { intentId },
      key,
    );
  }
  async *paginate<T>(
    resource: string,
    filters: Record<string, string> = {},
  ): AsyncGenerator<T> {
    let cursor: string | null = null;
    do {
      const query = new URLSearchParams({
        ...filters,
        ...(cursor ? { cursor } : {}),
      });
      const result: Page<T> = await this.request("GET", `${resource}?${query}`);
      for (const row of result.data) yield row;
      if (result.nextCursor && result.nextCursor === cursor)
        throw new Error("Repeated pagination cursor");
      cursor = result.nextCursor;
    } while (cursor);
  }
}
export function verifyWebhook(
  rawBody: Uint8Array,
  headers: Record<string, string | undefined>,
  secrets: Record<string, string>,
  nowSeconds = Date.now() / 1000,
  tolerance = 300,
) {
  const timestamp = headers["payrouta-timestamp"] || "";
  const id = headers["payrouta-event-id"] || "";
  const key = headers["payrouta-key-id"] || "";
  const supplied = headers["payrouta-signature"] || "";
  if (
    !secrets[key] ||
    !id ||
    !/^\d+$/.test(timestamp) ||
    !Number.isFinite(nowSeconds) ||
    tolerance < 0 ||
    !Number.isFinite(tolerance) ||
    Math.abs(Number(timestamp) - nowSeconds) > tolerance ||
    !/^[a-f0-9]{64}$/.test(supplied)
  )
    return false;
  const expected = createHmac("sha256", secrets[key])
    .update(`${timestamp}.${id}.`)
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(supplied, "hex"));
}
