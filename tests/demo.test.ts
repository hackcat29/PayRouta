import { test } from "node:test";
import assert from "node:assert/strict";
import { initial, reducer, providers, scenarios } from "../lib/demo/model";
test("unavailable methods cannot be selected", () => {
  assert.equal(
    reducer(initial, { type: "method", value: "card" }).method,
    null,
  );
});
test("all provider comparisons are constrained to the chosen method", () => {
  scenarios.forEach((scenario, i) =>
    scenario.methods.forEach((m) => {
      const s = reducer(reducer(initial, { type: "scenario", value: i }), {
        type: "method",
        value: m.id,
      });
      assert.equal(providers(s).length, 3);
      assert.ok(providers(s).every((p) => p.method === m.id));
    }),
  );
});
test("scenario changes clear selection, exclusions and outcome", () => {
  let s = reducer(initial, { type: "method", value: "bank" });
  s = reducer(s, { type: "exclude" });
  s = reducer(s, { type: "start" });
  s = reducer(s, { type: "scenario", value: 1 });
  assert.equal(s.method, null);
  assert.equal(s.phase, "idle");
  assert.deepEqual(s.excluded, []);
  assert.deepEqual(providers(s), []);
});
test("pre-execution failover stays within method and exhaustion never changes method", () => {
  let s = reducer(initial, { type: "method", value: "bank" });
  for (let i = 0; i < 3; i++) {
    s = reducer(s, { type: "exclude" });
    assert.equal(s.method, "bank");
    assert.ok(providers(s).every((p) => p.method === "bank"));
  }
  assert.equal(providers(s).length, 0);
  assert.equal(reducer(s, { type: "start" }).phase, "idle");
});
test("execution locks failover and double initiation", () => {
  let s = reducer(initial, { type: "method", value: "bank" });
  s = reducer(s, { type: "start" });
  assert.deepEqual(reducer(s, { type: "start" }), s);
  assert.deepEqual(reducer(s, { type: "exclude" }), s);
});
test("rapid changes invalidate stale completion callbacks", () => {
  let s = reducer(initial, { type: "method", value: "bank" });
  s = reducer(s, { type: "start" });
  const oldRun = s.run;
  s = reducer(s, { type: "policy", value: "Faster" });
  s = reducer(s, { type: "advance", run: oldRun, phase: "confirmed" });
  assert.equal(s.phase, "idle");
  s = reducer(s, { type: "method", value: "usdc" });
  assert.equal(
    reducer(s, { type: "advance", run: oldRun, phase: "settled" }).phase,
    "idle",
  );
});
test("payment confirmation precedes settlement", () => {
  let s = reducer(reducer(initial, { type: "method", value: "bank" }), {
    type: "start",
  });
  assert.equal(
    reducer(s, { type: "advance", run: s.run, phase: "settled" }).phase,
    "processing",
  );
  s = reducer(s, { type: "advance", run: s.run, phase: "confirmed" });
  assert.equal(s.phase, "confirmed");
  s = reducer(s, { type: "advance", run: s.run, phase: "settled" });
  assert.equal(s.phase, "settled");
});
