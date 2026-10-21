import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { errorText, offline, shown } from "../lib/error-copy";
import { failure } from "../lib/payments/http";
import { PortalError } from "../lib/portal/domain";

test("failure: codes and 4xx sentences pass through; internal faults get a reference", () => {
  assert.deepEqual(failure(new PortalError("PAYMENT_LINK_METHOD_NOT_ON", 409)), {
    body: { error: "PAYMENT_LINK_METHOD_NOT_ON" },
    status: 409,
  });
  assert.equal(failure(new PortalError("Too many attempts. Try again in a minute.", 429)).body.error, "Too many attempts. Try again in a minute.");
  const original = console.error;
  console.error = () => {};
  try {
    const leaked = failure(new PortalError("Managed secret service is not configured", 503));
    assert.equal(leaked.body.error, "SERVICE_UNAVAILABLE");
    assert.match(leaked.body.reference ?? "", /^[a-f0-9]{8}$/);
    assert.equal(failure(new Error("connect ECONNREFUSED 127.0.0.1:5432")).body.error, "SERVICE_UNAVAILABLE");
  } finally {
    console.error = original;
  }
  const invalid = z.object({ amount: z.string() }).safeParse({ amount: 1 });
  assert.deepEqual(failure(invalid.error).body, { error: "INVALID_REQUEST", fields: ["amount"] });
});

test("errorText: never shows a raw code", () => {
  assert.equal(errorText({ error: "PAYMENT_LINK_CRYPTO_REQUIRES_USD" }, 409), "Stablecoins are offered on USD links only.");
  assert.equal(errorText({ error: "Choose a PDF, PNG, or JPEG under 5 MB" }, 400), "Choose a PDF, PNG, or JPEG under 5 MB");
  assert.doesNotMatch(errorText({ error: "SOME_NEW_CODE" }, 409), /[A-Z]{2,}_/);
  assert.match(errorText({ error: "SERVICE_UNAVAILABLE", reference: "ab12cd34" }, 503), /quote ab12cd34\.$/);
  assert.equal(errorText({ error: { code: "UNAUTHORIZED" } }, 401), "Your session has ended. Sign in again to continue.");
  assert.match(errorText(null, 502), /on our side/);
  assert.equal(shown(new TypeError("Failed to fetch")), offline);
});
