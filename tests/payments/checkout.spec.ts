import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { paymentFixtures } from "../../scripts/payment-fixtures";
import { createIntent, createSession } from "../../lib/payments/service";
import { workOnce } from "../../lib/portal/worker";
import { db } from "../../lib/portal/db";
import { reconcile } from "../../lib/payments/processing";
import { deliver } from "../../lib/payments/delivery";
import { signature } from "../../lib/payments/contracts";
const asset = { kind: "fiat", identifier: "NGN", network: "" };
test("checkout: explicit selection, action, refresh, settlement, signed notification and balanced journal", async ({
  page,
  request,
}) => {
  const orgId = await paymentFixtures();
  const i = await createIntent(orgId, randomUUID(), {
    reference: "Browser order",
    amount: "100.00",
    asset,
    precision: 2,
    methods: ["bank-transfer"],
    settlement: asset,
    returnUrl: "http://127.0.0.1:3000/",
    scenario: "action",
  });
  const s = await createSession(orgId, i.id);
  await page.goto(s.checkoutPath);
  const radio = page.getByRole("radio", { name: "bank transfer" });
  await expect(radio).toBeEnabled();
  await expect(radio).not.toBeChecked();
  await radio.check();
  await page
    .getByRole("button", { name: "Confirm payment", exact: true })
    .click();
  await expect
    .poll(() => db.paymentAttempt.count({ where: { intentId: i.id } }))
    .toBe(1);
  const active = await db.paymentAttempt.findFirstOrThrow({
    where: { intentId: i.id },
  });
  await workOnce(`dispatch:${active.id}`);
  await expect(
    page.getByRole("button", { name: "Complete sandbox action" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Complete sandbox action" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Complete sandbox action" }).click();
  await expect
    .poll(
      async () =>
        (
          await db.simulatorPayment.findUniqueOrThrow({
            where: { key: active.key },
          })
        ).state,
    )
    .toBe("Confirmed");
  await expect
    .poll(() => db.job.count({ where: { key: `action:${active.id}` } }))
    .toBe(1);
  await workOnce(`action:${active.id}`);
  await workOnce(`settle:${active.id}`);
  await expect(
    page.getByRole("heading", { name: "Payment confirmed." }),
  ).toBeVisible();
  const a = await db.paymentAttempt.findFirstOrThrow({
    where: { intentId: i.id },
  });
  expect((await reconcile(a.id)).result).toBe("Exact match");
  const e = await db.merchantEvent.findFirstOrThrow({
    where: { intentId: i.id, type: "payment.confirmed" },
  });
  await db.merchantDelivery.update({
    where: { eventId: e.id },
    data: { state: "Pending" },
  });
  const configured = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId },
  });
  await db.merchantConfig.update({
    where: { orgId },
    data: { webhookUrl: null },
  });
  try {
    await expect(deliver(e.id)).rejects.toThrow();
    expect(
      (await db.paymentIntent.findUniqueOrThrow({ where: { id: i.id } })).state,
    ).toBe("Confirmed");
  } finally {
    await db.merchantConfig.update({
      where: { orgId },
      data: { webhookUrl: configured.webhookUrl },
    });
  }
  await deliver(e.id);
  expect(
    (await db.merchantDelivery.findUniqueOrThrow({ where: { eventId: e.id } }))
      .state,
  ).toBe("Delivered");
  // Verified duplicate/out-of-order provider ingress never duplicates recognition.
  const body = JSON.stringify({
    type: "payment.status",
    reference: a.providerReference,
    state: "Pending",
    amount: "100.00",
    asset,
  });
  const eventId = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    "content-type": "application/json",
    "payrouta-event-id": eventId,
    "payrouta-timestamp": timestamp,
    "payrouta-signature": signature(
      "fictional-payment-webhook-secret-2026",
      timestamp,
      eventId,
      body,
    ),
  };
  // All selected fixture providers need the payment webhook credential; restrict this test to dedicated fixtures below.
  if (a.providerOrgId.startsWith("payment-demo-")) {
    const ingress = await request.post(
      `/api/payments/provider/${a.integrationId}`,
      { headers, data: body },
    );
    expect(ingress.ok(), await ingress.text()).toBeTruthy();
    const duplicate = await request.post(
      `/api/payments/provider/${a.integrationId}`,
      { headers, data: body },
    );
    expect((await duplicate.json()).duplicate).toBe(true);
    const inbox = await db.paymentInbox.findFirstOrThrow({
      where: { integrationId: a.integrationId, eventId },
    });
    await workOnce(`inbox:${inbox.id}`);
    expect(
      (await db.paymentInbox.findUniqueOrThrow({ where: { id: inbox.id } }))
        .state,
    ).toBe("Processed");
    expect(
      (await db.paymentAttempt.findUniqueOrThrow({ where: { id: a.id } }))
        .state,
    ).toBe("Confirmed");
  }
  const entry = await db.journalEntry.findUniqueOrThrow({
    where: { source: `payment:${i.id}` },
    include: { postings: true },
  });
  expect(
    entry.postings.reduce(
      (n, p) => n + BigInt(p.debit.toString()) - BigInt(p.credit.toString()),
      0n,
    ),
  ).toBe(0n);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("checkout: definite failure recovers safely and client cannot replace invoice amount", async ({
  page,
  request,
}) => {
  const orgId = await paymentFixtures();
  const i = await createIntent(orgId, randomUUID(), {
    reference: "Failure recovery",
    amount: "100.00",
    asset,
    precision: 2,
    methods: ["bank-transfer"],
    settlement: asset,
    returnUrl: "http://127.0.0.1:3000/",
    scenario: "rejected",
  });
  const s = await createSession(orgId, i.id);
  expect((await request.get(`/api/checkout/${s.sessionId}`)).status()).toBe(
    401,
  );
  await page.goto(s.checkoutPath);
  const radio = page.getByRole("radio", { name: "bank transfer" });
  await radio.check();
  await page
    .getByRole("button", { name: "Confirm payment", exact: true })
    .click();
  await expect
    .poll(() => db.paymentAttempt.count({ where: { intentId: i.id } }))
    .toBe(1);
  const active = await db.paymentAttempt.findFirstOrThrow({
    where: { intentId: i.id },
  });
  await workOnce(`dispatch:${active.id}`);
  await expect(
    page.getByText("Payment was not completed. Choose a method and try again."),
  ).toBeVisible();
  const status = await page.evaluate(async (id) => {
    const r = await fetch(`/api/checkout/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "select",
        method: "bank-transfer",
        amount: "1.00",
      }),
    });
    return r.status;
  }, s.sessionId);
  expect(status).toBe(400);
  await page.getByRole("button", { name: "Refresh methods" }).click();
  await expect(radio).not.toBeChecked();
  await radio.check();
  await expect(
    page.getByRole("button", { name: "Confirm payment", exact: true }),
  ).toBeVisible();
  expect(
    (await db.paymentIntent.findUniqueOrThrow({ where: { id: i.id } })).amount,
  ).toBe("100.00");
});
