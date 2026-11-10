// Upload (POST, multipart `file`) or remove (DELETE) the merchant's logo
// (lib/merchant/branding.ts). ?org= names the business.
import { csrf } from "@/lib/portal/access";
import { PortalError } from "@/lib/portal/domain";
import { respond } from "@/lib/payments/http";
import { logoMaxBytes, removeLogo, saveLogo } from "@/lib/merchant/branding";

const org = (request: Request) => {
  const orgId = new URL(request.url).searchParams.get("org") ?? "";
  if (!orgId || orgId.length > 100) throw new PortalError("INVALID_REQUEST", 400);
  return orgId;
};

export function POST(request: Request) {
  return respond(async () => {
    csrf(request);
    const orgId = org(request);
    // The form wraps the file; allow a little over the limit for that.
    const max = logoMaxBytes + 16384;
    if (Number(request.headers.get("content-length") ?? 0) > max) throw new PortalError("LOGO_TOO_LARGE", 413);
    const body = await bounded(request, max);
    const form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("content-type") ?? "" }, body }).formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new PortalError("INVALID_REQUEST", 400);
    if (file.size > logoMaxBytes) throw new PortalError("LOGO_TOO_LARGE", 413);
    return saveLogo(orgId, new Uint8Array(await file.arrayBuffer()), request.headers);
  });
}

export function DELETE(request: Request) {
  return respond(async () => {
    csrf(request);
    return removeLogo(org(request), request.headers);
  });
}

// The body, refusing anything over `max` bytes however it is sent.
async function bounded(request: Request, max: number) {
  if (!request.body) throw new PortalError("INVALID_REQUEST", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new PortalError("LOGO_TOO_LARGE", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
