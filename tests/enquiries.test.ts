import { test } from "node:test";
import assert from "node:assert/strict";
import { enquirySchema, safeIntent } from "../lib/enquiries/schema";
import { deliver, webhookDestination } from "../lib/enquiries/delivery";
import { POST } from "../app/api/enquiries/route";
const enquiry = enquirySchema.parse({
  submissionId: crypto.randomUUID(),
  intent: "merchant",
  name: "Test User",
  email: "test@example.com",
  company: "Example",
  country: "NG",
  message: "A controlled test enquiry.",
});
test("strict schema rejects invalid, overlong and honeypot payloads", () => {
  for (const p of [
    { ...enquiry, email: "bad" },
    { ...enquiry, message: "x".repeat(4001) },
    { ...enquiry, companyFax: "bot" },
    { ...enquiry, destination: "https://example.com" },
  ])
    assert.equal(enquirySchema.safeParse(p).success, false);
  assert.equal(safeIntent("unexpected"), "general");
});
test("destination accepts operator HTTPS only", () => {
  assert.equal(webhookDestination("http://example.com"), undefined);
  assert.equal(webhookDestination("https://user:pass@example.com"), undefined);
});
test("unconfigured delivery never reports success", async () => {
  const result = await deliver(enquiry, {});
  assert.equal(result.ok, false);
  assert.equal(result.status, 503);
});
test("confirmed acceptance uses validated fields, trusted destination, no redirects and stable identifier", async () => {
  const mock: typeof fetch = async (url, init) => {
    assert.equal(url, "https://leads.example.test/");
    assert.equal(init?.redirect, "error");
    assert.equal(
      (init?.headers as Record<string, string>)["Idempotency-Key"],
      enquiry.submissionId,
    );
    const body = JSON.parse(String(init?.body));
    assert.equal(body.page, "/contact");
    assert.equal(body.companyFax, undefined);
    return new Response(null, { status: 202 });
  };
  assert.equal(
    (await deliver(enquiry, { url: "https://leads.example.test" }, mock)).ok,
    true,
  );
});
test("upstream failure and timeout are honest", async () => {
  const failed: typeof fetch = async () => new Response(null, { status: 500 });
  assert.equal(
    (await deliver(enquiry, { url: "https://leads.example.test" }, failed)).ok,
    false,
  );
  const timeout: typeof fetch = async (_url, init) =>
    new Promise((_resolve, reject) =>
      init?.signal?.addEventListener("abort", () =>
        reject(new Error("aborted")),
      ),
    );
  const result = await deliver(
    enquiry,
    { url: "https://leads.example.test" },
    timeout,
    10,
  );
  assert.equal(result.status, 504);
  assert.match(result.message, /may have reached/);
});
test("endpoint enforces content type, byte limits, schema and unconfigured state", async () => {
  const request = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/api/enquiries", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });
  assert.equal(
    (await POST(request("{}", { "content-type": "text/plain" }))).status,
    415,
  );
  assert.equal((await POST(request("x".repeat(16001)))).status, 413);
  assert.equal((await POST(request("{}"))).status, 400);
  assert.equal(
    (
      await POST(
        request(JSON.stringify(enquiry), {
          origin: "https://untrusted.example",
        }),
      )
    ).status,
    403,
  );
  const previous = process.env.CONTACT_WEBHOOK_URL;
  delete process.env.CONTACT_WEBHOOK_URL;
  try {
    assert.equal((await POST(request(JSON.stringify(enquiry)))).status, 503);
  } finally {
    if (previous) process.env.CONTACT_WEBHOOK_URL = previous;
  }
});
