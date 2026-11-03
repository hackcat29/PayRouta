// Accepted onboarding documents (ID, registration, proof of address), so a
// fixture merchant meets every fiat requirement (lib/merchant/requirements.ts).
import { randomUUID } from "node:crypto";
import type { db } from "../../lib/portal/db";
import type { Tx } from "../../lib/payments/service";
import { json } from "../../lib/portal/service";
import { onboardingDocumentIds } from "../../lib/merchant/requirements";

export async function acceptedDocuments(client: typeof db | Tx, orgId: string) {
  for (const requirementId of onboardingDocumentIds)
    await client.evidence.create({
      data: {
        orgId,
        requirementId,
        objectKey: randomUUID(),
        filename: "fixture.pdf",
        mime: "application/pdf",
        size: 100,
        sha256: "0".repeat(64),
        metadata: json({}),
        scanStatus: "Fixture only",
        reviewStatus: "Accepted",
        retentionUntil: new Date(Date.now() + 86400000),
      },
    });
}

// Identity fields every representative needs.
export const identity = { phone: "+447700900123", idType: "passport" as const, idNumber: "P1234567" };
