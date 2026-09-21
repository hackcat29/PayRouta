import { z } from "zod";
import { csrf, rateLimit } from "@/lib/portal/access";
import {
  authorizeSession,
  progress,
  methods,
  selectMethod,
  confirm,
  customerAction,
} from "@/lib/payments/service";
import { respond, rawBody } from "@/lib/payments/http";
import { NextRequest, NextResponse } from "next/server";
const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("exchange"),
      token: z.string().min(40).max(60),
    })
    .strict(),
  z.object({ action: z.literal("methods") }).strict(),
  z
    .object({ action: z.literal("select"), method: z.string().max(40) })
    .strict(),
  z
    .object({ action: z.literal("confirm"), routeId: z.string().max(100) })
    .strict(),
  z.object({ action: z.literal("complete") }).strict(),
]);
export async function GET(
  r: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return respond(async () => {
    const { id } = await params;
    await rateLimit(`checkout:${id}`, 120);
    return progress(id, r.cookies.get(`checkout_${id}`)?.value || "");
  });
}
export async function POST(
  r: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let credential: string | undefined;
  const response = await respond(async () => {
    csrf(r);
    await rateLimit(`checkout:${id}`, 120);
    const b = schema.parse(JSON.parse(await rawBody(r)));
    if (b.action === "exchange") {
      await authorizeSession(id, b.token);
      credential = b.token;
      return { ok: true };
    }
    const token = r.cookies.get(`checkout_${id}`)?.value || "";
    if (b.action === "methods") return methods(id, token);
    if (b.action === "select") return selectMethod(id, token, b.method);
    if (b.action === "confirm") return confirm(id, token, b.routeId);
    await customerAction(id, token);
    return { ok: true };
  });
  if (credential) {
    const result = new NextResponse(response.body, {
      status: response.status,
      headers: response.headers,
    });
    result.cookies.set(`checkout_${id}`, credential, {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(r.url).protocol === "https:",
      path: `/api/checkout/${id}`,
      maxAge: 1800,
    });
    return result;
  }
  return response;
}
