import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { accessRequestSchema } from "../lib/portal/access-request-schema";
import { reviewSchema } from "../lib/portal/access-requests";

const valid = {
  submissionId: randomUUID(),
  name: "Ada Obi",
  email: "Ada@Example.com",
  company: "Example Pay",
  website: "https://example.com",
  country: "Nigeria",
  providerType: "Mobile-money provider",
  methods: ["Mobile money", "USSD"],
  markets: "Nigeria, Ghana",
};

test("access requests normalise email and accept the documented fields", () => {
  const parsed = accessRequestSchema.parse(valid);
  assert.equal(parsed.email, "ada@example.com");
  assert.equal(parsed.message, "");
  assert.equal(parsed.companyFax, "");
});

test("access requests reject missing methods, unknown types and bare domains", () => {
  const errors = accessRequestSchema.safeParse({
    ...valid,
    methods: [],
    providerType: "Bank",
    website: "example.com",
  }).error?.flatten().fieldErrors;
  assert.ok(errors?.methods);
  assert.ok(errors?.providerType);
  assert.ok(errors?.website);
});

test("approvals need an organization name; declines don't", () => {
  assert.equal(reviewSchema.safeParse({ decision: "approve", requestId: "r1" }).success, false);
  assert.equal(reviewSchema.safeParse({ decision: "decline", requestId: "r1" }).success, true);
  assert.equal(
    reviewSchema.safeParse({ decision: "approve", requestId: "r1", orgName: "Example Pay" }).success,
    true,
  );
});
