import test from "node:test";
import assert from "node:assert/strict";
import {
  adapterOperations,
  resolveProviderAdapter,
  observeProvider,
  normalizeProviderError,
  ProviderAdapter,
  AdapterDependencies,
} from "../lib/portal/provider-adapters";
import { config, now } from "./fixtures/providers";
const deps: AdapterDependencies = {
  credentials: { get: async () => "secret-DO-NOT-LEAK" },
  http: async () => ({ status: 200, bytes: 0 }),
  clock: () => now,
  telemetry: () => {},
};
// Reusable conformance harness for each trusted adapter implementation.
export function adapterConformance(
  adapter: ProviderAdapter,
  validConfig: unknown,
) {
  test(`${adapter.id}: normalized results, unsupported operations, configuration and cancellation`, async () => {
    const input = { config: validConfig, capabilityId: "fictional" };
    for (const operation of adapter.operations)
      assert.equal(
        (
          await observeProvider(adapter, operation, input, deps, {
            diagnostic: "safe-ref",
          })
        ).ok,
        true,
      );
    const unsupported = adapterOperations.find(
      (operation) => !adapter.operations.includes(operation),
    );
    if (unsupported)
      assert.deepEqual(
        await observeProvider(adapter, unsupported, input, deps, {
          diagnostic: "safe-ref",
        }),
        {
          ok: false,
          error: { code: "UNSUPPORTED_OPERATION", diagnostic: "safe-ref" },
        },
      );
    assert.equal(
      (
        await observeProvider(adapter, "health", { config: {} }, deps, {
          diagnostic: "safe-ref",
        })
      ).ok,
      false,
    );
    const controller = new AbortController();
    controller.abort();
    const blocked: ProviderAdapter = {
      ...adapter,
      observe: async () => new Promise(() => {}),
    };
    assert.deepEqual(
      await observeProvider(blocked, "health", input, deps, {
        diagnostic: "safe-ref",
        signal: controller.signal,
      }),
      { ok: false, error: { code: "TIMEOUT", diagnostic: "safe-ref" } },
    );
    const unsafe: ProviderAdapter = {
      ...adapter,
      observe: async () => {
        throw {
          status: 401,
          message: "secret-DO-NOT-LEAK",
          body: "secret-DO-NOT-LEAK",
        };
      },
    };
    const result = await observeProvider(unsafe, "health", input, deps, {
      diagnostic: "safe-ref",
    });
    assert.equal(JSON.stringify(result).includes("DO-NOT-LEAK"), false);
    assert.deepEqual(result, {
      ok: false,
      error: { code: "AUTHENTICATION_FAILURE", diagnostic: "safe-ref" },
    });
    const malformed = {
      ...adapter,
      observe: async () => ({ token: "DO-NOT-LEAK" }),
    };
    assert.deepEqual(
      await observeProvider(malformed, "health", input, deps, {
        diagnostic: "safe-ref",
      }),
      {
        ok: false,
        error: { code: "MALFORMED_RESPONSE", diagnostic: "safe-ref" },
      },
    );
  });
}
adapterConformance(resolveProviderAdapter("simulator", "1", "sandbox"), config);
test("trusted resolution forbids arbitrary code and production simulation", () => {
  for (const id of ["../../arbitrary", "provider", "simulator"])
    assert.throws(() => resolveProviderAdapter(id, "1", "production"));
});
test("error categories are bounded and never contain raw upstream content", () => {
  for (const [error, code] of [
    [{ status: 403 }, "AUTHORIZATION_FAILURE"],
    [{ status: 429 }, "RATE_LIMITED"],
    [{ status: 503 }, "PROVIDER_UNAVAILABLE"],
    [{ code: "ENOTFOUND" }, "NETWORK_FAILURE"],
    [{ code: "ETIMEDOUT" }, "TIMEOUT"],
    [new Error("secret"), "UNKNOWN_PROVIDER_ERROR"],
  ] as const)
    assert.equal(normalizeProviderError(error), code);
});
