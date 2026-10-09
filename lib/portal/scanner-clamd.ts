// Malware scanning through a ClamAV daemon (clamd) using its INSTREAM
// protocol over TCP. Configure CLAMD_HOST / CLAMD_PORT (default port 3310)
// and keep clamd on a private interface. Only an explicit "OK" is Clean; a
// signature hit is Malicious; any error leaves the document quarantined.
import net from "node:net";

export function clamdConfigured() {
  return !!process.env.CLAMD_HOST;
}

export function parseClamdReply(reply: string): "Clean" | "Malicious" | null {
  const text = reply.replace(/\0/g, "").trim();
  if (/^stream: OK$/.test(text)) return "Clean";
  if (/^stream: .+ FOUND$/.test(text)) return "Malicious";
  return null;
}

export function scanWithClamd(
  bytes: Buffer,
  options = {
    host: process.env.CLAMD_HOST || "127.0.0.1",
    port: Number(process.env.CLAMD_PORT || 3310),
    timeoutMs: 30000,
  },
): Promise<"Clean" | "Malicious"> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: options.host, port: options.port });
    const chunks: Buffer[] = [];
    socket.setTimeout(options.timeoutMs, () => socket.destroy(new Error("clamd timeout")));
    socket.on("error", reject);
    socket.on("data", (d) => chunks.push(d));
    socket.on("end", () => {
      const verdict = parseClamdReply(Buffer.concat(chunks).toString("utf8"));
      if (verdict) resolve(verdict);
      else reject(new Error("clamd returned an unrecognised reply"));
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += 65536) {
        const chunk = bytes.subarray(i, i + 65536);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(chunk.length);
        socket.write(size);
        socket.write(chunk);
      }
      socket.end(Buffer.alloc(4));
    });
  });
}
