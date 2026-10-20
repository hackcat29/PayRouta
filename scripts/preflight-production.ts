// Production readiness check. Prints what is configured and what is missing
// without revealing values; exits 1 if a blocking item is missing.
// Run on the server after deploy: npm run preflight:production
import "dotenv/config";
import { db } from "../lib/portal/db";
import { configuredSchedules } from "../lib/payments/pricing";
import { parseKeyring } from "../lib/portal/secret-store";

type Check = { name: string; ok: boolean; blocking: boolean; note: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, blocking: boolean, note: string) =>
  checks.push({ name, ok, blocking, note });

function https(value?: string) {
  try {
    return new URL(value ?? "").protocol === "https:";
  } catch {
    return false;
  }
}

async function main() {
  const env = process.env;
  add(
    "PORTAL_MODE=production",
    env.PORTAL_MODE === "production",
    true,
    "Never run local mode on a public host",
  );
  add(
    "BETTER_AUTH_URL is HTTPS",
    https(env.BETTER_AUTH_URL),
    true,
    "Public HTTPS origin of the app",
  );
  add(
    "BETTER_AUTH_SECRET strong",
    (env.BETTER_AUTH_SECRET?.length ?? 0) >= 32,
    true,
    "32+ random characters",
  );
  add(
    "SITE_URL is HTTPS",
    https(env.SITE_URL),
    false,
    "Blank keeps the site noindex",
  );
  let keyring = false;
  try {
    keyring = !!parseKeyring();
  } catch {}
  add(
    "SECRET_MASTER_KEYS",
    keyring,
    true,
    "Secret store master keys (32-byte base64), kept outside the database",
  );
  add(
    "RESEND_API_KEY",
    !!env.RESEND_API_KEY,
    true,
    "All email: verification, reset, invitations, marketing (npm run resend:setup)",
  );
  add(
    "RESEND_FROM_EMAIL",
    /@[^>\s]+>?\s*$/.test(env.RESEND_FROM_EMAIL ?? ""),
    true,
    "Sender on a domain verified in Resend",
  );
  add(
    "RESEND_WEBHOOK_SECRET",
    !!env.RESEND_WEBHOOK_SECRET,
    false,
    "Bounce and complaint handling; create with npm run resend:setup -- --create-webhook",
  );
  add("S3_BUCKET", !!env.S3_BUCKET, true, "Private evidence storage");
  add(
    "CLAMD_HOST",
    !!env.CLAMD_HOST,
    true,
    "Malware scanning; without it evidence stays quarantined",
  );
  add(
    "GOOGLE_CLIENT_ID",
    !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
    false,
    "Optional: shows Continue with Google on sign-in",
  );
  add(
    "Merchant screening",
    true,
    false,
    "Manual: no automated sanctions vendor; ops decide each business in /ops (valid 30 days)",
  );
  add(
    "CONTACT_WEBHOOK_URL",
    https(env.CONTACT_WEBHOOK_URL),
    false,
    "Website enquiries",
  );
  add(
    "HOSTED_SANDBOX",
    env.HOSTED_SANDBOX === "enabled",
    false,
    "Lets merchants test in the sandbox on this deployment",
  );
  let pricing = false;
  try {
    configuredSchedules();
    pricing = true;
  } catch {}
  add(
    "Platform fee configuration valid",
    pricing,
    true,
    "Invalid schedules block new paid intents; USD defaults only, other assets require agreed schedules",
  );
  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {}
  add("Database reachable", database, true, "DATABASE_URL");
  if (database) {
    const schedules = pricing ? configuredSchedules() : [];
    const merchants = await db.merchantConfig.findMany({
      where: { environment: "production" },
    });
    const missingPricing = merchants.filter((m) => {
      const scope = m.liveScope as {
        status?: string;
        input?: { asset?: string };
      };
      if (scope?.status !== "Approved") return false;
      const key = scope.input?.asset;
      const schedule =
        schedules.find((s) => s.asset === key && s.orgId === m.orgId) ??
        schedules.find((s) => s.asset === key && !s.orgId);
      if (!schedule) return key !== "fiat:USD:";
      return (
        !!schedule.validUntil &&
        new Date(schedule.validUntil).getTime() < Date.now() + 30 * 60000
      );
    });
    add(
      "Approved live scopes have fee schedules",
      pricing && missingPricing.length === 0,
      true,
      `${missingPricing.length} approved scope(s) missing current explicit pricing; agree and configure every currency`,
    );
    const connections = await db.partnerConnection.findMany();
    const qualified = connections.filter(
      (c) => c.environment === "sandbox" && c.qualifiedAt,
    );
    const live = connections.filter(
      (c) => c.environment === "production" && c.enabled,
    );
    add(
      "Partner sandbox qualification",
      qualified.length > 0,
      false,
      `${qualified.length} partner(s) qualified in their provider sandbox`,
    );
    add(
      "Production partner connections",
      live.length > 0,
      false,
      `${live.length} enabled; live payments need at least one`,
    );
    const stuck = await db.job.count({ where: { state: "Failed" } });
    add(
      "No failed worker jobs",
      stuck === 0,
      false,
      `${stuck} failed job(s); inspect before launch`,
    );
  }
  for (const c of checks)
    console.log(
      `${c.ok ? "✓" : c.blocking ? "✗" : "!"} ${c.name}${c.ok ? "" : ` — ${c.note}`}`,
    );
  const blocked = checks.filter((c) => !c.ok && c.blocking);
  const warnOnly =
    process.argv.includes("--warn") ||
    process.argv.includes("--allow-warnings");
  console.log(
    blocked.length
      ? `\n${blocked.length} blocking item(s) missing.${warnOnly ? " (non-fatal under --warn)" : ""}`
      : "\nNo blocking items missing.",
  );
  await db.$disconnect();
  process.exit(blocked.length && !warnOnly ? 1 : 0);
}
void main();
