import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { PortalError } from "../portal/domain";
export async function rawBody(request: Request, limit = 32768) {
  const reader = request.body?.getReader();
  if (!reader) throw new PortalError("MISSING_BODY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, 8000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new PortalError("BODY_TOO_LARGE", 413);
      }
      chunks.push(value);
    }
    if (timedOut) throw new PortalError("REQUEST_TIMEOUT", 408);
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}
// What a failed request tells the browser. Error codes, and sentences written
// for people (4xx), pass through. Anything else, a crash or a 5xx whose text
// describes our own configuration, is logged with a short reference and the
// browser gets SERVICE_UNAVAILABLE plus that reference to quote to support.
export function failure(e: unknown): { body: { error: string; reference?: string; fields?: string[] }; status: number } {
  if (e instanceof ZodError)
    return {
      body: { error: "INVALID_REQUEST", fields: [...new Set(e.issues.map((i) => i.path.join(".")).filter(Boolean))] },
      status: 400,
    };
  if (e instanceof PortalError && (e.status < 500 || /^[A-Z][A-Z0-9_]*(:[\w.-]+)?$/.test(e.message)))
    return { body: { error: e.message }, status: e.status };
  const reference = randomUUID().slice(0, 8);
  console.error(`[error ${reference}]`, e);
  return { body: { error: "SERVICE_UNAVAILABLE", reference }, status: e instanceof PortalError ? e.status : 503 };
}

export async function respond(work: () => Promise<unknown>) {
  try {
    return Response.json(await work(), {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    const { body, status } = failure(e);
    return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  }
}
