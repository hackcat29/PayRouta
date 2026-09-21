import { test } from "node:test";
import assert from "node:assert/strict";
import { minor, rank, signature, verify } from "../lib/payments/contracts";
import { validatePostings } from "../lib/payments/journal";
test("exact minor units beyond Number precision and invalid scale", () => {
  assert.equal(minor("9007199254740993.01", 2), 900719925474099301n);
  assert.throws(() => minor("1.001", 2));
  assert.throws(() => minor("-1", 2));
});
test("routing policies distinguish cost and speed, exclude unknown economics and break ties", () => {
  const a = {
    profileId: "a",
    fee: "10",
    seconds: 120,
    reliability: null,
    capacity: 10000,
  };
  const b = { ...a, profileId: "b", fee: "20", seconds: 60 };
  assert.equal(rank([b, a], "lower-cost")[0].profileId, "a");
  assert.equal(rank([a, b], "faster")[0].profileId, "b");
  assert.equal(rank([{ ...a, fee: null }], "balanced").length, 0);
  assert.equal(
    rank([b, { ...b, profileId: "a" }], "balanced")[0].profileId,
    "a",
  );
});
test("journal balances and rejects invalid accounts and double-sided lines", () => {
  validatePostings([
    { account: "provider-clearing", debit: "100", credit: "0" },
    { account: "merchant-payable", debit: "0", credit: "100" },
  ]);
  assert.throws(() =>
    validatePostings([
      { account: "provider-clearing", debit: "101", credit: "0" },
      { account: "merchant-payable", debit: "0", credit: "100" },
    ]),
  );
});
test("webhook signature binds body, timestamp and identity, and expires", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  const t = String(now.getTime() / 1000);
  const sig = signature("secret", t, "e1", "{}");
  assert.ok(verify("secret", t, "e1", "{}", sig, now));
  assert.ok(!verify("secret", t, "e2", "{}", sig, now));
  assert.ok(
    !verify("secret", t, "e1", "{}", sig, new Date(now.getTime() + 300001)),
  );
});
