import { randomUUID } from "node:crypto";
import { PortalError } from "../portal/domain";
import { json } from "../portal/service";
import type { Tx } from "./service";
export type Posting = { account: string; debit: string; credit: string };
const accounts = new Set([
  "provider-clearing",
  "merchant-payable",
  "provider-fee",
  "merchant-settled",
  "conversion-clearing",
]);
export function validatePostings(lines: Posting[]) {
  if (lines.length < 2 || lines.length > 20)
    throw new PortalError("INVALID_JOURNAL");
  let total = 0n;
  for (const l of lines) {
    if (
      !accounts.has(l.account) ||
      !/^\d+$/.test(l.debit) ||
      !/^\d+$/.test(l.credit) ||
      (BigInt(l.debit) > 0n && BigInt(l.credit) > 0n)
    )
      throw new PortalError("INVALID_POSTING");
    total += BigInt(l.debit) - BigInt(l.credit);
  }
  if (total !== 0n) throw new PortalError("UNBALANCED_JOURNAL");
}
export async function post(
  tx: Tx,
  input: {
    orgId: string;
    environment: string;
    source: string;
    asset: string;
    purpose: string;
    effectiveAt: Date;
    reversalOf?: string;
  },
  lines: Posting[],
) {
  validatePostings(lines);
  const old = await tx.journalEntry.findUnique({
    where: { source: input.source },
  });
  if (old) return old;
  return tx.journalEntry.create({
    data: {
      ...input,
      id: randomUUID(),
      book: "provider-merchant-operational",
      postings: { create: lines },
    },
  });
}
export async function reverse(
  tx: Tx,
  id: string,
  source: string,
  reason: string,
  now = new Date(),
) {
  const old = await tx.journalEntry.findUniqueOrThrow({
    where: { id },
    include: { postings: true },
  });
  if (!reason.trim()) throw new PortalError("CORRECTION_REASON_REQUIRED");
  return post(
    tx,
    {
      orgId: old.orgId,
      environment: old.environment,
      source,
      asset: old.asset,
      purpose: reason,
      reversalOf: id,
      effectiveAt: now,
    },
    old.postings.map((p) => ({
      account: p.account,
      debit: p.credit.toString(),
      credit: p.debit.toString(),
    })),
  );
}
export async function exception(
  tx: Tx,
  intentId: string,
  code: string,
  evidence: unknown,
  now = new Date(),
) {
  return tx.paymentException.upsert({
    where: { intentId_code: { intentId, code } },
    create: {
      intentId,
      code,
      evidence: json(evidence),
      timeline: json([{ at: now.toISOString(), action: "Detected" }]),
    },
    update: { evidence: json(evidence) },
  });
}
