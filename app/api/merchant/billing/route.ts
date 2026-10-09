import { z } from "zod";
import { merchantMember } from "@/lib/merchant/access";
import { environment } from "@/lib/merchant/contracts";
import { csvCell } from "@/lib/merchant/csv";
import { db } from "@/lib/portal/db";
import { rateLimit } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import { billingWindow } from "@/lib/payments/billing";
import { formatFee } from "@/lib/payments/pricing";
export async function GET(request: Request) {
  try {
    const q = z
      .object({ orgId: z.string().min(1), environment, month: z.string() })
      .strict()
      .parse(Object.fromEntries(new URL(request.url).searchParams));
    const { session, config } = await merchantMember(
      q.orgId,
      "read",
      request.headers,
    );
    if (config.environment !== q.environment)
      throw new PortalError("ENVIRONMENT_NOT_CONFIGURED", 403);
    await rateLimit(`merchant-billing-export:${session.user.id}`, 5);
    const { from, to } = billingWindow(q.month);
    const rows = await db.paymentFee.findMany({
      where: {
        orgId: q.orgId,
        environment: q.environment,
        effectiveAt: { gte: from, lt: to },
      },
      orderBy: [{ effectiveAt: "asc" }, { intentId: "asc" }],
      take: 10001,
    });
    if (rows.length > 10000)
      throw new PortalError("BILLING_EXPORT_TOO_LARGE", 413);
    const csv = [
      [
        "payment_id",
        "method",
        "currency",
        "fee",
        "fee_minor",
        "precision",
        "billable",
        "confirmed_at_utc",
        "terms",
      ],
      ...rows.map((f) => [
        f.intentId,
        f.method,
        f.currency,
        formatFee(f.amountMinor.toFixed(0), f.precision),
        f.amountMinor.toFixed(0),
        String(f.precision),
        String(f.billable),
        f.effectiveAt.toISOString(),
        JSON.stringify(f.terms),
      ]),
    ]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n");
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="payrouta-fees-${q.month}.csv"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof PortalError
            ? e.message
            : "INVALID_OR_UNAVAILABLE_BILLING_EXPORT",
      },
      {
        status:
          e instanceof PortalError
            ? e.status
            : e instanceof z.ZodError
              ? 400
              : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
