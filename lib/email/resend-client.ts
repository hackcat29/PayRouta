// Resend is PayRouta's mail engine for transactional mail (sign-up, password
// reset, invitations) and marketing mail. Without RESEND_API_KEY, development
// and tests get a logged simulation; production fails closed instead of
// pretending an email went out.
import { Resend } from "resend";

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  headers?: Record<string, string>;
  // Sent as Resend's Idempotency-Key, so a retried request never sends twice.
  idempotencyKey?: string;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
  isMock?: boolean;
}

const DEFAULT_FROM =
  process.env.RESEND_FROM_EMAIL || "PayRouta <updates@payrouta.com>";
const DEFAULT_REPLY_TO = process.env.RESEND_REPLY_TO || "support@payrouta.com";

let resendInstance: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendInstance) resendInstance = new Resend(apiKey);
  return resendInstance;
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

// Simulation is only allowed outside production.
function simulate(label: string, detail: string): SendEmailResult {
  if (process.env.NODE_ENV === "production")
    return { success: false, error: "Resend is not configured (RESEND_API_KEY)" };
  const id = `mock_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  if (process.env.NODE_ENV !== "test")
    console.log(`[Resend simulated] ${detail} | ID: ${id}`);
  return { success: true, id, isMock: true };
}

// Resend tag values allow only ASCII letters, numbers, underscores and dashes.
function cleanTags(tags?: { name: string; value: string }[]) {
  return tags?.map((t) => ({
    name: t.name.replace(/[^\w-]/g, "_").slice(0, 256),
    value: t.value.replace(/[^\w-]/g, "_").slice(0, 256),
  }));
}

function payload(options: SendEmailOptions) {
  return {
    from: options.from || DEFAULT_FROM,
    to: Array.isArray(options.to) ? options.to : [options.to],
    replyTo: options.replyTo || DEFAULT_REPLY_TO,
    subject: options.subject,
    html: options.html,
    text: options.text,
    tags: cleanTags(options.tags),
    headers: options.headers,
  };
}

export async function sendEmail(
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  const client = getResendClient();
  const body = payload(options);
  if (!client)
    return simulate("email", `To: ${body.to.join(", ")} | Subject: "${body.subject}"`);
  try {
    const { data, error } = await client.emails.send(
      body,
      options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : undefined,
    );
    if (error) {
      console.error("[Resend]", error.name, error.message);
      return { success: false, error: error.message };
    }
    return { success: true, id: data?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown email error";
    console.error("[Resend]", message);
    return { success: false, error: message };
  }
}

// Up to 100 emails per call (Resend's batch limit). Result ids are in the same
// order as the input.
export async function sendBatchEmails(
  emails: SendEmailOptions[],
  idempotencyKey?: string,
): Promise<{ success: boolean; ids: string[]; error?: string }> {
  if (emails.length > 100) throw new Error("Resend batches hold at most 100 emails");
  const client = getResendClient();
  if (!client) {
    const results = emails.map((e) => simulate("batch", `To: ${e.to} | Subject: "${e.subject}"`));
    return results.every((r) => r.success)
      ? { success: true, ids: results.map((r) => r.id!) }
      : { success: false, ids: [], error: results[0]?.error };
  }
  try {
    const { data, error } = await client.batch.send(
      emails.map(payload),
      idempotencyKey ? { idempotencyKey } : undefined,
    );
    if (error) return { success: false, ids: [], error: error.message };
    return { success: true, ids: (data?.data || []).map((d) => d.id) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Batch send failed";
    return { success: false, ids: [], error: message };
  }
}

// Resend replaced Audiences with Segments. RESEND_SEGMENT_ID is preferred;
// RESEND_AUDIENCE_ID is still read for older setups.
function segmentId() {
  return process.env.RESEND_SEGMENT_ID || process.env.RESEND_AUDIENCE_ID || undefined;
}

// Create the contact, or update it by email if it already exists, so that an
// unsubscribe made in PayRouta is mirrored in Resend.
export async function syncResendContact(params: {
  email: string;
  firstName?: string;
  lastName?: string;
  unsubscribed?: boolean;
}): Promise<{ success: boolean; contactId?: string; skipped?: boolean }> {
  const client = getResendClient();
  if (!client) return { success: true, skipped: true };
  const segment = segmentId();
  try {
    const created = await client.contacts.create({
      email: params.email,
      firstName: params.firstName,
      lastName: params.lastName,
      unsubscribed: params.unsubscribed ?? false,
      ...(segment ? { segments: [{ id: segment }] } : {}),
    });
    if (!created.error) return { success: true, contactId: created.data?.id };
    const updated = await client.contacts.update({
      email: params.email,
      unsubscribed: params.unsubscribed ?? false,
      ...(params.firstName !== undefined ? { firstName: params.firstName } : {}),
      ...(params.lastName !== undefined ? { lastName: params.lastName } : {}),
    });
    if (updated.error) {
      console.warn("[Resend contacts]", updated.error.message);
      return { success: false };
    }
    return { success: true, contactId: updated.data?.id };
  } catch (err: unknown) {
    console.warn("[Resend contacts]", err instanceof Error ? err.message : err);
    return { success: false };
  }
}

export type ResendWebhookEvent = {
  type: string;
  created_at?: string;
  data: { email_id?: string; to?: string[]; [key: string]: unknown };
};

// Verifies Resend's signed webhook (svix-id, svix-timestamp, svix-signature)
// against RESEND_WEBHOOK_SECRET. Returns undefined when the signature, its
// age or the configuration is wrong; callers must reject the request.
export function verifyResendWebhook(
  payload: string,
  headers: Headers,
): ResendWebhookEvent | undefined {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const client = getResendClient();
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!secret || !client || !id || !timestamp || !signature) return undefined;
  try {
    return client.webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret: secret,
    }) as unknown as ResendWebhookEvent;
  } catch {
    return undefined;
  }
}
