import { ZodError } from "zod";
import { PortalError } from "../portal/domain";
export async function rawBody(request: Request) {
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
      if (size > 32768) {
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
export async function respond(work: () => Promise<unknown>) {
  try {
    return Response.json(await work(), {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof PortalError
            ? e.message
            : e instanceof ZodError
              ? "INVALID_REQUEST"
              : "SERVICE_UNAVAILABLE",
      },
      {
        status:
          e instanceof PortalError
            ? e.status
            : e instanceof ZodError
              ? 400
              : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
