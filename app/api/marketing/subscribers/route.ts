import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/portal/db";

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const role = searchParams.get("role");
    const status = searchParams.get("status");
    const query = searchParams.get("q");

    const where: Record<string, any> = {};
    if (role && role !== "all") where.role = role;
    if (status && status !== "all") where.status = status;
    if (query) {
      where.OR = [
        { email: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
      ];
    }

    const [subscribers, total] = await Promise.all([
      db.marketingSubscriber.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      db.marketingSubscriber.count({ where }),
    ]);

    return NextResponse.json({ subscribers, total });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load subscribers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
