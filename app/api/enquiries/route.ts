import { enquirySchema } from "@/lib/enquiries/schema";
import { deliver } from "@/lib/enquiries/delivery";
import { verifyTurnstile } from "@/lib/turnstile";
import { publicOrigin } from "@/lib/portal/access";
export const runtime = "nodejs";
const MAX_BYTES = 16000;
async function boundedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("empty");
  let size = 0;
  const chunks: Uint8Array[] = [];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, 5000);
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (timedOut) throw new Error("timeout");
        completed = true;
        break;
      }
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("size");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(body));
  } finally {
    clearTimeout(timer);
    if (!completed) void reader.cancel();
  }
}
export async function POST(request: Request) {
  const json = (body: object, status: number) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    return json({ ok: false, message: "Use a JSON request." }, 415);
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES)
    return json({ ok: false, message: "Enquiry is too large." }, 413);
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin(request))
    return json({ ok: false, message: "Request origin is not allowed." }, 403);
  if (!(await verifyTurnstile(request)))
    return json(
      { ok: false, message: "We couldn't confirm you're not a bot. Reload the page and try again." },
      403,
    );
  let raw: unknown;
  try {
    raw = await boundedBody(request);
  } catch (e) {
    return json(
      {
        ok: false,
        message:
          e instanceof Error && e.message === "size"
            ? "Enquiry is too large."
            : "Unable to read the enquiry. Please try again.",
      },
      e instanceof Error && e.message === "size" ? 413 : 400,
    );
  }
  const parsed = enquirySchema.safeParse(raw);
  if (!parsed.success)
    return json(
      {
        ok: false,
        message: "Please check the highlighted fields.",
        errors: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  const result = await deliver(parsed.data, {
    url: process.env.CONTACT_WEBHOOK_URL,
    token: process.env.CONTACT_WEBHOOK_TOKEN,
  });
  return json({ ok: result.ok, message: result.message }, result.status);
}
