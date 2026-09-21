import { lookup } from "node:dns/promises";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { PortalError } from "./domain";
export function publicAddress(address: string) {
  try {
    const parsed = ipaddr.process(address);
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}
export async function validateEndpoint(raw: string, resolver = lookup) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PortalError("Enter a valid HTTPS endpoint");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hash
  )
    throw new PortalError(
      "Endpoint must use HTTPS on port 443 without credentials or fragments",
    );
  const name = url.hostname.replace(/^\[|\]$/g, "");
  if (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".local")
  )
    throw new PortalError("Private endpoints are not allowed");
  const addresses = await resolver(name, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new PortalError("Endpoint resolves to a disallowed address");
  return { url, address: addresses[0] };
}
// DNS is resolved at execution and pinned into the TLS connection. Redirects are never followed.
export async function checkEndpoint(
  raw: string,
  token?: string,
  signal?: AbortSignal,
) {
  const { url, address } = await validateEndpoint(raw);
  return new Promise<{ status: number; bytes: number }>((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        signal,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        servername: url.hostname,
        lookup: (_host, _options, cb) =>
          cb(null, address.address, address.family),
        timeout: 8000,
      },
      (response) => {
        if (
          (response.statusCode || 0) >= 300 &&
          (response.statusCode || 0) < 400
        ) {
          response.destroy();
          reject(new PortalError("Redirects are not permitted"));
          return;
        }
        let bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 65536) {
            response.destroy();
            reject(new PortalError("Response exceeds 64 KiB"));
          }
        });
        response.on("end", () =>
          resolve({ status: response.statusCode || 0, bytes }),
        );
        response.on("error", () =>
          reject(new PortalError("Endpoint response failed")),
        );
      },
    );
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", () =>
      reject(new PortalError("Endpoint unavailable or timed out")),
    );
    request.end();
  });
}
