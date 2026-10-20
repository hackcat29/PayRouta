import { cryptoCheckoutInput } from "../payments/crypto-contracts";
import {
  universalCheckoutInput,
  universalCheckoutResponse,
} from "../payments/universal-contracts";
import { z } from "zod";
import { supportedPaymentMethodIds } from "../providers/normalized";
import { assetSchema } from "../portal/domain";
import { intentInput } from "../payments/contracts";
export const environment = z.enum(["sandbox", "production"]);
export const permission = z.enum([
  "payments:read",
  "payments:write",
  "settlements:read",
  "webhooks:read",
  "webhooks:write",
  "configuration:read",
]);
export const keyInput = z
  .object({
    environment,
    permissions: z.array(permission).min(1).max(6),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();
export const sessionInput = z
  .object({ intentId: z.string().min(1).max(100) })
  .strict();
export const pageInput = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(400).optional(),
    state: z.string().max(40).optional(),
    reference: z.string().max(100).optional(),
    method: z.enum(["", ...supportedPaymentMethodIds]).optional(),
    from: z.union([z.literal(""), z.iso.date(), z.iso.datetime()]).optional(),
    to: z.union([z.literal(""), z.iso.date(), z.iso.datetime()]).optional(),
  })
  .strict();
export const publicIntent = z.object({
  id: z.string(),
  environment,
  reference: z.string(),
  amount: z.string(),
  asset: assetSchema,
  precision: z.number().int(),
  state: z.string(),
  selectedMethod: z.string().nullable(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  // "customer": amount includes fees passed to the customer; baseAmount is
  // what the merchant receives after fees, customerFee the difference.
  feeBearer: z.enum(["merchant", "customer"]).default("merchant"),
  baseAmount: z.string().nullable().default(null),
  customerFee: z.string().nullable().default(null),
});
// The pass-through figures of the selected payment option, for publicIntent.
export function feeFields(record: { amount?: string; precision?: number; paymentOptions?: unknown; selectedOption?: string | null }) {
  const options = Array.isArray(record.paymentOptions) ? record.paymentOptions : [];
  const selected = options.find((o: { id?: string }) => o?.id === record.selectedOption) as
    | { baseAmount?: string; customerFeeMinor?: string; precision?: number }
    | undefined;
  if (!selected?.baseAmount || selected.customerFeeMinor === undefined) return { baseAmount: null, customerFee: null };
  const precision = selected.precision ?? record.precision ?? 0;
  const text = selected.customerFeeMinor.padStart(precision + 1, "0");
  return {
    baseAmount: selected.baseAmount,
    customerFee: precision ? `${text.slice(0, -precision)}.${text.slice(-precision)}` : text,
  };
}
export const toPublicIntent = (record: Record<string, unknown>) =>
  publicIntent.parse({ ...record, ...feeFields(record as Parameters<typeof feeFields>[0]) });
export const operations = {
  "POST checkouts": "payments:write",
  "POST crypto-checkouts": "payments:write",
  "GET payment-intents": "payments:read",
  "POST payment-intents": "payments:write",
  "GET payments": "payments:read",
  "GET available-methods": "payments:read",
  "GET checkout-sessions": "payments:read",
  "POST checkout-sessions": "payments:write",
  "GET settlements": "settlements:read",
  "GET configuration": "configuration:read",
  "GET fee-settings": "configuration:read",
  "GET webhook-endpoint": "webhooks:read",
  "PUT webhook-endpoint": "webhooks:write",
  "DELETE webhook-endpoint": "webhooks:write",
  "GET webhook-deliveries": "webhooks:read",
  "POST webhook-deliveries": "webhooks:write",
} as const;
export const requestSchemas = {
  "POST checkouts": universalCheckoutInput,
  "POST crypto-checkouts": cryptoCheckoutInput,
  "POST payment-intents": intentInput,
  "POST checkout-sessions": sessionInput,
};
export const webhookInput = z
  .object({
    url: z.url().max(2048),
    secret: z.string().min(32).max(200),
    keyId: z.string().regex(/^[\w-]{1,40}$/),
  })
  .strict();
const wirePayment = publicIntent.extend({
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
const wireSettlement = z
  .object({
    id: z.string(),
    environment,
    asset: assetSchema,
    gross: z.string(),
    fee: z.string(),
    net: z.string(),
    amountUnit: z.literal("minor"),
    state: z.string(),
    reconciliation: z.string(),
    createdAt: z.iso.datetime(),
    allocations: z.array(
      z.object({ intentId: z.string(), amount: z.string(), fee: z.string() }),
    ),
  })
  .strict();
const wireDelivery = z
  .object({
    id: z.string(),
    intentId: z.string(),
    type: z.string(),
    version: z.number().int(),
    createdAt: z.iso.datetime(),
    delivery: z
      .object({
        eventId: z.string(),
        state: z.string(),
        attempts: z.number().int(),
        updatedAt: z.iso.datetime(),
      })
      .nullable(),
  })
  .strict();
const wirePage = (item: z.ZodType) =>
  z.object({ data: z.array(item), nextCursor: z.string().nullable() }).strict();
export function responseContract(
  operation: string,
  id?: string,
  action?: string,
): z.ZodType {
  const list = operation.startsWith("GET ") && !id;
  if (operation.endsWith("payment-intents") || operation.endsWith("payments"))
    return list ? wirePage(wirePayment) : wirePayment;
  if (operation === "GET settlements")
    return list ? wirePage(wireSettlement) : wireSettlement;
  if (operation === "GET webhook-deliveries")
    return list ? wirePage(wireDelivery) : wireDelivery;
  if (operation === "POST webhook-deliveries" && action === "redeliver")
    return z
      .object({ eventId: z.string(), state: z.literal("Pending") })
      .strict();
  if (operation === "GET available-methods")
    return z
      .object({
        evaluationId: z.string(),
        evaluatedAt: z.iso.datetime(),
        expiresAt: z.iso.datetime(),
        methods: z.array(
          z
            .object({
              method: z.string(),
              label: z.string(),
              status: z.enum([
                "COMING_SOON",
                "AVAILABLE",
                "ACTION_REQUIRED",
                "TEMPORARILY_UNAVAILABLE",
                "UNAVAILABLE",
                "UNKNOWN",
              ]),
              explanation: z.string(),
              action: z.string().optional(),
            })
            .strict(),
        ),
      })
      .strict();
  if (operation === "GET configuration")
    return z
      .object({
        environment,
        country: z.string(),
        returnOrigin: z.string(),
        applicationState: z.string(),
        executionPaused: z.boolean(),
        permittedMethods: z.array(z.string()),
        limits: z.array(
          z
            .object({
              asset: z.string(),
              maximumMinor: z.string(),
              dailyMaximumMinor: z.string(),
            })
            .strict(),
        ),
        liveScope: z
          .object({
            status: z.enum(["Proposed", "Approved", "Revoked"]),
            reviewCurrent: z.boolean(),
            merchantCountry: z.string(),
            payerCountries: z.array(z.string()),
            methods: z.array(z.string()),
            asset: z.string(),
            additionalAssets: z.array(
              z
                .object({
                  asset: z.string(),
                  maximumMinor: z.string(),
                  dailyMaximumMinor: z.string(),
                })
                .strict(),
            ),
            settlementAsset: z.string(),
            maximumMinor: z.string(),
            dailyMaximumMinor: z.string(),
            nextReviewAt: z.iso.datetime(),
          })
          .strict()
          .nullable(),
        comingSoonMethods: z.array(
          z
            .object({
              method: z.string(),
              label: z.string(),
              status: z.literal("COMING_SOON"),
              explanation: z.string(),
            })
            .strict(),
        ),
        stablecoinAssets: z.array(
          z
            .object({
              network: z.string(),
              identifier: z.string(),
              symbol: z.string(),
              decimals: z.number().int(),
              configured: z.boolean(),
              executionEnabled: z.boolean(),
              reason: z.string().nullable(),
            })
            .strict(),
        ),
        cryptoAssets: z.array(
          z
            .object({
              network: z.string(),
              identifier: z.string(),
              symbol: z.string(),
              decimals: z.number().int(),
              configured: z.boolean(),
              executionEnabled: z.boolean(),
              reason: z.string().nullable(),
            })
            .strict(),
        ),
        liveExecutionEnabled: z.boolean(),
      })
      .strict();
  if (operation === "GET fee-settings")
    return z.object({ feeBearer: z.enum(["merchant", "customer"]) }).strict();
  if (operation === "GET webhook-endpoint")
    return z
      .object({ webhookUrl: z.string().nullable(), webhookKeyId: z.string() })
      .strict();
  if (operation === "PUT webhook-endpoint")
    return z.object({ url: z.string(), keyId: z.string() }).strict();
  if (operation === "DELETE webhook-endpoint")
    return z.object({ disabled: z.literal(true) }).strict();
  if (operation === "GET checkout-sessions")
    return z
      .object({
        id: z.string(),
        intentId: z.string(),
        expiresAt: z.iso.datetime(),
        revokedAt: z.iso.datetime().nullable(),
      })
      .strict();
  if (operation === "POST checkouts") return universalCheckoutResponse;
  if (
    operation === "POST checkout-sessions" ||
    operation === "POST crypto-checkouts"
  )
    return z
      .object({
        id: z.string(),
        intentId: z.string(),
        expiresAt: z.iso.datetime(),
        checkoutPath: z.string(),
      })
      .strict();
  throw new Error("UNDECLARED_API_RESPONSE");
}
export function openapi() {
  const paymentResponse = publicIntent.extend({
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  });
  const paginationSchema = (item: z.ZodType) =>
    z.object({ data: z.array(item), nextCursor: z.string().nullable() });
  const routes: {
    method: string;
    path: string;
    operation: keyof typeof operations;
    body?: z.ZodType;
    response?: z.ZodType;
    list?: boolean;
    idempotency?: boolean;
    created?: boolean;
  }[] = [
    {
      method: "post",
      path: "/checkouts",
      operation: "POST checkouts",
      body: universalCheckoutInput,
      response: universalCheckoutResponse,
      idempotency: true,
      created: true,
    },
    {
      method: "post",
      path: "/crypto-checkouts",
      operation: "POST crypto-checkouts",
      body: cryptoCheckoutInput,
      idempotency: true,
      created: true,
    },
    {
      method: "get",
      path: "/payment-intents",
      operation: "GET payment-intents",
      list: true,
      response: paginationSchema(paymentResponse),
    },
    {
      method: "post",
      path: "/payment-intents",
      operation: "POST payment-intents",
      body: intentInput,
      response: paymentResponse,
      idempotency: true,
      created: true,
    },
    {
      method: "get",
      path: "/payment-intents/{id}",
      operation: "GET payment-intents",
      response: paymentResponse,
    },
    {
      method: "post",
      path: "/payment-intents/{id}/cancel",
      operation: "POST payment-intents",
      response: paymentResponse,
    },
    {
      method: "get",
      path: "/payments",
      operation: "GET payments",
      list: true,
      response: paginationSchema(paymentResponse),
    },
    {
      method: "get",
      path: "/payments/{id}",
      operation: "GET payments",
      response: paymentResponse,
    },
    {
      method: "get",
      path: "/available-methods/{id}",
      operation: "GET available-methods",
    },
    {
      method: "post",
      path: "/checkout-sessions",
      operation: "POST checkout-sessions",
      body: sessionInput,
      idempotency: true,
      created: true,
      response: z.object({
        id: z.string(),
        intentId: z.string(),
        expiresAt: z.iso.datetime(),
        checkoutPath: z.string(),
      }),
    },
    {
      method: "get",
      path: "/checkout-sessions/{id}",
      operation: "GET checkout-sessions",
      response: z.object({
        id: z.string(),
        intentId: z.string(),
        expiresAt: z.iso.datetime(),
        revokedAt: z.iso.datetime().nullable(),
      }),
    },
    {
      method: "get",
      path: "/settlements",
      operation: "GET settlements",
      list: true,
    },
    { method: "get", path: "/settlements/{id}", operation: "GET settlements" },
    { method: "get", path: "/configuration", operation: "GET configuration" },
    {
      method: "get",
      path: "/fee-settings",
      operation: "GET fee-settings",
    },
    {
      method: "get",
      path: "/webhook-endpoint",
      operation: "GET webhook-endpoint",
    },
    {
      method: "put",
      path: "/webhook-endpoint",
      operation: "PUT webhook-endpoint",
      body: webhookInput,
    },
    {
      method: "delete",
      path: "/webhook-endpoint",
      operation: "DELETE webhook-endpoint",
    },
    {
      method: "get",
      path: "/webhook-deliveries",
      operation: "GET webhook-deliveries",
      list: true,
    },
    {
      method: "get",
      path: "/webhook-deliveries/{id}",
      operation: "GET webhook-deliveries",
    },
    {
      method: "post",
      path: "/webhook-deliveries/{id}/redeliver",
      operation: "POST webhook-deliveries",
    },
  ];
  const paths: Record<string, Record<string, unknown>> = {};
  const content = (schema: z.ZodType) => ({
    "application/json": { schema: z.toJSONSchema(schema) },
  });
  for (const route of routes) {
    route.response = responseContract(
      route.operation,
      route.path.includes("{id}") ? "id" : undefined,
      route.path.endsWith("/redeliver") ? "redeliver" : undefined,
    );
    const parameters: unknown[] = [
      {
        in: "header",
        name: "PayRouta-Environment",
        required: true,
        schema: z.toJSONSchema(environment),
      },
    ];
    if (route.path.includes("{id}"))
      parameters.push({
        in: "path",
        name: "id",
        required: true,
        schema: { type: "string" },
      });
    if (route.idempotency)
      parameters.push({
        in: "header",
        name: "Idempotency-Key",
        required: true,
        schema: { type: "string", pattern: "^[\\w-]{8,100}$" },
      });
    if (route.list)
      for (const [name, schema] of Object.entries(pageInput.shape))
        parameters.push({
          in: "query",
          name,
          required: false,
          schema: z.toJSONSchema(schema),
        });
    paths[route.path] ||= {};
    paths[route.path][route.method] = {
      summary: route.operation,
      parameters,
      "x-required-permission": operations[route.operation],
      ...(route.body
        ? { requestBody: { required: true, content: content(route.body) } }
        : {}),
      responses: {
        [route.created ? "201" : "200"]: {
          description: "Successful response",
          ...(route.response ? { content: content(route.response) } : {}),
        },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 429, 503].map((status) => [
            status,
            {
              description:
                "Machine-readable error; request ID is also returned in X-Request-Id",
              content: content(
                z.object({
                  error: z.object({ code: z.string(), requestId: z.string() }),
                }),
              ),
            },
          ]),
        ),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "PayRouta merchant API", version: "0.1.0" },
    servers: [{ url: "/api/v1" }],
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    },
    paths,
  };
}
