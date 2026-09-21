import { enquirySchema } from "../../lib/enquiries/schema";
import { deliver } from "../../lib/enquiries/delivery";

interface Env {
  CONTACT_WEBHOOK_URL?: string;
  CONTACT_WEBHOOK_TOKEN?: string;
}

interface EventContext<Env, P extends string, Data> {
  request: Request;
  functionPath: string;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  env: Env;
  params: Record<P, string | string[]>;
  data: Data;
}

const MAX_BYTES = 16000;

export async function onRequestPost(
  context: EventContext<Env, string, Record<string, unknown>>,
): Promise<Response> {
  const { request, env } = context;
  const json = (body: object, status: number) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });

  if (
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  ) {
    return json({ ok: false, message: "Use a JSON request." }, 415);
  }

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES) {
    return json({ ok: false, message: "Enquiry is too large." }, 413);
  }

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ ok: false, message: "Request origin is not allowed." }, 403);
  }

  let raw: unknown;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) {
      return json({ ok: false, message: "Enquiry is too large." }, 413);
    }
    raw = JSON.parse(text);
  } catch {
    return json(
      {
        ok: false,
        message: "Unable to read the enquiry. Please try again.",
      },
      400,
    );
  }

  const parsed = enquirySchema.safeParse(raw);
  if (!parsed.success) {
    return json(
      {
        ok: false,
        message: "Please check the highlighted fields.",
        errors: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const result = await deliver(parsed.data, {
    url: env.CONTACT_WEBHOOK_URL,
    token: env.CONTACT_WEBHOOK_TOKEN,
  });

  return json({ ok: result.ok, message: result.message }, result.status);
}
