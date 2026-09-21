import { z } from "zod";
import { merchantMember } from "@/lib/merchant/access";
import { environment } from "@/lib/merchant/contracts";
import { csvCell } from "@/lib/merchant/csv";
import { db } from "@/lib/portal/db";
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
    const rows = await db.paymentIntent.findMany({
      where: {
        orgId: query.orgId,
        environment: query.environment,
        createdAt: { gte: from, lt: to },
      },
      select: {
        id: true,
        reference: true,
        amount: true,
        asset: true,
        state: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 1001,
    });
    if (rows.length > 1000)
      throw new PortalError("EXPORT_TOO_LARGE_NARROW_DATE_RANGE", 413);
    const csv = [
      ["id", "reference", "amount", "asset", "state", "created_at"],
      ...rows.map((r) => [
        r.id,
        r.reference,
        r.amount,
        (r.asset as { identifier: string }).identifier,
        r.state,
        r.createdAt.toISOString(),
      ]),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n");
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
