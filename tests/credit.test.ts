import { test } from "node:test";
import assert from "node:assert/strict";
import { costOf, instalmentOffer, offerSummary, splitInstalments } from "../lib/treasury/credit";
import { sandboxCreditPlatform, sandboxOffers } from "../lib/treasury/platforms/sandbox-credit";

test("instalments add up exactly and the first is never the smaller", () => {
  assert.deepEqual(splitInstalments(10000n, 4), [2500n, 2500n, 2500n, 2500n]);
  assert.deepEqual(splitInstalments(10001n, 3), [3334n, 3334n, 3333n]);
  for (const [total, n] of [[1n, 4], [99999n, 6], [12540n, 3]] as const) {
    const parts = splitInstalments(total, n);
    assert.equal(parts.reduce((a, b) => a + b, 0n), total);
    assert.ok(parts[0] >= parts[parts.length - 1]);
  }
  assert.throws(() => splitInstalments(100n, 0));
});

test("cost of credit rounds half up in minor units", () => {
  assert.equal(costOf(12000n, 450), 540n);
  assert.equal(costOf(111n, 450), 5n); // 4.995 -> 5
  assert.equal(costOf(12000n, 0), 0n);
});

test("an instalment offer discloses due today, each payment, total and cost", () => {
  const o = instalmentOffer({
    id: "m3",
    lender: "Example Lender",
    termsUrl: "https://lender.example/terms",
    amountMinor: 12000n,
    instalments: 3,
    interval: "month",
    costBps: 450,
    aprBasisPoints: null,
    firstDueToday: false,
  });
  assert.equal(o.kind, "instalments");
  assert.equal(o.totalMinor, "12540");
  assert.equal(o.costMinor, "540");
  assert.equal(o.instalmentMinor, "4180");
  assert.equal(o.firstInstalmentMinor, undefined);
  const uneven = instalmentOffer({ id: "u", lender: "L", termsUrl: "", amountMinor: 4000n, instalments: 3, interval: "month", costBps: 450, aprBasisPoints: null, firstDueToday: false });
  assert.equal(uneven.totalMinor, "4180");
  assert.equal(uneven.instalmentMinor, "1393");
  assert.equal(uneven.firstInstalmentMinor, "1394");
  assert.equal(o.dueTodayMinor, "0");
  assert.equal(offerSummary(o), "3 payments, every month");
  const later = instalmentOffer({ ...o, id: "pl", amountMinor: 5000n, instalments: 1, costBps: 0, aprBasisPoints: 0, firstDueToday: false });
  assert.equal(later.kind, "pay-later");
  assert.equal(offerSummary(later), "Pay in full in 30 days");
});

test("the sandbox lender's plans follow its limits and countries", () => {
  const limits = { minMinor: 1000n, maxMinor: 500000000n, monthlyFromMinor: 5000000n, countries: null };
  assert.deepEqual(sandboxOffers(12000n, "NG", limits).map((o) => o.id), ["sbxc-p4", "sbxc-pl30", "sbxc-m3"]);
  assert.deepEqual(sandboxOffers(6000000n, "NG", limits).map((o) => o.id), ["sbxc-p4", "sbxc-pl30", "sbxc-m3", "sbxc-m6"]);
  assert.deepEqual(sandboxOffers(999n, "NG", limits), []);
  assert.deepEqual(sandboxOffers(12000n, "GB", { ...limits, countries: ["NG", "KE"] }), []);
  const p4 = sandboxOffers(12000n, undefined, limits)[0];
  assert.equal(p4.dueTodayMinor, "3000");
  assert.equal(p4.costMinor, "0");
});

test("the sandbox lender is a sandbox-only credit module offering only credit", () => {
  const m = sandboxCreditPlatform.manifest;
  assert.deepEqual(m.methods, ["bnpl"]);
  assert.equal(m.sandboxOnly, true);
  assert.ok(m.credit?.lender.includes("fictional"));
  assert.equal(sandboxCreditPlatform.configSchema.safeParse({ environment: "sandbox", maxMinor: "100" }).success, true);
  assert.equal(sandboxCreditPlatform.configSchema.safeParse({ environment: "sandbox", unknown: 1 }).success, false);
});
