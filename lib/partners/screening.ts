// PayRouta-side KYB screening, run before any merchant data is disclosed to a
// partner. Partners still run their own full KYC/KYB; this gate exists so
// PayRouta never refers a sanctioned or obviously ineligible business.
import type { EntityScreeningProvider, ScreeningResult } from "../compliance/providers";
import { entityScreeningProvider } from "../compliance/providers";
import type { KybProfile } from "./kyb";

export interface ScreeningSubject {
  subject: string;
  name: string;
  country?: string;
  kind: "person" | "organization";
}

export function screeningSubjects(p: KybProfile): ScreeningSubject[] {
  return [
    { subject: "business", name: p.legalName, country: p.country, kind: "organization" },
    ...(p.tradingName && p.tradingName !== p.legalName
      ? [{ subject: "business:trading-name", name: p.tradingName, country: p.country, kind: "organization" as const }]
      : []),
    {
      subject: "representative",
      name: `${p.representative.givenName} ${p.representative.familyName}`,
      country: p.country,
      kind: "person",
    },
    ...p.owners.map((o, i) => ({
      subject: `owner:${i}`,
      name: `${o.givenName} ${o.familyName}`,
      country: o.country,
      kind: "person" as const,
    })),
  ];
}

export type ScreeningVerdict = ScreeningResult["verdict"];

export function aggregate(verdicts: ScreeningVerdict[]): ScreeningVerdict {
  if (verdicts.includes("match")) return "match";
  if (verdicts.includes("review")) return "review";
  return "clear";
}

// Deterministic fixture for fictional local organisations only. Never used for
// a real organisation or outside local mode (enforced by the caller).
export const sandboxScreening: EntityScreeningProvider = {
  id: "sandbox-fixture",
  async screenEntity(input) {
    const name = input.name ?? "";
    return {
      verdict: name.includes("[sanctioned]")
        ? "match"
        : name.includes("[review]")
          ? "review"
          : "clear",
      reference: "fixture",
      matches: name.includes("[sanctioned]") ? ["sanctions-fixture"] : [],
    };
  },
};

export function screeningProvider(fictionalLocal: boolean): EntityScreeningProvider {
  return fictionalLocal ? sandboxScreening : entityScreeningProvider();
}

export async function screenProfile(
  profile: KybProfile,
  provider: EntityScreeningProvider,
) {
  const results = [];
  for (const s of screeningSubjects(profile)) {
    const r = await provider.screenEntity({ name: s.name, country: s.country, kind: s.kind });
    results.push({
      subject: s.subject,
      verdict: r.verdict,
      reference: r.reference.slice(0, 200),
      matches: r.matches.slice(0, 20).map((m) => m.slice(0, 100)),
    });
  }
  return {
    provider: provider.id,
    verdict: aggregate(results.map((r) => r.verdict)),
    results,
  };
}
