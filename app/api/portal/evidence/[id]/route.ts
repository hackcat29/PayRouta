import { merchantMember } from "@/lib/merchant/access";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/portal/db";
import { csrf, identity, internal, member } from "@/lib/portal/access";
import { audit, atomic } from "@/lib/portal/service";
import { storage } from "@/lib/portal/adapters";
import { PortalError } from "@/lib/portal/domain";
const sign = (value: string) =>
  createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(value)
    .digest("hex");
async function authorize(id: string, h: Headers) {
  const session = await identity(h);
  const evidence = await db.evidence.findUnique({ where: { id } });
  if (!evidence || evidence.deletedAt)
    throw new PortalError("Evidence not found", 404);
  const membership = await db.membership.findUnique({
    where: { orgId_userId: { orgId: evidence.orgId, userId: session.user.id } },
  });
  const requirement = await db.requirement.findUnique({
    where: { id: evidence.requirementId },
  });
  if (membership) {
    if (["merchant", "merchant-onboarding"].includes((requirement?.scope as { audience?: string })?.audience ?? ""))
      await merchantMember(evidence.orgId, "configure", h);
    else await member(evidence.orgId, "compliance", h);
  } else await internal(false, h);
  return { evidence, session };
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    csrf(request);
    const { id } = await params;
    const { evidence, session } = await authorize(id, request.headers);
    if (evidence.scanStatus !== "Clean")
      throw new PortalError(
        "Document is quarantined. Downloads require a clean scanner result.",
        403,
      );
    const expires = Date.now() + 60000;
    const payload = `${id}:${session.user.id}:${expires}`;
    await audit(
      db,
      evidence.orgId,
      session.user.id,
      "Evidence download link issued",
      id,
    );
    return Response.json({
      url: `/api/portal/evidence/${id}?expires=${expires}&signature=${sign(payload)}`,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { evidence, session } = await authorize(id, request.headers);
    const url = new URL(request.url);
    const expires = Number(url.searchParams.get("expires"));
    const sig = url.searchParams.get("signature") || "";
    const expected = sign(`${id}:${session.user.id}:${expires}`);
    if (
      !Number.isFinite(expires) ||
      expires < Date.now() ||
      expires > Date.now() + 60000 ||
      sig.length !== 64 ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ||
      evidence.scanStatus !== "Clean"
    )
      throw new PortalError("Download link expired or unavailable", 403);
    await audit(db, evidence.orgId, session.user.id, "Evidence downloaded", id);
    const bytes = await storage.get(evidence.objectKey);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${evidence.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    csrf(request);
    const { id } = await params;
    const { evidence, session } = await authorize(id, request.headers);
    await atomic(async (tx) => {
      await tx.evidence.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      await tx.job.create({
        data: {
          orgId: evidence.orgId,
          kind: "delete-document",
          key: `delete:${id}`,
          payload: { objectKey: evidence.objectKey },
        },
      });
      await audit(
        tx,
        evidence.orgId,
        session.user.id,
        "Evidence deletion requested",
        id,
      );
    });
    return Response.json({
      message: "Evidence removed from review; private object deletion queued",
    });
  } catch (e) {
    return failure(e);
  }
}
function failure(e: unknown) {
  return Response.json(
    { error: e instanceof PortalError ? e.message : "Document unavailable" },
    { status: e instanceof PortalError ? e.status : 500 },
  );
}
