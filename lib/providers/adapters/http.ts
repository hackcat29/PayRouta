import https from "node:https";
import { lookup } from "node:dns/promises";
import { PortalError } from "../../portal/domain";
import { validateEndpoint } from "../../portal/ssrf";

// SSRF-safe outbound request for provider integrations. Reuses the existing
// DNS-pinned endpoint validator, adds bounded request/response bodies, and
// never follows redirects.
export interface ProviderHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  bytes: number;
  // The body as received, for binary responses (images).
  buffer?: Buffer;
}
export interface ProviderHttpOptions {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  signal?: AbortSignal;
  // "return": hand a redirect back (status and Location) for the caller to
  // follow through providerRequest again, so the next host is checked too.
  // Otherwise a redirect is an error.
  redirects?: "return";
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

export async function providerRequest(
  baseUrl: string,
  options: ProviderHttpOptions,
  resolver: typeof lookup = lookup,
): Promise<ProviderHttpResponse> {
  const path = options.path.startsWith("/")
    ? options.path
    : `/${options.path}`;
  const target = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const { url, address } = await validateEndpoint(target.toString(), resolver);
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs || 8000, 15000));
  const maxBytes = Math.max(1024, Math.min(options.maxResponseBytes || 65536, 1048576));
  const body = options.body ?? null;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(options.headers || {}),
  };
  if (body !== null) {
    if (Buffer.byteLength(body, "utf8") > 65536)
      throw new PortalError("Provider request body exceeds 64 KiB");
    // Form-encoded providers (e.g. Stripe) declare their own content type.
    if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type"))
      headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(Buffer.byteLength(body, "utf8"));
  }
  return new Promise<ProviderHttpResponse>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: options.method,
        signal: options.signal,
        headers,
        // A single validated address is pinned; do not ask lookup for an array.
        family: address.family,
        servername: url.hostname,
        lookup: (_host, _opts, cb) => cb(null, address.address, address.family),
        timeout: timeoutMs,
      },
      (response) => {
        const status = response.statusCode || 0;
        if (status >= 300 && status < 400) {
          response.destroy();
          if (options.redirects === "return")
            resolve({ status, headers: { location: String(response.headers.location ?? "") }, body: "", bytes: 0 });
          else reject(new PortalError("Redirects are not permitted"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > maxBytes) {
            response.destroy();
            reject(new PortalError("Provider response exceeds size limit"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => {
          const buffer = Buffer.concat(chunks);
          resolve({
            status,
            headers: response.headers as Record<string, string>,
            body: buffer.toString("utf8"),
            bytes,
            buffer,
          });
        });
        response.on("error", () =>
          reject(new PortalError("Provider response failed")),
        );
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", () =>
      reject(new PortalError("Provider endpoint unavailable or timed out")),
    );
    if (body !== null) request.write(body);
    request.end();
  });
}
