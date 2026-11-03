// Partner module conformance. Every module must pass these checks with its
// harness before it is registered; the same checks can later be pointed at a
// provider's real sandbox by supplying a real transport.
import assert from "node:assert/strict";
import { PortalError } from "../portal/domain";
import type { PartnerHttp, PartnerModule, StatusSnapshot } from "./contract";
import { statusSnapshot } from "./contract";
import { kybFields, kybProfileSchema, type KybField, type KybProfile } from "./kyb";
import { validateManifest } from "./registry";

export type Scenario =
  | "approved"
  | "action-required"
  | "rejected"
  | "garbled"
  | "evil-link"
  | "request-rejected"
  | "unavailable";

export interface CapturedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}

export interface HarnessSetup {
  http: PartnerHttp;
  now: () => Date;
  requests: CapturedRequest[];
  // Provider-side accounts actually created (for retry-safety checks).
  accounts(): number;
}

export interface PartnerHarness {
  module: PartnerModule;
  config: Record<string, unknown>;
  secrets: Record<string, string>;
  scenarios: readonly Scenario[];
  setup(scenario: Scenario): HarnessSetup;
  // Optional per-scenario profile tweak (e.g. the sandbox's "[reject]").
  profile?(scenario: Scenario, base: KybProfile): KybProfile;
  // Time to use for the status read, relative to setup().now().
  statusDelayMs?(scenario: Scenario): number;
  // A correctly signed account event, and a tampered variant.
  event?(setup: HarnessSetup, accountRef: string, tampered: boolean): {
    rawBody: string;
    headers: Headers;
  };
  environment: "sandbox" | "production";
  // Merchant account used for payment checks ("approved" = paid,
  // "action-required" = awaiting the customer, "rejected" = failed).
  paymentAccount?: { accountRef: string; providerAccountId?: string };
  // Payment scenarios the fake provider can express (defaults to scenarios).
  paymentScenarios?: readonly Scenario[];
}

export const baseProfile: KybProfile = kybProfileSchema.parse({
  legalName: "Harbor Goods Ltd",
  tradingName: "Harbor",
  businessType: "company",
  country: "GB",
  registrationNumber: "12345678",
  taxId: "GB123456789",
  website: "https://harbor.example",
  productDescription: "Digital design templates sold as one-off downloads",
  industry: "Digital Goods & Subscriptions",
  supportEmail: "support@harbor.example",
  address: { line1: "1 Dock Street", city: "London", postalCode: "E1 1AA", country: "GB" },
  representative: {
    givenName: "Ada",
    familyName: "Okafor",
    email: "ada@harbor.example",
    title: "Director",
  },
  owners: [{ givenName: "Ada", familyName: "Okafor", country: "GB", ownershipPercent: 100 }],
  monthlyVolume: "10k-50k",
  settlementCurrency: "GBP",
});

// Values planted in fields a module has NOT declared; none may reach the wire.
const canaries: Partial<Record<KybField, (p: KybProfile) => KybProfile>> = {
  legalName: (p) => ({ ...p, legalName: "Canarylegal Ltd" }),
  tradingName: (p) => ({ ...p, tradingName: "Canarytrading" }),
  registrationNumber: (p) => ({ ...p, registrationNumber: "CANARYREG" }),
  taxId: (p) => ({ ...p, taxId: "CANARYTAX" }),
  website: (p) => ({ ...p, website: "https://canarysite.example" }),
  productDescription: (p) => ({ ...p, productDescription: "Canaryproduct descriptions for tests" }),
  industry: (p) => ({ ...p, industry: "Canaryindustry" }),
  supportEmail: (p) => ({ ...p, supportEmail: "canarysupport@harbor.example" }),
  address: (p) => ({ ...p, address: { ...p.address!, line1: "Canaryaddress" } }),
  representative: (p) => ({
    ...p,
    representative: { ...p.representative!, familyName: "Canaryrep", email: "canaryrep@harbor.example" },
  }),
  owners: (p) => ({
    ...p,
    owners: [{ givenName: "Canaryowner", familyName: "Canaryowner", country: "GB", ownershipPercent: 100 }],
  }),
};

export function canaryProfile(shared: readonly KybField[]) {
  let p = baseProfile;
  for (const f of kybFields)
    if (!shared.includes(f) && canaries[f]) p = canaries[f]!(p);
  return p;
}

const credentialsFrom = (secrets: Record<string, string>) => ({
  async get(ref: string) {
    return secrets[ref] ?? "";
  },
});

function adapterFor(h: PartnerHarness, s: HarnessSetup, secrets = h.secrets, now = s.now) {
  return h.module.create(h.module.configSchema.parse(h.config), {
    http: s.http,
    credentials: credentialsFrom(secrets),
    now,
  });
}

async function createIn(h: PartnerHarness, scenario: Scenario, applicationId = "app_conformance_1") {
  const s = h.setup(scenario);
  const adapter = adapterFor(h, s);
  const profile = h.profile ? h.profile(scenario, baseProfile) : baseProfile;
  const created = await adapter.createAccount({
    applicationId,
    environment: h.environment,
    profile,
    returnUrl: "https://payrouta.example/merchant/providers?returned=1",
    refreshUrl: "https://payrouta.example/merchant/providers?refresh=1",
  });
  return { s, adapter, created };
}

async function statusAfter(h: PartnerHarness, scenario: Scenario): Promise<StatusSnapshot> {
  const { s, created } = await createIn(h, scenario);
  const later = () => new Date(s.now().getTime() + (h.statusDelayMs?.(scenario) ?? 0));
  const adapter = adapterFor(h, s, h.secrets, later);
  return statusSnapshot.parse(
    await adapter.status({
      accountRef: created.accountRef,
      providerAccountId: created.snapshot.providerAccountId,
    }),
  );
}

export function conformanceChecks(h: PartnerHarness): { name: string; run(): Promise<void> }[] {
  const m = h.module.manifest;
  const has = (s: Scenario) => h.scenarios.includes(s);
  const checks = [
    {
      name: "manifest is valid and merchant-owned",
      async run() {
        assert.deepEqual(validateManifest(m), []);
      },
    },
    {
      name: "fails closed without credentials",
      async run() {
        const s = h.setup("approved");
        const adapter = adapterFor(h, s, {});
        if (m.sandboxOnly) return; // no credentials exist for the fictional partner
        await assert.rejects(
          adapter.createAccount({
            applicationId: "app_nocreds",
            environment: h.environment,
            profile: baseProfile,
            returnUrl: "https://payrouta.example/r",
            refreshUrl: "https://payrouta.example/f",
          }),
          (e: unknown) => e instanceof PortalError && e.status === 409,
        );
        assert.equal(s.requests.filter((r) => r.path.includes("account") || r.path.includes("referral")).length, 0);
      },
    },
    {
      name: "sends only the fields its manifest declares",
      async run() {
        const s = h.setup("approved");
        await adapterFor(h, s).createAccount({
          applicationId: "app_minimisation",
          environment: h.environment,
          profile: canaryProfile(m.sharedFields),
          returnUrl: "https://payrouta.example/r",
          refreshUrl: "https://payrouta.example/f",
        });
        const wire = JSON.stringify(s.requests).toLowerCase();
        assert.equal(wire.includes("canary"), false, "undeclared field reached the provider");
      },
    },
    {
      name: "creation snapshot is normalized and never approved-by-default",
      async run() {
        const { created } = await createIn(h, "action-required");
        statusSnapshot.parse(created.snapshot);
        assert.notEqual(created.snapshot.state, "Approved");
        assert.ok(created.accountRef.length > 0 && created.accountRef.length <= 200);
      },
    },
    {
      name: "retrying creation never creates a second provider account",
      async run() {
        const s = h.setup("action-required");
        const adapter = adapterFor(h, s);
        const input = {
          applicationId: "app_retry",
          environment: h.environment,
          profile: baseProfile,
          returnUrl: "https://payrouta.example/r",
          refreshUrl: "https://payrouta.example/f",
        };
        const a = await adapter.createAccount(input);
        const b = await adapter.createAccount(input);
        if (!m.sandboxOnly) {
          assert.equal(a.accountRef, b.accountRef);
          assert.ok(s.accounts() <= 1);
        }
      },
    },
    {
      name: "onboarding links stay on the provider's declared hosts",
      async run() {
        const { adapter, created } = await createIn(h, "action-required");
        const link = await adapter.onboardingLink({
          accountRef: created.accountRef,
          applicationId: "app_conformance_1",
          returnUrl: "https://payrouta.example/r",
          refreshUrl: "https://payrouta.example/f",
        });
        assert.ok(m.linkHosts.includes(new URL(link.url).host));
      },
    },
  ];
  if (has("evil-link"))
    checks.push({
      name: "refuses an onboarding link to an undeclared host",
      async run() {
        const s = h.setup("evil-link");
        const adapter = adapterFor(h, s);
        await assert.rejects(
          adapter.onboardingLink({
            accountRef: "acct_1234567890",
            applicationId: "app_conformance_1",
            returnUrl: "https://payrouta.example/r",
            refreshUrl: "https://payrouta.example/f",
          }),
          (e: unknown) => e instanceof PortalError && e.message === "PARTNER_LINK_HOST_NOT_ALLOWED",
        );
      },
    });
  for (const [scenario, state] of [
    ["approved", "Approved"],
    ["action-required", "Action required"],
    ["rejected", "Rejected"],
  ] as const)
    if (has(scenario))
      checks.push({
        name: `maps a ${scenario} provider account to ${state}`,
        async run() {
          assert.equal((await statusAfter(h, scenario)).state, state);
        },
      });
  if (has("garbled"))
    checks.push({
      name: "an unexpected provider response is never read as approved",
      async run() {
        try {
          assert.notEqual((await statusAfter(h, "garbled")).state, "Approved");
        } catch (e) {
          assert.ok(e instanceof PortalError);
        }
      },
    });
  if (has("request-rejected"))
    checks.push({
      name: "provider rejection of a request is terminal (422)",
      async run() {
        await assert.rejects(createIn(h, "request-rejected"), (e: unknown) => e instanceof PortalError && e.status === 422);
      },
    });
  if (has("unavailable"))
    checks.push({
      name: "provider outage is retryable (503)",
      async run() {
        await assert.rejects(createIn(h, "unavailable"), (e: unknown) => e instanceof PortalError && e.status === 503);
      },
    });
  if (h.paymentAccount) {
    const account = h.paymentAccount;
    const payment = (attemptKey: string, amount = "25.00", precision = 2) => ({
      account,
      attemptKey,
      amount,
      precision,
      currency: "GBP",
      method: (m.paymentMethods ?? [])[0]!,
      reference: "order_1",
      returnUrl: "https://payrouta.example/checkout/s1?returned=1",
      cancelUrl: "https://payrouta.example/checkout/s1",
    });
    checks.push(
      {
        name: "payments: executable methods match the manifest",
        async run() {
          const s = h.setup("approved");
          assert.deepEqual([...(adapterFor(h, s).payments?.methods ?? [])], [...(m.paymentMethods ?? [])]);
        },
      },
      {
        name: "payments: a precision that does not match the currency is refused before any request",
        async run() {
          const s = h.setup("approved");
          const before = s.requests.length;
          const r = await adapterFor(h, s).payments!.create(payment("attempt:precision", "2500", 0));
          assert.equal(r.state, "Rejected");
          assert.equal(s.requests.length, before);
        },
      },
      {
        name: "payments: redirect stays on declared hosts and retry returns the same payment",
        async run() {
          const s = h.setup("action-required");
          const p = adapterFor(h, s).payments!;
          const a = await p.create(payment("attempt:retry"));
          const b = await p.create(payment("attempt:retry"));
          assert.equal(a.state, "Requires action");
          assert.equal(a.reference, b.reference);
          assert.ok(a.actionUrl && p.paymentHosts.includes(new URL(a.actionUrl).host));
        },
      },
    );
    for (const [scenario, state] of [
      ["approved", "Confirmed"],
      ["action-required", "Requires action"],
      ["rejected", "Rejected"],
    ] as const)
      if ((h.paymentScenarios ?? h.scenarios).includes(scenario))
        checks.push({
          name: `payments: a ${scenario} payment reads as ${state} with the exact amount`,
          async run() {
            const s = h.setup(scenario);
            const p = adapterFor(h, s).payments!;
            const created = await p.create(payment(`attempt:${scenario}`));
            const status = await p.status({ account, reference: created.reference });
            assert.equal(status?.state, state);
            assert.equal(status?.amount, "25.00");
            assert.equal(status?.currency, "GBP");
          },
        });
  }
  if (h.event)
    checks.push({
      name: "accepts a signed event and rejects a tampered one",
      async run() {
        const s = h.setup("approved");
        const adapter = adapterFor(h, s);
        const good = h.event!(s, "acct_1234567890", false);
        const event = await adapter.verifyEvent(good);
        assert.ok(event && event.eventId.length > 0);
        assert.equal(await adapter.verifyEvent(h.event!(s, "acct_1234567890", true)), null);
        assert.equal(
          await adapter.verifyEvent({ rawBody: good.rawBody, headers: new Headers() }),
          null,
        );
      },
    });
  return checks;
}
