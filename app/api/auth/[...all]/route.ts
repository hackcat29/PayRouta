import { auth } from "@/lib/portal/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { validateRuntime } from "@/lib/portal/config";
import { PortalError } from "@/lib/portal/domain";
const handlers = toNextJsHandler(auth);
async function handle(request: Request, method: "GET" | "POST") {
  try {
    validateRuntime();
    return await handlers[method](request);
  } catch (error) {
    if (error instanceof PortalError)
      return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
export const GET = (request: Request) => handle(request, "GET");
export const POST = (request: Request) => handle(request, "POST");
