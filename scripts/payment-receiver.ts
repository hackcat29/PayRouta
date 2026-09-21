import { createServer } from "node:http";
import { verify } from "../lib/payments/contracts";
const ids = new Set<string>();
let count = 0;
createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 32768) {
      res.writeHead(413).end();
      return;
    }
  }
  const id = String(req.headers["payrouta-event-id"] || "");
  const valid = verify(
    "fictional-payment-webhook-secret-2026",
    String(req.headers["payrouta-timestamp"] || ""),
    id,
    body,
    String(req.headers["payrouta-signature"] || ""),
    new Date(),
  );
  if (!valid) {
    res.writeHead(401).end();
    return;
  }
  if (count++ < Number(process.env.PAYMENT_RECEIVER_FAIL_FIRST || 0)) {
    res.writeHead(503).end();
    return;
  }
  const duplicate = ids.has(id);
  ids.add(id);
  console.log(
    JSON.stringify({ event: "sandbox.webhook.received", id, duplicate }),
  );
  res.writeHead(204).end();
}).listen(55439, "127.0.0.1", () =>
  console.log("Fictional merchant receiver on 127.0.0.1:55439"),
);
