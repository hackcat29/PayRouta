import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { PortalError } from "./domain";
import { databaseSecretStore } from "./secret-store";
import { sendSmtp, smtpConfigured } from "./mail-smtp";
import { clamdConfigured, scanWithClamd } from "./scanner-clamd";
export function localMode() {
  return (
    process.env.PORTAL_MODE === "local" &&
    new URL(process.env.BETTER_AUTH_URL || "http://invalid").hostname ===
      "127.0.0.1"
  );
}
// The simulator may serve the sandbox environment locally, or on a deployment
// that explicitly enables a hosted sandbox. Development-only conveniences
// (fixed demo codes, the mail viewer, the loopback receiver) still require
// localMode() itself.
export function sandboxSimulation() {
  return localMode() || process.env.HOSTED_SANDBOX === "enabled";
}
const root = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.LOCAL_DATA_DIR || ".local/portal",
  );
import { isResendConfigured, sendEmail } from "@/lib/email/resend-client";

// Account mail (verification, password reset, invitations). Production sends
// through Resend, with SMTP as a fallback only when SMTP_URL is configured.
// Local mode captures messages to disk for the /provider/dev-mail viewer.
export interface MailMessage {
  subject: string;
  text: string;
  html?: string;
  // A tag for Resend analytics, e.g. "verify_email".
  tag?: string;
  // Stops a retried request from sending the same email twice.
  idempotencyKey?: string;
}
export interface MailAdapter {
  send(to: string, message: MailMessage): Promise<"captured" | "delivered">;
}
export const mail: MailAdapter = {
  async send(to, message) {
    if (!localMode()) {
      if (isResendConfigured()) {
        const res = await sendEmail({
          to,
          subject: message.subject,
          text: message.text,
          html: message.html ?? `<p>${message.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`,
          tags: message.tag ? [{ name: "type", value: message.tag }] : undefined,
          idempotencyKey: message.idempotencyKey,
        });
        if (res.success && !res.isMock) return "delivered";
        if (!smtpConfigured())
          throw new PortalError("We couldn't send the email. Try again in a few minutes.", 503);
      }
      return sendSmtp(to, message.subject, message.text);
    }
    const dir = path.join(root(), "mail");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(dir, `${Date.now()}-${randomUUID()}.json`),
      JSON.stringify({ to, subject: message.subject, text: message.text, at: new Date().toISOString() }),
      { mode: 0o600 },
    );
    return "captured";
  },
};
export interface SecretManager {
  backend: string;
  put(value: string): Promise<string>;
  get(ref: string): Promise<string>;
  revoke(ref: string): Promise<void>;
}
async function vaultKey() {
  if (!localMode())
    throw new PortalError("Managed secret service is not configured", 503);
  const file = process.env.LOCAL_VAULT_KEY_FILE;
  if (!file || path.resolve(file).startsWith(process.cwd() + path.sep))
    throw new PortalError(
      "Local vault key must be outside the repository",
      503,
    );
  const key = await readFile(file).catch(() => {
    throw new PortalError(
      "Local vault key is unavailable. Restore its backup or reconfigure development credentials.",
      503,
    );
  });
  if (key.length !== 32) throw new PortalError("Invalid local vault key", 503);
  return key;
}
const localVault: SecretManager = {
  backend: "local-encrypted",
  async put(value) {
    const key = await vaultKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const ref = randomUUID();
    const dir = path.join(root(), "vault");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      path.join(dir, ref),
      Buffer.concat([iv, cipher.getAuthTag(), data]),
      { mode: 0o600 },
    );
    return ref;
  },
  async get(ref) {
    if (!/^[a-f0-9-]{36}$/.test(ref))
      throw new PortalError("Invalid secret reference");
    const key = await vaultKey();
    const data = await readFile(path.join(root(), "vault", ref));
    const decipher = createDecipheriv("aes-256-gcm", key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString();
  },
  async revoke(ref) {
    if (!/^[a-f0-9-]{36}$/.test(ref))
      throw new PortalError("Invalid secret reference");
    await unlink(path.join(root(), "vault", ref)).catch(() => {});
  },
};
// Local mode keeps the development file vault; every other mode uses the
// database envelope store, which fails closed without master keys.
function activeSecretStore(): SecretManager {
  return localMode() ? localVault : databaseSecretStore;
}
export const secretManager: SecretManager = {
  get backend() {
    return activeSecretStore().backend;
  },
  put: (value) => activeSecretStore().put(value),
  get: (ref) => activeSecretStore().get(ref),
  revoke: (ref) => activeSecretStore().revoke(ref),
};
export interface PrivateStorage {
  put(key: string, bytes: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
function validKey(key: string) {
  if (!/^[a-f0-9-]{36}$/.test(key)) throw new PortalError("Invalid object key");
  return key;
}
// Cloudflare R2 (https://<account>.r2.cloudflarestorage.com) speaks the S3
// API with region "auto" and always encrypts at rest, so the AWS
// server-side-encryption header isn't sent there.
export function isR2(endpoint = process.env.S3_ENDPOINT) {
  try {
    return !!endpoint && new URL(endpoint).hostname.endsWith(".r2.cloudflarestorage.com");
  } catch {
    return false;
  }
}
// The endpoint is the store's origin. Dashboards often show it with the
// bucket appended (".../payrouta"); the bucket comes from S3_BUCKET, so any
// path is dropped rather than doubled.
export function s3Endpoint(endpoint = process.env.S3_ENDPOINT) {
  if (!endpoint) return undefined;
  try {
    return new URL(endpoint).origin;
  } catch {
    throw new PortalError("S3_ENDPOINT must be a URL", 503);
  }
}
function s3() {
  if (!process.env.S3_BUCKET)
    throw new PortalError("Private object storage is not configured", 503);
  const endpoint = s3Endpoint();
  return new S3Client({
    region: process.env.S3_REGION || (isR2() ? "auto" : "us-east-1"),
    endpoint,
    forcePathStyle: !!endpoint,
  });
}
export const storage: PrivateStorage = {
  async put(key, bytes, mime) {
    validKey(key);
    if (localMode()) {
      const dir = path.join(root(), "documents");
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(path.join(dir, key), bytes, { mode: 0o600 });
    } else
      await s3().send(
        new PutObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: mime,
          ...(isR2() ? {} : { ServerSideEncryption: "AES256" as const }),
        }),
      );
  },
  async get(key) {
    validKey(key);
    if (localMode()) return readFile(path.join(root(), "documents", key));
    const object = await s3().send(
      new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
    );
    return Buffer.from(await object.Body!.transformToByteArray());
  },
  async delete(key) {
    validKey(key);
    if (localMode())
      await unlink(path.join(root(), "documents", key)).catch(() => {});
    else
      await s3().send(
        new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
      );
  },
};
export interface DocumentScanner {
  scan(key: string): Promise<"Clean" | "Malicious" | "Pending scan">;
}
// Uses clamd when CLAMD_HOST is configured; otherwise fails closed and never
// labels an upload safe. A scanner error leaves the document quarantined.
export const scanner: DocumentScanner = {
  async scan(key) {
    if (!clamdConfigured()) return "Pending scan";
    try {
      return await scanWithClamd(await storage.get(key));
    } catch {
      return "Pending scan";
    }
  },
};
export function fileSignature(bytes: Buffer, mime: string) {
  return (
    (mime === "application/pdf" &&
      bytes.subarray(0, 5).toString() === "%PDF-") ||
    (mime === "image/png" &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    (mime === "image/jpeg" &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255)
  );
}
