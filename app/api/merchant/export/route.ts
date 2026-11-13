import { z } from "zod";
import { merchantMember } from "@/lib/merchant/access";
import { environment } from "@/lib/merchant/contracts";
import { paymentsCsv } from "@/lib/merchant/payments-export";
import { rateLimit } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
export async function GET(request: Request) {
  try {
    const query = z
      .object({
        orgId: z.string().min(1),
        environment,
        from: z.iso.datetime(),
        to: z.iso.datetime(),
      })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const { session, config } = await merchantMember(
      query.orgId,
      "read",
      request.headers,
    );
    if (config.environment !== query.environment)
      throw new PortalError("ENVIRONMENT_NOT_CONFIGURED", 403);
    const from = new Date(query.from),
      to = new Date(query.to);
    if (to <= from || to.getTime() - from.getTime() > 31 * 86400000)
      throw new PortalError("EXPORT_WINDOW_TOO_LARGE");
    await rateLimit(`merchant-export:${session.user.id}`, 5);
    const csv = await paymentsCsv({ orgId: query.orgId, environment: query.environment }, from, to);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="payrouta-payments.csv"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PortalError
            ? error.message
            : "INVALID_OR_UNAVAILABLE_EXPORT",
      },
      {
        status:
          error instanceof PortalError
            ? error.status
            : error instanceof z.ZodError
              ? 400
              : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
