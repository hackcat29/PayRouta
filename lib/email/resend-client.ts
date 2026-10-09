import { Resend } from "resend";

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tags?: { name: string; value: string }[];
  headers?: Record<string, string>;
  campaignId?: string;
}

export interface SendEmailResult {
  success: boolean;
  id?: string;
  error?: string;
  isMock?: boolean;
}

const DEFAULT_FROM =
  process.env.RESEND_FROM_EMAIL || "PayRouta <updates@payrouta.com>";
const DEFAULT_REPLY_TO =
  process.env.RESEND_REPLY_TO || "support@payrouta.com";

let resendInstance: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }
  if (!resendInstance) {
    resendInstance = new Resend(apiKey);
  }
  return resendInstance;
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export function getAudienceId(): string | undefined {
  return process.env.RESEND_AUDIENCE_ID;
}

/**
 * Send a single email through Resend, falling back cleanly to mock/local logging
 * if RESEND_API_KEY is not configured (e.g. in development/test).
 */
export async function sendEmail(
  options: SendEmailOptions,
): Promise<SendEmailResult> {
  const client = getResendClient();
  const from = options.from || DEFAULT_FROM;
  const replyTo = options.replyTo || DEFAULT_REPLY_TO;
  const to = Array.isArray(options.to) ? options.to : [options.to];

  if (!client) {
    // Graceful local development simulation
    const mockId = `mock_resend_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[Resend MOCK] To: ${to.join(", ")} | Subject: "${options.subject}" | From: ${from} | ID: ${mockId}`,
      );
    }
    return {
      success: true,
      id: mockId,
      isMock: true,
    };
  }

  try {
    const { data, error } = await client.emails.send({
      from,
      to,
      replyTo,
      subject: options.subject,
      html: options.html,
      text: options.text,
      tags: options.tags,
      headers: options.headers,
    });

    if (error) {
      console.error("[Resend Error]", error);
      return {
        success: false,
        error: error.message,
      };
    }

    return {
      success: true,
      id: data?.id,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown email error";
    console.error("[Resend Exception]", message);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Send batch emails through Resend Batch API
 */
export async function sendBatchEmails(
  emails: SendEmailOptions[],
): Promise<{ success: boolean; ids: string[]; error?: string }> {
  const client = getResendClient();
  if (!client) {
    const mockIds = emails.map(
      (_, i) => `mock_batch_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
    );
    return { success: true, ids: mockIds };
  }

  try {
    const payload = emails.map((opt) => ({
      from: opt.from || DEFAULT_FROM,
      to: Array.isArray(opt.to) ? opt.to : [opt.to],
      replyTo: opt.replyTo || DEFAULT_REPLY_TO,
      subject: opt.subject,
      html: opt.html,
      text: opt.text,
      tags: opt.tags,
      headers: opt.headers,
    }));

    const { data, error } = await client.batch.send(payload);
    if (error) {
      return { success: false, ids: [], error: error.message };
    }

    return {
      success: true,
      ids: (data?.data || []).map((d) => d.id),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Batch send failed";
    return { success: false, ids: [], error: message };
  }
}

/**
 * Add or update contact in Resend Audience
 */
export async function syncResendAudienceContact(params: {
  email: string;
  firstName?: string;
  lastName?: string;
  unsubscribed?: boolean;
  audienceId?: string;
}): Promise<{ success: boolean; contactId?: string }> {
  const client = getResendClient();
  const audienceId = params.audienceId || getAudienceId();

  if (!client || !audienceId) {
    return {
      success: true,
      contactId: `mock_contact_${Math.random().toString(36).substring(2, 9)}`,
    };
  }

  try {
    const { data, error } = await client.contacts.create({
      audienceId,
      email: params.email,
      firstName: params.firstName,
      lastName: params.lastName,
      unsubscribed: params.unsubscribed || false,
    });

    if (error) {
      // If contact already exists, try update
      console.warn("[Resend Contacts]", error.message);
      return { success: false };
    }

    return { success: true, contactId: data?.id };
  } catch (err: unknown) {
    console.error("[Resend Contact Sync Exception]", err);
    return { success: false };
  }
}
