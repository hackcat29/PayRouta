import { z } from "zod";
import { db } from "../portal/db";
import { atomic, json } from "../portal/service";
import { fingerprint } from "../portal/registry";
import { providerFact } from "./contracts";
import { applyFact, reconcile } from "./processing";
import { exception } from "./journal";
const reportSchema = z
  .object({
    providerReportId: z.string().min(1).max(100),
    coverageStart: z.iso.datetime(),
    coverageEnd: z.iso.datetime(),
    rows: z.array(providerFact).max(500),
  })
  .strict();
// Internal adapter boundary only. No endpoint accepts customer-supplied report evidence.
export async function importReport(
  integrationId: string,
  environment: string,
  value: unknown,
) {
  const parsed = reportSchema.parse(value);
  const fingerprintValue = fingerprint(parsed);
  const report = await db.paymentReport.upsert({
    where: {
      integrationId_environment_fingerprint: {
        integrationId,
        environment,
        fingerprint: fingerprintValue,
      },
    },
    create: {
      integrationId,
      environment,
      fingerprint: fingerprintValue,
      providerReportId: parsed.providerReportId,
      coverageStart: new Date(parsed.coverageStart),
      coverageEnd: new Date(parsed.coverageEnd),
      rows: json(parsed.rows),
    },
    update: {},
  });
  if (report.state === "Complete") return report;
  for (let index = report.cursor; index < parsed.rows.length; index++) {
    const row = parsed.rows[index];
    const a = await db.paymentAttempt.findFirst({
      where: { integrationId, environment, providerReference: row.reference },
    });
    if (a) {
      await applyFact(a.id, row);
      await reconcile(a.id);
    } else
      await atomic((tx) =>
        exception(
          tx,
          `unmatched:${integrationId}:${row.reference}`,
          "PROVIDER_PAYMENT_MISSING_INTERNALLY",
          { reportId: report.id, reference: row.reference, environment },
        ),
      );
    // Duplicate processing on a crash is safe: financial facts have stable source keys.
    await db.paymentReport.updateMany({
      where: { id: report.id, cursor: { lte: index } },
      data: { cursor: index + 1 },
    });
  }
  return db.paymentReport.update({
    where: { id: report.id },
    data: { state: "Complete" },
  });
}

export async function importSimulatorReport(
  integrationId: string,
  now = new Date(),
) {
  const integration = await db.integration.findUniqueOrThrow({
    where: { id: integrationId },
  });
  if (
    integration.environment !== "sandbox" ||
    (integration.config as { adapter: string }).adapter !== "simulator"
  )
    throw new Error("REPORT_ADAPTER_UNCONFIGURED");
  const attempts = await db.paymentAttempt.findMany({
    where: { integrationId, environment: "sandbox" },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const rows = await db.simulatorPayment.findMany({
    where: { key: { in: attempts.map((a) => a.key) } },
    orderBy: { reference: "asc" },
  });
  return importReport(integrationId, "sandbox", {
    providerReportId: `simulator:${integrationId}:${Math.floor(now.getTime() / 60000)}`,
    coverageStart:
      attempts.at(-1)?.createdAt.toISOString() || now.toISOString(),
    coverageEnd: now.toISOString(),
    rows: rows.map((r) => ({
      reference: r.reference,
      state: r.state,
      amount: r.amount,
      asset: r.asset,
    })),
  });
}
