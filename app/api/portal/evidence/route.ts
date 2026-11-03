import { merchantMember } from "@/lib/merchant/access";
import { applicationRequirements } from "@/lib/merchant/evidence";
import { onboardingDocumentIds } from "@/lib/merchant/requirements";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { csrf, member, rateLimit } from "@/lib/portal/access";
import { fileSignature, storage } from "@/lib/portal/adapters";
import { atomic, audit, json, matchedRequirements } from "@/lib/portal/service";
import { Draft, PortalError } from "@/lib/portal/domain";
import { db } from "@/lib/portal/db";
export async function POST(request: Request) {
  try {
    csrf(request);
    const orgId = new URL(request.url).searchParams.get("org") || "";
    const audience =
      new URL(request.url).searchParams.get("audience") || "provider";
    if (!["provider", "merchant"].includes(audience))
      throw new PortalError("INVALID_AUDIENCE");
    const { session } =
      audience === "merchant"
        ? await merchantMember(orgId, "configure", request.headers)
        : await member(orgId, "compliance", request.headers);
    await rateLimit(`upload:${session.user.id}`, 8);
    const declared = Number(request.headers.get("content-length"));
    if (!declared || declared > 6 * 1024 * 1024)
      throw new PortalError("Upload must be under 5 MB", 413);
    const bytes = await readBounded(request, 6 * 1024 * 1024);
    const copy = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": request.headers.get("content-type") || "" },
      body: new Uint8Array(bytes),
    });
    const form = await copy.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size > 5 * 1024 * 1024 || file.size < 8)
      throw new PortalError("Choose a PDF, PNG, or JPEG under 5 MB");
    const body = Buffer.from(await file.arrayBuffer());
    if (!fileSignature(body, file.type))
      throw new PortalError(
        "File signature does not match an accepted PDF, PNG, or JPEG",
      );
    const metadata = z
      .object({
        documentType: z.string().min(1).max(120),
        jurisdiction: z.string().length(2),
        identifier: z.string().max(120),
        issueDate: z.string().max(10),
        capabilities: z.string().max(500),
      })
      .parse(Object.fromEntries(form));
    const requirementId = String(form.get("requirementId") || "");
    // Merchants upload for their application and for onboarding documents
    // (ID, registration, proof of address).
    const requirements =
      audience === "merchant"
        ? [
            ...(await applicationRequirements(
              (await db.merchantConfig.findUniqueOrThrow({ where: { orgId } }))
                .application as {
                country?: string;
                methods?: string[];
                requirementIds?: string[];
              },
            )),
            ...(await db.requirement.findMany({
              where: { id: { in: onboardingDocumentIds }, active: true },
            })),
          ]
        : await matchedRequirements(
            db,
            (await db.application.findUniqueOrThrow({ where: { orgId } }))
              .draft as Draft,
          );
    if (!requirements.some((r) => r.id === requirementId))
      throw new PortalError("Choose a current requirement");
    const expiry = String(form.get("expiryDate") || "");
    const expiresAt = expiry ? new Date(expiry) : null;
    if (
      expiresAt &&
      (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())
    )
      throw new PortalError("Expiry date must be in the future");
    const objectKey = randomUUID();
    await storage.put(objectKey, body, file.type);
    try {
      await atomic(async (tx) => {
        const evidence = await tx.evidence.create({
          data: {
            orgId,
            requirementId,
            objectKey,
            filename: file.name.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 100),
            mime: file.type,
            size: file.size,
            sha256: createHash("sha256").update(body).digest("hex"),
            metadata: json(metadata),
            expiresAt,
            retentionUntil: new Date(
              Date.now() +
                Number(process.env.EVIDENCE_RETENTION_DAYS || 90) * 86400000,
            ),
          },
        });
        await tx.job.create({
          data: {
            orgId,
            kind: "scan",
            key: `scan:${evidence.id}`,
            payload: { evidenceId: evidence.id, objectKey },
          },
        });
        await audit(
          tx,
          orgId,
          session.user.id,
          "Evidence uploaded",
          evidence.id,
          { size: file.size, mime: file.type },
        );
      });
    } catch (e) {
      await storage.delete(objectKey);
      throw e;
    }
    return Response.json({
      message: "Uploaded to private quarantine. Scanning is pending.",
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof PortalError
            ? error.message
            : "Upload failed. Check metadata and try again.",
      },
      { status: error instanceof PortalError ? error.status : 400 },
    );
  }
}
async function readBounded(request: Request, max: number) {
  const reader = request.body!.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  const timer = setTimeout(() => reader.cancel(), 15000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) {
        await reader.cancel();
        throw new PortalError("Upload too large", 413);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
}
