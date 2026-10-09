// Production transactional mail over SMTP (any provider: Postmark, SES,
// Resend, Brevo, …). SMTP_URL is smtps://user:pass@host:465 (implicit TLS) or
// smtp://user:pass@host:587 (STARTTLS, required). MAIL_FROM must be a sender
// verified with that provider. Only an SMTP acceptance counts as delivered.
import nodemailer, { type Transporter } from "nodemailer";
import { PortalError } from "./domain";

let cached: { key: string; transport: Transporter } | undefined;

export function smtpConfigured() {
  return !!process.env.SMTP_URL && !!process.env.MAIL_FROM;
}

function transport() {
  const raw = process.env.SMTP_URL;
  if (!raw || !process.env.MAIL_FROM)
    throw new PortalError("Email provider and verified sender are not configured", 503);
  if (cached?.key === raw) return cached.transport;
  const url = new URL(raw);
  if (!["smtp:", "smtps:"].includes(url.protocol))
    throw new PortalError("SMTP_URL must use smtp:// or smtps://", 503);
  const secure = url.protocol === "smtps:";
  const created = nodemailer.createTransport({
    host: url.hostname,
    port: Number(url.port || (secure ? 465 : 587)),
    secure,
    requireTLS: !secure,
    auth: url.username
      ? { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  cached = { key: raw, transport: created };
  return created;
}

export async function sendSmtp(to: string, subject: string, text: string) {
  const info = await transport()
    .sendMail({ from: process.env.MAIL_FROM, to, subject, text })
    .catch(() => {
      throw new PortalError("Email delivery failed; retry later", 503);
    });
  if (!info.accepted?.length || info.rejected?.length)
    throw new PortalError("Email was not accepted by the mail provider", 502);
  return "delivered" as const;
}
