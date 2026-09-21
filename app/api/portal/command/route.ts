import { randomUUID } from "node:crypto";
import { command } from "@/lib/portal/service";
import { csrf } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import { ZodError } from "zod";
export async function POST(request: Request) {
  try {
    csrf(request);
    const body = await limitedJson(request);
    const result = await command(body, request.headers);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PortalError)
      return Response.json(
        {
          error: error.message,
          code:
            /^[A-Z][A-Z0-9_]+(?=:|$)/.exec(error.message)?.[0] ||
            "PORTAL_ERROR",
        },
        { status: error.status },
      );
    if (error instanceof ZodError)
      return Response.json(
        {
          fields: error.issues.map((i) => ({
            path: i.path.join("."),
            code: /^[A-Z][A-Z0-9_]+(?=:|$)/.exec(i.message)?.[0] || i.code,
            message: i.message,
          })),
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        { status: 400 },
      );
    const correlationId = randomUUID();
    console.error(
      JSON.stringify({ event: "portal.command.failed", correlationId }),
    );
    return Response.json(
      {
        error: "Service temporarily unavailable. Try again.",
        code: "INFRASTRUCTURE_UNAVAILABLE",
        correlationId,
      },
      { status: 503 },
    );
  }
}
async function limitedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new PortalError("Missing request body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const timeout = setTimeout(() => reader.cancel(), 8000);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536) {
        await reader.cancel();
        throw new PortalError("Request too large", 413);
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      throw new PortalError("Invalid JSON request", 400);
    }
  } finally {
    clearTimeout(timeout);
  }
}
