import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  paymentMethodIds,
  paymentMethodLabels,
  paymentMethodFamilies,
  integrationModes,
  executionModes,
  isPaymentMethod,
  labelOf,
} from "../lib/providers/normalized";
import {
  capabilityLifecycleStates,
  canTransition,
  providerLabel,
  routable,
} from "../lib/providers/capability-lifecycle";
import {
  mapProviderStatus,
  providerErrorCodes,
} from "../lib/providers/standard/contract";
import {
  standardConfigSchema,
  standardExecutionAdapter,
  verifyStandardWebhook,
} from "../lib/providers/standard/adapter";
import {
  configurableConfigSchema,
  configurableExecutionAdapter,
} from "../lib/providers/adapters/configurable";
import {
  evaluateCompliance,
  defaultComplianceRules,
  mostSevere,
} from "../lib/compliance/eligibility";
import {
  buildCertificationPlan,
  humanizeFailure,
  certificationScenarios,
} from "../lib/providers/certification/suite";
import {
  resolveProviderAdapter,
  observeProvider,
} from "../lib/portal/provider-adapters";

test("normalized taxonomy separates method, rail, and mode", () => {
  assert.deepEqual([...paymentMethodIds].sort(), [
    "bank-transfer",
    "bnpl",
    "card",
    "cash-voucher",
    "crypto-app",
    "digital-wallet",
    "direct-debit",
    "mobile-money",
    "stablecoin",
    "ussd",
  ]);
  assert.equal(paymentMethodLabels["bank-transfer"], "Bank transfer");
  assert.equal(paymentMethodFamilies.card, "card");
  assert.equal(paymentMethodFamilies.stablecoin, "stablecoin");
  assert.deepEqual(integrationModes, ["NATIVE", "STANDARD", "CONFIGURABLE"]);
  assert.deepEqual(executionModes, ["DIRECT", "PROVIDER", "HYBRID"]);
  assert.equal(isPaymentMethod("card"), true);
  assert.equal(isPaymentMethod("not-a-method"), false);
  assert.equal(labelOf("stablecoin"), "Stablecoin");
  assert.equal(labelOf("unknown"), "unknown");
});

test("capability lifecycle gates transitions and routability", () => {
  assert.ok(capabilityLifecycleStates.includes("ACTIVE"));
  assert.equal(canTransition("DRAFT", "DECLARED"), true);
  assert.equal(canTransition("ACTIVE", "DECLARED"), false);
  assert.equal(canTransition("SUSPENDED", "ACTIVE"), true);
  assert.equal(canTransition("SUSPENDED", "REVOKED"), true);
  assert.equal(providerLabel("CERTIFIED"), "Ready for review");
  assert.equal(providerLabel("ACTIVE"), "Live");
  assert.equal(providerLabel("CERTIFICATION_FAILED"), "Testing");
  const allMet = routable({
    capabilityState: "ACTIVE",
    organizationApproved: true,
    providerActive: true,
    capabilityApproved: true,
    complianceEvidenceValid: true,
    integrationCertified: true,
    productionCredentialsValid: true,
    providerHealthAcceptable: true,
    operationalAvailabilityAcceptable: true,
    transactionEligible: true,
  });
  assert.equal(allMet.routable, true);
  const blocked = routable({
    capabilityState: "DECLARED",
    organizationApproved: true,
    providerActive: true,
    capabilityApproved: false,
    complianceEvidenceValid: false,
    integrationCertified: false,
    productionCredentialsValid: true,
    providerHealthAcceptable: true,
    operationalAvailabilityAcceptable: true,
    transactionEligible: true,
  });
  assert.equal(blocked.routable, false);
  assert.deepEqual(
    [...blocked.unmet].sort(),
    [
      "CAPABILITY_NOT_ACTIVE",
      "CAPABILITY_NOT_APPROVED",
      "COMPLIANCE_EVIDENCE_INVALID",
      "INTEGRATION_NOT_CERTIFIED",
    ].sort(),
  );
});

test("standard provider status mapping is total and deterministic", () => {
  assert.equal(mapProviderStatus("succeeded"), "Confirmed");
  assert.equal(mapProviderStatus("failed"), "Rejected");
  assert.equal(mapProviderStatus("cancelled"), "Rejected");
  assert.equal(mapProviderStatus("action_required"), "Requires action");
  assert.equal(mapProviderStatus("pending"), "Pending");
  assert.equal(mapProviderStatus("processing"), "Pending");
  assert.throws(() => mapProviderStatus("weird"));
  assert.ok(providerErrorCodes.includes("AUTHENTICATION_FAILURE"));
});

test("standard adapter creates payments over the provider protocol", async () => {
  const config = {
    adapter: "standard",
    baseUrl: "https://api.example-provider.test",
    auth: "bearer",
    credentialRef: "cred-1",
  };
  assert.ok(standardConfigSchema.safeParse(config).success);
  const requests: { path: string; body: unknown; headers: Record<string, string> }[] =
    [];
  const adapter = standardExecutionAdapter(config, {
    credentials: { get: async () => "secret-token" },
    http: async (_base, options) => {
      requests.push({
        path: options.path,
        body: options.body ? JSON.parse(options.body) : undefined,
        headers: options.headers || {},
      });
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ providerPaymentId: "pp-1", status: "succeeded" }),
      };
    },
    clock: () => new Date(),
  });
  const attempt = {
    key: "attempt:1",
    providerReference: null,
  } as never;
  const intent = {
    reference: "ref-1",
    amount: "100.00",
    asset: { kind: "fiat", identifier: "NGN", network: "" },
    selectedMethod: "bank-transfer",
    metadata: {},
  } as never;
  const result = await adapter.create(attempt, intent);
  assert.equal(result.state, "Confirmed");
  assert.equal(result.reference, "pp-1");
  assert.equal(requests[0].path, "/payments");
  assert.equal(requests[0].headers.Authorization, "Bearer secret-token");
  assert.equal((requests[0].body as { idempotencyKey: string }).idempotencyKey, "attempt:1");
});

test("integration adapters validate stored integration metadata before execution", () => {
  const deps = {
    credentials: { get: async () => "secret" },
    http: async () => ({ status: 200, headers: {}, body: "{}" }),
    clock: () => new Date(),
  };
  assert.doesNotThrow(() =>
    standardExecutionAdapter(
      {
        adapter: "standard",
        mode: "STANDARD",
        maintainedBy: "PROVIDER",
        baseUrl: "https://api.example-provider.test",
        auth: "bearer",
        mappings: "Review note only",
        signing: "HMAC-SHA256",
        healthPath: "/health",
        events: "webhook",
        timeoutMs: 8000,
        retries: 1,
      },
      deps,
    ),
  );
  assert.throws(
    () => standardExecutionAdapter({ adapter: "standard" }, deps),
    /INVALID_CONFIGURATION/,
  );
  assert.throws(
    () =>
      configurableExecutionAdapter(
        {
          adapter: "configurable",
          mode: "CONFIGURABLE",
          baseUrl: "https://api.example-provider.test",
        },
        {
          credentials: { get: async () => "secret" },
          http: async () => ({ status: 200, headers: {}, body: "{}" }),
        },
      ),
    /INVALID_CONFIGURATION/,
  );
});

test("standard webhook verification binds timestamp, event id, and body", () => {
  const body = '{"event":"payment"}';
  const timestamp = "1700000000";
  const eventId = "evt-1";
  const secret = "signing-secret";
  const sig = createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${body}`)
    .digest("hex");
  assert.equal(
    verifyStandardWebhook(secret, timestamp, eventId, body, sig, new Date(1700000000 * 1000)),
    true,
  );
  assert.equal(
    verifyStandardWebhook(secret, timestamp, eventId, body, "bad", new Date(1700000000 * 1000)),
    false,
  );
});

test("configurable adapter maps a declared API safely and without code execution", async () => {
  const config = {
    adapter: "configurable",
    baseUrl: "https://api.example-provider.test",
    auth: "api-key",
    credentialRef: "cred-1",
    create: {
      method: "POST",
      path: "/v1/charge",
      body: {
        amount: { source: "amount" },
        ref: { source: "reference" },
        key: { literal: "static" },
      },
      response: { reference: "data.id", status: "data.status" },
    },
    status: {
      method: "GET",
      path: "/v1/charge/{reference}",
      response: { reference: "data.id", status: "data.status", amount: "data.amount" },
    },
    statusMap: { SUCCESS: "succeeded", FAILED: "failed" },
  };
  assert.ok(configurableConfigSchema.safeParse(config).success);
  const seen: { path: string; body?: string }[] = [];
  const adapter = configurableExecutionAdapter(config, {
    credentials: { get: async () => "key" },
    http: async (_base, options) => {
      seen.push({ path: options.path, body: options.body });
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({
          data: { id: "p-9", status: "SUCCESS", amount: "100.00" },
        }),
      };
    },
  });
  const attempt = { key: "attempt:2", providerReference: null } as never;
  const intent = {
    reference: "ref-9",
    amount: "100.00",
    asset: { kind: "fiat", identifier: "NGN", network: "" },
    selectedMethod: "bank-transfer",
  } as never;
  const result = await adapter.create(attempt, intent);
  assert.equal(result.state, "Confirmed");
  assert.equal(result.reference, "p-9");
  assert.equal(seen[0].path, "/v1/charge");
  const body = JSON.parse(seen[0].body!) as Record<string, string>;
  assert.equal(body.amount, "100.00");
  assert.equal(body.ref, "ref-9");
  assert.equal(body.key, "static");
});

test("compliance eligibility aggregates decisions and reasons", () => {
  const result = evaluateCompliance(
    {
      operation: "pay-in",
      originCountry: "NG",
      merchantCountry: "NG",
      paymentMethod: "card",
    },
    defaultComplianceRules,
  );
  assert.equal(result.decision, "ALLOW");
  const sanctioned = evaluateCompliance(
    {
      operation: "pay-in",
      originCountry: "NG",
      merchantCountry: "NG",
      paymentMethod: "stablecoin",
      riskContext: { sanctioned: true },
    },
    defaultComplianceRules,
  );
  assert.equal(sanctioned.decision, "BLOCK");
  assert.ok(sanctioned.reasons.some((r) => r.code === "SANCTIONED_PARTY"));
  assert.equal(mostSevere("ALLOW_WITH_CONTROLS", "MANUAL_REVIEW"), "MANUAL_REVIEW");
});

test("certification is capability-aware and failures are human-readable", () => {
  const cardOnly = { operations: ["create-payment", "payment-status"], webhook: false };
  const plan = buildCertificationPlan(cardOnly);
  assert.ok(plan.every((s) => s.id !== "cancel-payment"));
  assert.ok(plan.every((s) => s.id !== "webhook-signature"));
  const withWebhook = { operations: ["create-payment", "payment-status"], webhook: true };
  assert.ok(buildCertificationPlan(withWebhook).some((s) => s.id === "webhook-signature"));
  assert.equal(
    humanizeFailure("PROVIDER_EVENT_AUTHENTICITY_INVARIANT_FAILED"),
    "Webhook signature could not be verified",
  );
  assert.ok(certificationScenarios.length >= 4);
});

test("standard and configurable integrations resolve and observe connectivity", async () => {
  const standard = resolveProviderAdapter("standard", "1", "production");
  assert.equal(standard.validate({ adapter: "standard" }), true);
  assert.equal(standard.validate({ mode: "STANDARD" }), true);
  const configurable = resolveProviderAdapter("configurable", "1", "sandbox");
  assert.equal(configurable.validate({ adapter: "configurable" }), true);
  const result = await observeProvider(
    standard,
    "health",
    {
      config: { adapter: "standard", baseUrl: "https://api.example.test" },
    },
    {
      credentials: { get: async () => "secret" },
      http: async () => ({ status: 200, bytes: 0 }),
      clock: () => new Date(),
      telemetry: () => {},
    },
    { diagnostic: "safe-ref" },
  );
  assert.deepEqual(result, { ok: true, value: { status: "Available" } });
});
