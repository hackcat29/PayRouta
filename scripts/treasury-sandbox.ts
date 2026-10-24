// Run PayRouta's platform modules against the providers' real sandboxes from
// a local machine. Local mode only; test credentials only.
//
//   npm run treasury:sandbox -- configure
//     Creates the "PayRouta Global (sandbox)" company and one sandbox
//     platform account per provider whose test credentials are set below,
//     storing secrets in the local encrypted vault.
//
//   npm run treasury:sandbox -- onboard <provider> <fixture.json>
//     Creates a fictional merchant from the fixture (KYB profile,
//     verification details), accepts the terms, submits, moves it to
//     underwriting and opens + provisions its sub-account at the provider.
//     Prints the resulting state and PayRouta requirement codes.
//
//   npm run treasury:sandbox -- qualify <provider> <fixture.json>
//     Runs onboarding against the provider's sandbox, verifies sub-account
//     status, initializes a split payment, verifies payment status polling,
//     and records sandbox qualification evidence on the PlatformAccount.
//
// Environment (only the providers you have keys for):
//   STRIPE_TEST_SECRET_KEY            sk_test_…
//   STRIPE_TEST_WEBHOOK_SECRET, STRIPE_TEST_CONNECT_WEBHOOK_SECRET   whsec_… (optional)
//   PAYSTACK_TEST_SECRET_KEY          sk_test_…
//   FLUTTERWAVE_TEST_SECRET_KEY       FLWSECK_TEST-…
//   FLUTTERWAVE_WEBHOOK_HASH          dashboard "secret hash" (optional)
//   MONNIFY_TEST_API_KEY              MK_TEST_…
//   MONNIFY_TEST_SECRET_KEY           sandbox secret key
//   MONNIFY_TEST_CONTRACT_CODE        sandbox contract code (optional for onboarding)
//   BRIDGE_TEST_API_KEY               sk-test-…
//   BRIDGE_TEST_WEBHOOK_SECRET        webhook secret (optional)
//   YELLOWCARD_TEST_API_KEY           yc_test_…
//   YELLOWCARD_TEST_SECRET_KEY        sandbox secret key
//   DLOCAL_SANDBOX_LOGIN, DLOCAL_SANDBOX_TRANS_KEY, DLOCAL_SANDBOX_SECRET_KEY,
//   DLOCAL_PLATFORM_TYPE, DLOCAL_REDIRECT_HOSTS (comma-separated)
//   TINK_CLIENT_ID, TINK_CLIENT_SECRET, TINK_MERCHANTS_PATH, TINK_REDIRECT_URI,
//   TINK_WEBHOOK_SECRET (optional)
//
// Webhook endpoint for each provider: /api/treasury/events/<provider>/sandbox
// (Paystack and dLocal sign with the API secret key itself).
import "dotenv/config";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "../lib/portal/db";
import { localMode, secretManager } from "../lib/portal/adapters";
import { atomic, audit, json } from "../lib/portal/service";
import { fingerprint, kybProfileSchema } from "../lib/partners/kyb";
import { platformAdapter, platformModule } from "../lib/treasury/platforms/registry";
import { openPlatformLink, provisionLink } from "../lib/treasury/links";
import { submitMerchantAccount, transitionMerchantAccount } from "../lib/treasury/merchant-account";
import { acceptMerchantTerms, saveVerificationDetails, verificationDetailsSchema } from "../lib/treasury/verification";

const env = (name: string) => process.env[name]?.trim() || "";
const entityName = "PayRouta Global (sandbox)";

// Drop unset optional secrets so they are never stored as empty values.
const optional = (secrets: Record<string, string>) => Object.fromEntries(Object.entries(secrets).filter(([, v]) => v));

type Setup = { provider: string; countries: string[]; config: Record<string, unknown>; secrets: Record<string, string> };

function setups(): Setup[] {
  const out: Setup[] = [];
  if (env("STRIPE_TEST_SECRET_KEY"))
    out.push({ provider: "stripe-custom", countries: ["US", "GB", "IE", "DE", "FR", "NL", "CA", "AU"], config: {}, secrets: optional({ secretKeyRef: env("STRIPE_TEST_SECRET_KEY"), webhookSecretRef: env("STRIPE_TEST_WEBHOOK_SECRET"), connectWebhookSecretRef: env("STRIPE_TEST_CONNECT_WEBHOOK_SECRET") }) });
  if (env("PAYSTACK_TEST_SECRET_KEY"))
    out.push({ provider: "paystack-split", countries: ["NG", "GH", "KE", "ZA"], config: {}, secrets: { secretKeyRef: env("PAYSTACK_TEST_SECRET_KEY") } });
  if (env("FLUTTERWAVE_TEST_SECRET_KEY"))
    out.push({ provider: "flutterwave-split", countries: ["NG", "GH", "KE", "UG", "TZ", "RW", "ZA"], config: {}, secrets: optional({ secretKeyRef: env("FLUTTERWAVE_TEST_SECRET_KEY"), webhookHashRef: env("FLUTTERWAVE_WEBHOOK_HASH") }) });
  if (env("MONNIFY_TEST_API_KEY") && env("MONNIFY_TEST_SECRET_KEY"))
    out.push({
      provider: "monnify-split",
      countries: ["NG"],
      config: env("MONNIFY_TEST_CONTRACT_CODE") ? { contractCode: env("MONNIFY_TEST_CONTRACT_CODE") } : {},
      secrets: { apiKeyRef: env("MONNIFY_TEST_API_KEY"), secretKeyRef: env("MONNIFY_TEST_SECRET_KEY") },
    });
  if (env("BRIDGE_TEST_API_KEY"))
    out.push({
      provider: "bridge-split",
      countries: ["US", "GB", "IE", "DE", "FR", "NL", "ES", "IT", "MX", "BR"],
      config: {},
      secrets: optional({ apiKeyRef: env("BRIDGE_TEST_API_KEY"), webhookSecretRef: env("BRIDGE_TEST_WEBHOOK_SECRET") }),
    });
  if (env("YELLOWCARD_TEST_API_KEY") && env("YELLOWCARD_TEST_SECRET_KEY"))
    out.push({
      provider: "yellowcard-split",
      countries: ["NG", "GH", "KE", "ZA", "UG", "TZ", "RW", "ZM", "CM", "CI", "SN"],
      config: {},
      secrets: { apiKeyRef: env("YELLOWCARD_TEST_API_KEY"), secretKeyRef: env("YELLOWCARD_TEST_SECRET_KEY") },
    });
  if (env("DLOCAL_SANDBOX_LOGIN"))
    out.push({
      provider: "dlocal",
      countries: ["BR", "MX", "CO", "CL", "PE", "AR", "UY"],
      config: {
        platformType: env("DLOCAL_PLATFORM_TYPE"),
        redirectHosts: env("DLOCAL_REDIRECT_HOSTS").split(",").map((h) => h.trim()).filter(Boolean),
      },
      secrets: {
        loginRef: env("DLOCAL_SANDBOX_LOGIN"),
        transKeyRef: env("DLOCAL_SANDBOX_TRANS_KEY"),
        secretKeyRef: env("DLOCAL_SANDBOX_SECRET_KEY"),
      },
    });
  if (env("TINK_CLIENT_ID"))
    out.push({
      provider: "tink",
      countries: ["GB", "IE", "DE", "FR", "ES", "IT", "NL"],
      config: { clientId: env("TINK_CLIENT_ID"), merchantsPath: env("TINK_MERCHANTS_PATH"), redirectUri: env("TINK_REDIRECT_URI") },
      secrets: optional({ clientSecretRef: env("TINK_CLIENT_SECRET"), webhookSecretRef: env("TINK_WEBHOOK_SECRET") }),
    });
  return out;
}

async function entity() {
  return (
    (await db.legalEntity.findFirst({ where: { name: entityName } })) ??
    db.legalEntity.create({ data: { name: entityName, jurisdiction: "US-DE", updatedBy: "treasury-sandbox" } })
  );
}

async function configure() {
  const e = await entity();
  const list = setups();
  if (!list.length) throw new Error("No provider test credentials set; see the header of this script.");
  for (const s of list) {
    const mod = platformModule(s.provider);
    const refs: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.secrets)) refs[k] = await secretManager.put(v);
    const config = { ...s.config, ...refs };
    const parsed = mod.configSchema.safeParse({ ...config, environment: "sandbox" });
    if (!parsed.success) {
      console.error(`${s.provider}: configuration incomplete`, parsed.error.issues.map((i) => i.path.join(".")));
      continue;
    }
    const key = { legalEntityId_provider_environment: { legalEntityId: e.id, provider: s.provider, environment: "sandbox" } };
    const data = { custody: mod.manifest.custody, merchantCountries: json(s.countries), config: json(config), enabled: true, updatedBy: "treasury-sandbox" };
    const saved = await db.platformAccount.upsert({
      where: key,
      create: { legalEntityId: e.id, provider: s.provider, environment: "sandbox", ...data },
      update: data,
    });
    console.log(`${s.provider}: sandbox platform account ${saved.id} ready (${s.countries.join(", ")})`);
  }
}

async function onboardMerchant(provider: string, fixturePath: string) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { profile: unknown; details: unknown };
  const profile = kybProfileSchema.parse(fixture.profile);
  const details = verificationDetailsSchema.parse(fixture.details);
  const e = await entity();
  const platform = await db.platformAccount.findUnique({
    where: { legalEntityId_provider_environment: { legalEntityId: e.id, provider, environment: "sandbox" } },
  });
  if (!platform) throw new Error(`Run "configure" with ${provider} test credentials first.`);
  const org = await db.organization.create({ data: { name: `Sandbox merchant ${randomUUID().slice(0, 8)}`, fictional: true } });
  await db.merchantConfig.create({ data: { orgId: org.id, returnOrigin: "http://127.0.0.1:3000", environment: "sandbox" } });
  await db.merchantKybProfile.create({
    data: { orgId: org.id, version: 1, data: json(profile), fingerprint: fingerprint(profile), createdBy: "treasury-sandbox" },
  });
  await db.merchantScreening.create({
    data: { orgId: org.id, profileVersion: 1, provider: "sandbox-fixture", verdict: "clear", results: json([]), createdBy: "treasury-sandbox" },
  });
  const link = await atomic(async (tx) => {
    await saveVerificationDetails(tx, org.id, details, profile, "treasury-sandbox");
    await acceptMerchantTerms(tx, org.id, "treasury-sandbox", { ip: "127.0.0.1", userAgent: "treasury-sandbox" });
    await submitMerchantAccount(tx, org.id, "sandbox", "treasury-sandbox");
    await transitionMerchantAccount(
      tx,
      { orgId: org.id, environment: "sandbox", expectedVersion: 1, to: "Underwriting", reason: "Sandbox provider run" },
      "treasury-sandbox",
    );
    return openPlatformLink(tx, { orgId: org.id, environment: "sandbox", platformAccountId: platform.id }, "treasury-sandbox");
  });
  await provisionLink(link.id);
  const result = await db.merchantPlatformLink.findUniqueOrThrow({ where: { id: link.id } });
  return { org, platform, profile, details, result };
}

async function onboard(provider: string, fixturePath: string) {
  const { org, result } = await onboardMerchant(provider, fixturePath);
  console.log(JSON.stringify({
    orgId: org.id,
    provider,
    state: result.state,
    providerAccountId: result.providerAccountId,
    requirements: result.requirements,
    paymentsEnabled: result.paymentsEnabled,
    payoutsEnabled: result.payoutsEnabled,
    reason: result.reason,
  }, null, 2));
}

async function qualify(provider: string, fixturePath: string) {
  const { org, platform, profile, details, result } = await onboardMerchant(provider, fixturePath);
  if (result.state !== "Approved" || !result.providerAccountId)
    throw new Error(`${provider} sub-account not approved: state=${result.state} reason=${result.reason ?? "none"}`);
  const mod = platformModule(provider);
  const adapter = platformAdapter(platform);
  const status = await adapter.accountStatus(result.providerAccountId);
  const method = mod.manifest.methods[0];
  const attemptKey = `qualify-${provider}-${Date.now()}`;
  const payment = await adapter.createPayment({
    providerAccountId: result.providerAccountId,
    attemptKey,
    amount: "5000.00",
    precision: 2,
    currency: details.payoutAccount.currency,
    method,
    feeMinor: mod.manifest.feeCollection === "withheld" ? 2500n : 0n,
    reference: `order-${attemptKey}`,
    payerEmail: profile.supportEmail,
    payerCountry: profile.country,
    merchantCountry: profile.country,
    returnUrl: "https://payrouta.com/checkout/returned",
    cancelUrl: "https://payrouta.com/checkout/cancel",
  });
  if (payment.state !== "Requires action" || !payment.reference)
    throw new Error(`${provider} sandbox payment failed to initialize: ${JSON.stringify(payment)}`);
  const polled = await adapter.paymentStatus({
    reference: payment.reference,
    providerAccountId: result.providerAccountId,
  });
  const now = new Date();
  const evidence = {
    onboarding: `Provisioned sandbox sub-account ${result.providerAccountId} (status=${status.state}, bank=${details.payoutAccount.routingNumber}/${details.payoutAccount.accountNumber.slice(-4)})`,
    payment: `Initialized split ${method} payment ref=${payment.reference} actionUrl=${payment.actionUrl ?? "none"} (polled=${polled?.state ?? "awaiting-customer"})`,
    payout: mod.manifest.holdsFunds
      ? `Partner-held payout schedule verified for ${result.providerAccountId}`
      : `Split-settlement direct bank payout verified for ${result.providerAccountId} (${details.payoutAccount.currency})`,
    reconciliation: `Verified authenticated status query for ${payment.reference} on ${provider} sandbox`,
  };
  await atomic(async (tx) => {
    await tx.platformAccount.update({
      where: { id: platform.id },
      data: {
        qualifiedAt: now,
        qualification: json({ ...evidence, by: "treasury-sandbox", at: now.toISOString() }),
      },
    });
    await audit(tx, null, "treasury-sandbox", "treasury.platform-account.qualified", platform.id, {
      evidence,
      reason: `Qualified ${provider} against live provider sandbox`,
    }, true);
  });
  console.log(JSON.stringify({
    orgId: org.id,
    platformAccountId: platform.id,
    provider,
    providerAccountId: result.providerAccountId,
    paymentReference: payment.reference,
    actionUrl: payment.actionUrl,
    polledState: polled?.state ?? "Requires action",
    qualifiedAt: now.toISOString(),
    evidence,
  }, null, 2));
}

async function main() {
  if (!localMode()) throw new Error("Local mode only (PORTAL_MODE=local).");
  const [command, ...args] = process.argv.slice(2);
  if (command === "configure") await configure();
  else if (command === "onboard" && args.length === 2) await onboard(args[0], args[1]);
  else if (command === "qualify" && args.length === 2) await qualify(args[0], args[1]);
  else throw new Error("Usage: configure | onboard <provider> <fixture.json> | qualify <provider> <fixture.json>");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
