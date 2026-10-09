import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { providerCoverage } from "../lib/providers/coverage";
import { nativeModules } from "../lib/providers/adapters/native/registry";
import {
  resolveProviderAdapter,
  observeProvider,
} from "../lib/portal/provider-adapters";
import { readDocs } from "../lib/docs";

test("coverage exhaustively inventories every provider guide and distinguishes the excluded RWA", () => {
  const root = path.join(process.cwd(), "docs/providers");
  const guides = readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) =>
      readdirSync(path.join(root, d.name))
        .filter((f) => f.endsWith(".md") && f !== "README.md")
        .map((f) => `${d.name}/${f.slice(0, -3)}`),
    );
  assert.deepEqual(providerCoverage.map((c) => c.guide).sort(), guides.sort());
  assert.equal(providerCoverage.length, 41);
  assert.equal(providerCoverage.filter((c) => c.method !== null).length, 40);
  assert.equal(new Set(guides.map((g) => g.split("/")[0])).size, 8);
  const known = new Set([
    ...nativeModules.map((a) => a.id),
    "stripe-connect",
    "paypal",
    "paystack",
    "flutterwave",
    "monnify",
  ]);
  for (const entry of providerCoverage) {
    for (const id of entry.adapters)
      assert(known.has(id), `${entry.guide}: missing adapter ${id}`);
    if (!entry.adapters.length)
      assert(entry.requirement, `${entry.guide}: missing remaining scope`);
    for (const root of ["docs", "content/docs"])
      assert(
        readFileSync(
          path.join(root, "providers", `${entry.guide}.md`),
          "utf8",
        ).includes("Implementation status"),
      );
  }
});

test("coverage is served publicly and configured native code alone cannot manufacture provider availability", async () => {
  const doc = readDocs().find((d) => d.slug === "provider-coverage");
  assert(doc?.content.includes("41 guides"));
  const adapter = resolveProviderAdapter("stripe", "1", "sandbox");
  const result = await observeProvider(
    adapter,
    "health",
    {
      config: {
        adapter: "stripe",
        mode: "NATIVE",
        environment: "sandbox",
        secretKeyRef: "secret",
        returnUrl: "https://merchant.example/return",
        cancelUrl: "https://merchant.example/cancel",
      },
    },
    {
      credentials: {
        get: async () => {
          throw new Error("No external call is justified");
        },
      },
      http: async () => {
        throw new Error("No external call is justified");
      },
      clock: () => new Date(),
      telemetry: () => {},
    },
    { diagnostic: "test" },
  );
  assert.deepEqual(result, { ok: true, value: { status: "Unknown" } });
  assert.throws(() => resolveProviderAdapter("binance-pay", "1", "sandbox"));
});
