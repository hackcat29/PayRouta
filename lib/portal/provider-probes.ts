import { db } from "./db";
import { localMode, secretManager } from "./adapters";
import {
  assertAdapterConfiguration,
  observeProvider,
} from "./provider-adapters";
import { checkEndpoint } from "./ssrf";
import { ingestObservation, freshnessPolicy } from "./observations";
import { CapabilityDefinition } from "./domain";
import { randomUUID } from "node:crypto";
let lastProfileId: string | undefined;
// Bounded background work, never invoked from an availability request.
export async function refreshObservations(now = new Date()) {
  const profiles = await db.publishedProfile.findMany({
    where: {
      current: true,
      ...(lastProfileId ? { id: { gt: lastProfileId } } : {}),
    },
    orderBy: { id: "asc" },
    take: 20,
  });
  if (!profiles.length) {
    lastProfileId = undefined;
    return;
  }
  const start = performance.now();
  for (const p of profiles) {
    if (performance.now() - start > 15000) break;
    lastProfileId = p.id;
    try {
      const integration = await db.integration.findUniqueOrThrow({
        where: { id: p.integrationId },
        include: { org: true },
      });
      const config = integration.config as { adapter: string };
      if (
        config.adapter === "simulator" &&
        (!localMode() ||
          !integration.org.fictional ||
          p.environment !== "sandbox")
      )
        continue;
      const adapter = assertAdapterConfiguration(
        config.adapter,
        "1",
        p.environment,
        config,
      );
      const c = p.definition as unknown as CapabilityDefinition;
      const latestRun =
        config.adapter === "simulator"
          ? await db.sandboxRun.findFirst({
              where: {
                orgId: p.orgId,
                integrationVersion: integration.version,
                outcome: "Passed",
                scenario: {
                  in: [
                    "Authentication succeeds",
                    "Provider unavailable before execution",
                  ],
                },
              },
              orderBy: { createdAt: "desc" },
            })
          : null;
      for (const type of c.fulfillment!.checks) {
        const result = await observeProvider(
          adapter,
          type,
          { config, capabilityId: p.capabilityId },
          {
            credentials: secretManager,
            http: checkEndpoint,
            clock: () => new Date(),
            telemetry: (event, values) =>
              console.info(JSON.stringify({ event, ...values })),
          },
          { timeoutMs: 1000, diagnostic: randomUUID() },
        );
        const value = result.ok
          ? (result.value as { status?: string; remaining?: string })
          : undefined;
        await ingestObservation(
          p.orgId,
          {
            integrationId: p.integrationId,
            capabilityId: p.capabilityId,
            capabilityVersion: p.capabilityVersion,
            environment: p.environment,
            type,
            eventId: randomUUID(),
            sequence: Math.floor(now.getTime() / 1000),
            observedAt: now.toISOString(),
            expiresAt: new Date(
              now.getTime() + freshnessPolicy()[type],
            ).toISOString(),
            status: !result.ok
              ? "Unknown"
              : latestRun?.scenario === "Provider unavailable before execution"
                ? "Unavailable"
                : value?.status || "Available",
            ...(type === "capacity"
              ? { remaining: value?.remaining || "0" }
              : {}),
          },
          config.adapter === "simulator" ? "simulated" : "adapter",
          now,
        );
        if (!result.ok)
          console.warn(
            JSON.stringify({
              event: "provider.probe.failed",
              adapter: adapter.id,
              operation: type,
              code: result.error.code,
            }),
          );
      }
    } catch {
      // Do not replace missing evidence with a positive observation or stop unrelated jobs.
      console.warn(
        JSON.stringify({
          event: "provider.probe.failed",
          environment: p.environment,
          code: "PROBE_CONFIGURATION_OR_STORE_FAILURE",
        }),
      );
    }
  }
}
