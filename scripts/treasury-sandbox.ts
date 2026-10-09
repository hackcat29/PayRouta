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
// Environment (only the providers you have keys for):
//   STRIPE_TEST_SECRET_KEY            sk_test_…
//   STRIPE_TEST_WEBHOOK_SECRET, STRIPE_TEST_CONNECT_WEBHOOK_SECRET   whsec_… (optional)
//   PAYSTACK_TEST_SECRET_KEY          sk_test_…
//   FLUTTERWAVE_TEST_SECRET_KEY       FLWSECK_TEST-…
//   FLUTTERWAVE_WEBHOOK_HASH          dashboard "secret hash" (optional)
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
import { atomic, json } from "../lib/portal/service";
import { fingerprint, kybProfileSchema } from "../lib/partners/kyb";
import { platformModule } from "../lib/treasury/platforms/registry";
import { openPlatformLink, provisionLink } from "../lib/treasury/links";
import { submitMerchantAccount, transitionMerchantAccount } from "../lib/treasury/merchant-account";
import { acceptMerchantTerms, saveVerificationDetails } from "../lib/treasury/verification";

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

async function onboard(provider: string, fixturePath: string) {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { profile: unknown; details: unknown };
  const profile = kybProfileSchema.parse(fixture.profile);
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
    await saveVerificationDetails(tx, org.id, fixture.details, profile, "treasury-sandbox");
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

async function main() {
  if (!localMode()) throw new Error("Local mode only (PORTAL_MODE=local).");
  const [command, ...args] = process.argv.slice(2);
  if (command === "configure") await configure();
  else if (command === "onboard" && args.length === 2) await onboard(args[0], args[1]);
  else throw new Error("Usage: configure | onboard <provider> <fixture.json>");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
