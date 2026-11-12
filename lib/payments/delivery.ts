import https from "node:https";
import { db } from "../portal/db";
import { secretManager, localMode } from "../portal/adapters";
import { validateEndpoint } from "../portal/ssrf";
import { atomic, json } from "../portal/service";
import { signature } from "./contracts";
// Attempts before a delivery is given up on (the worker backs off to an hour
// between them, so about four hours in all).
export const webhookRetryLimit = 14;
export async function deliver(eventId: string, now = new Date()) {
  const e = await db.merchantEvent.findUniqueOrThrow({
    where: { id: eventId },
  });
  const d = await db.merchantDelivery.findUniqueOrThrow({ where: { eventId } });
  if (d.state === "Delivered") return;
  const config = await db.merchantConfig.findUniqueOrThrow({
    where: { orgId: e.orgId },
  });
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify(e.payload);
  let success = false;
  // Why a delivery failed, for the log and the delivery history: never the
  // endpoint's response body.
  let reason = "";
  try {
    if (config.environment !== e.environment || !config.webhookUrl || !config.webhookSecretRef)
      throw new Error("unconfigured");
    const secret = await secretManager.get(config.webhookSecretRef);
    const headers = {
      "content-type": "application/json",
      "payrouta-event-id": e.id,
      "payrouta-timestamp": timestamp,
      "payrouta-key-id": config.webhookKeyId,
      "payrouta-signature": signature(secret, timestamp, e.id, body),
    };
    if (
      config.webhookUrl === "local://payment-receiver" &&
      localMode() &&
      e.environment === "sandbox"
    ) {
      // Fixed loopback fixture only; arbitrary local targets are never accepted.
      const response = await fetch("http://127.0.0.1:55439/webhook", {
        method: "POST",
        headers,
        body,
        redirect: "error",
        signal: AbortSignal.timeout(3000),
      });
      success = response.ok;
      if (!success) reason = `HTTP ${response.status}`;
    } else {
      const { url, address } = await validateEndpoint(config.webhookUrl).catch((error: Error) => {
        reason = `endpoint rejected: ${error.message}`;
        throw error;
      });
      success = await new Promise<boolean>((resolve, reject) => {
        const r = https.request(
          url,
          {
            method: "POST",
            headers,
            family: address.family,
            servername: url.hostname,
            lookup: (_h, _o, cb) => cb(null, address.address, address.family),
            timeout: 5000,
          },
          (res) => {
            const ok =
              (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300;
            if (!ok) reason = `HTTP ${res.statusCode ?? 0}`;
            res.destroy();
            resolve(ok);
          },
        );
        r.on("timeout", () => {
          reason = "timed out";
          r.destroy();
        });
        r.on("error", reject);
        r.end(body);
      });
    }
  } catch (error) {
    success = false;
    if (!reason)
      reason =
        error instanceof Error && error.message === "unconfigured"
          ? "no webhook endpoint set"
          : `network: ${(error as { code?: string }).code ?? (error instanceof Error ? error.message.slice(0, 80) : "error")}`;
  }
  await atomic(async (tx) => {
    const latest = await tx.merchantDelivery.findUniqueOrThrow({
      where: { eventId },
    });
    if (latest.state === "Delivered") return;
    await tx.merchantDelivery.update({
      where: { eventId },
      data: {
        state: success
          ? "Delivered"
          : latest.attempts >= webhookRetryLimit
            ? "Exhausted"
            : "Failed",
        attempts: { increment: 1 },
        history: json([
          ...(latest.history as object[]).slice(-19),
          {
            at: now.toISOString(),
            result: success ? "Delivered" : "Delivery failed",
            ...(reason ? { reason } : {}),
            keyId: config.webhookKeyId,
          },
        ]),
      },
    });
  });
  console.info(
    JSON.stringify({
      event: "merchant.delivery",
      eventId,
      result: success ? "Delivered" : "Failed",
      ...(reason ? { reason, host: config.webhookUrl ? new URL(config.webhookUrl).hostname : null } : {}),
    }),
  );
  if (!success) throw new Error("MERCHANT_DELIVERY_FAILED");
}
