import { z } from "zod";
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
  })
  .strict();
export const publicIntent = z.object({
  id: z.string(),
  environment,
  reference: z.string(),
  amount: z.string(),
  asset: z.unknown(),
  precision: z.number().int(),
  state: z.string(),
  selectedMethod: z.string().nullable(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
});
export const operations = {
  "GET payment-intents": "payments:read",
  "POST payment-intents": "payments:write",
  "GET payments": "payments:read",
  "GET available-methods": "payments:read",
  "GET checkout-sessions": "payments:read",
  "POST checkout-sessions": "payments:write",
  "GET settlements": "settlements:read",
  "GET configuration": "configuration:read",
  "GET webhook-endpoint": "webhooks:read",
  "PUT webhook-endpoint": "webhooks:write",
  "DELETE webhook-endpoint": "webhooks:write",
  "GET webhook-deliveries": "webhooks:read",
  "POST webhook-deliveries": "webhooks:write",
} as const;
export const requestSchemas = {
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
