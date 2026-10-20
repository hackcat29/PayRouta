// Switches Resend on for a deployment. Run on the production server, where
// /opt/payrouta/.env holds RESEND_API_KEY, RESEND_FROM_EMAIL and SITE_URL:
//
//   npm run resend:setup                      check sender domain and webhook
//   npm run resend:setup -- --create-webhook  also create the webhook if missing
//   npm run resend:setup -- --send-test you@example.com
//
// Creating the webhook prints its signing secret once, or with
// --write-env <file> appends it to that file without printing it. Put it in .env as
// RESEND_WEBHOOK_SECRET and reload the app (pm2 reload payrouta --update-env).
import "dotenv/config";
import { appendFileSync } from "node:fs";
import { Resend } from "resend";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const valueOf = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const events = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
  "email.failed",
  "contact.updated",
  "contact.deleted",
] as const;

let failed = false;
const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string) => {
  failed = true;
  console.log(`  MISSING ${m}`);
};

async function main() {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || "";
  const site = process.env.SITE_URL || "";
  if (!key) {
    console.log("RESEND_API_KEY is not set in this environment.");
    process.exit(1);
  }
  const resend = new Resend(key);

  console.log("Sender");
  const domain = from.match(/@([^>\s]+)>?\s*$/)?.[1]?.toLowerCase();
  if (!domain)
    bad(
      `RESEND_FROM_EMAIL ("${from}") has no address, e.g. PayRouta <updates@payrouta.com>`,
    );
  else {
    const list = await resend.domains.list();
    if (list.error) throw new Error(`Resend: ${list.error.message}`);
    const found = list.data?.data.find(
      (d) => d.name === domain || domain.endsWith(`.${d.name}`),
    );
    if (!found) bad(`${domain} is not added in Resend (Domains → Add domain)`);
    else {
      const detail = await resend.domains.get(found.id);
      if (found.status === "verified") ok(`${found.name} is verified`);
      else {
        bad(
          `${found.name} is ${found.status}. Add these DNS records, then press Verify in Resend:`,
        );
        for (const r of detail.data?.records ?? [])
          console.log(
            `          ${r.type.padEnd(5)} ${r.name}  →  ${r.value}  (${r.status})`,
          );
      }
    }
  }

  console.log("Webhook");
  let endpoint: string | undefined;
  try {
    const url = new URL("/api/webhooks/resend", site);
    if (url.protocol !== "https:") throw new Error();
    endpoint = url.href;
  } catch {
    bad("SITE_URL must be the public https:// origin");
  }
  if (endpoint) {
    const hooks = await resend.webhooks.list();
    if (hooks.error) throw new Error(`Resend: ${hooks.error.message}`);
    const existing = hooks.data?.data.find((h) => h.endpoint === endpoint);
    if (existing) ok(`${endpoint} (${existing.status})`);
    else if (flag("--create-webhook")) {
      const created = await resend.webhooks.create({
        endpoint,
        events: [...events],
      });
      if (created.error) throw new Error(`Resend: ${created.error.message}`);
      ok(`created ${endpoint}`);
      const secret = created.data!.signing_secret;
      const envFile = valueOf("--write-env");
      if (envFile) {
        // Written straight to the env file so the secret never hits a terminal or log.
        appendFileSync(envFile, `\nRESEND_WEBHOOK_SECRET=${secret}\n`, { mode: 0o600 });
        process.env.RESEND_WEBHOOK_SECRET = secret;
        ok(`signing secret saved to ${envFile}; reload the app to use it`);
      } else
        console.log(
          `\n  Add this line to .env, then reload the app:\n  RESEND_WEBHOOK_SECRET=${secret}\n`,
        );
    } else bad(`no webhook for ${endpoint}; rerun with --create-webhook`);
    if (!process.env.RESEND_WEBHOOK_SECRET)
      bad("RESEND_WEBHOOK_SECRET is not set");
    else ok("RESEND_WEBHOOK_SECRET is set");
  }

  const to = valueOf("--send-test");
  if (to) {
    console.log("Test email");
    const sent = await resend.emails.send({
      from,
      to: [to],
      replyTo: process.env.RESEND_REPLY_TO || undefined,
      subject: "PayRouta email is working",
      text: `This test was sent from ${site || "PayRouta"} through Resend.`,
    });
    if (sent.error) bad(`send failed: ${sent.error.message}`);
    else ok(`sent to ${to} (id ${sent.data?.id})`);
  }

  console.log(
    failed
      ? "\nNot ready yet: fix the items marked MISSING."
      : "\nResend is ready.",
  );
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
