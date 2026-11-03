import test from "node:test";
import assert from "node:assert/strict";
import { invoiceLines, periodEnd, periodIndex, planInput, toMinor, fromMinor } from "../lib/subscriptions/billing";

const iso = (d: Date) => d.toISOString().slice(0, 10);

test("subscriptions: monthly periods keep their anchor day, clamped to short months", () => {
  const anchor = new Date("2026-01-31T10:00:00Z");
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => iso(periodEnd(anchor, "month", 1, i))),
    ["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
  );
  assert.equal(iso(periodEnd(new Date("2028-01-31T00:00:00Z"), "month", 1, 0)), "2028-02-29", "leap year");
  assert.equal(iso(periodEnd(anchor, "year", 1, 0)), "2027-01-31");
  assert.equal(iso(periodEnd(anchor, "week", 2, 0)), "2026-02-14");
  assert.equal(iso(periodEnd(anchor, "month", 3, 1)), "2026-07-31", "every 3 months");
  assert.equal(periodIndex(anchor, "month", 1, periodEnd(anchor, "month", 1, 2)), 2);
});

test("subscriptions: an invoice is next period's price plus last period's billable usage", () => {
  const plan = {
    name: "Pro",
    amount: "20",
    currency: "USD",
    meters: [
      { key: "api_calls", name: "API calls", unitAmount: "0.002", includedUnits: "1000" },
      { key: "storage_gb", name: "Storage", unitAmount: "0.1", includedUnits: "0" },
    ],
  };
  const usage = [
    { meter: "api_calls", quantity: "1200" },
    { meter: "api_calls", quantity: "301" },
    { meter: "storage_gb", quantity: "2.5" },
    { meter: "other", quantity: "99" },
  ];
  const bill = invoiceLines(plan, usage, { base: true });
  assert.deepEqual(bill.lines, [
    { description: "Pro", quantity: "1", unitAmount: "20", amount: "20.00" },
    // 1501 - 1000 included = 501 × $0.002 = $1.002 → $1.00
    { description: "API calls", quantity: "501", unitAmount: "0.002", amount: "1.00" },
    { description: "Storage", quantity: "2.5", unitAmount: "0.1", amount: "0.25" },
  ]);
  assert.equal(bill.total, "21.25");
  // Usage within the allowance bills nothing; a final invoice has no price.
  assert.equal(invoiceLines(plan, [{ meter: "api_calls", quantity: "999" }], { base: false }).totalMinor, 0n);
});

test("subscriptions: amounts round half up in the currency's precision", () => {
  assert.equal(toMinor("19.995", "USD"), 2000n);
  assert.equal(toMinor("1500", "JPY"), 1500n);
  assert.equal(fromMinor(150000n, "NGN"), "1500.00");
  const half = invoiceLines({ name: "x", amount: "0", currency: "USD", meters: [{ key: "u", name: "Units", unitAmount: "0.005", includedUnits: "0" }] }, [{ meter: "u", quantity: "1" }], { base: true });
  assert.equal(half.total, "0.01", "half a cent rounds up");
});

test("subscriptions: plan input rules", () => {
  const ok = { name: "Pro", amount: "20", currency: "USD", interval: "month", crypto: true };
  assert.equal(planInput.safeParse(ok).success, true);
  assert.equal(planInput.safeParse({ ...ok, crypto: false }).success, false, "needs a way to pay");
  assert.equal(planInput.safeParse({ ...ok, amount: "0" }).success, false, "needs a price or a meter");
  assert.equal(
    planInput.safeParse({ ...ok, amount: "0", meters: [{ key: "api_calls", name: "Calls", unitAmount: "0.01" }] }).success,
    true,
    "usage-only plan",
  );
  assert.equal(
    planInput.safeParse({
      ...ok,
      meters: [
        { key: "a", name: "A", unitAmount: "1" },
        { key: "a", name: "B", unitAmount: "1" },
      ],
    }).success,
    false,
    "meter keys are unique",
  );
  assert.equal(planInput.safeParse({ ...ok, meters: [{ key: "API Calls", name: "x", unitAmount: "1" }] }).success, false, "meter key format");
});
