import { db } from "@/lib/portal/db";

// Liveness and database reachability for the process supervisor and load
// balancer. Reveals no configuration.
export const dynamic = "force-dynamic";
export async function GET() {
  let database = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    database = "unavailable";
  }
  return Response.json(
    { status: database === "ok" ? "ok" : "degraded", database },
    { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
