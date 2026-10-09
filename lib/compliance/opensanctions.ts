// OpenSanctions entity screening (sanctions, PEPs, criminal watchlists).
// https://www.opensanctions.org/docs/api/ — POST /match/{dataset} with an
// "Authorization: ApiKey …" header. Only names and countries are sent.
//
// Verdicts are conservative: a confident match on a sanctions or crime list
// stops the merchant; a confident match that is only a PEP or other role goes
// to manual review; anything else is clear.
import { PortalError } from "../portal/domain";
import type { ProviderHttpOptions } from "../providers/adapters/http";
import type { EntityScreeningProvider, ScreeningResult } from "./providers";

export type OpenSanctionsHttp = (
  baseUrl: string,
  options: ProviderHttpOptions,
) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

export interface OpenSanctionsConfig {
  apiKey?: string;
  baseUrl?: string;
  dataset?: string;
  threshold?: number;
  timeoutMs?: number;
}

const blocking = ["sanction", "sanction.linked", "crime", "crime.terror", "crime.fin", "debarment"];

export function openSanctionsVerdict(
  results: { match?: unknown; properties?: { topics?: unknown } }[],
): ScreeningResult["verdict"] {
  const confident = results.filter((r) => r.match === true);
  if (!confident.length) return "clear";
  const topics = confident.flatMap((r) =>
    Array.isArray(r.properties?.topics) ? (r.properties!.topics as unknown[]).map(String) : [],
  );
  return topics.some((t) => blocking.includes(t)) ? "match" : "review";
}

export function openSanctionsScreening(
  config: OpenSanctionsConfig,
  http: OpenSanctionsHttp,
): EntityScreeningProvider {
  const baseUrl = config.baseUrl ?? "https://api.opensanctions.org";
  const dataset = config.dataset ?? "default";
  const threshold = config.threshold ?? 0.7;
  return {
    id: "opensanctions",
    async screenEntity(input) {
      if (!config.apiKey) throw new PortalError("ENTITY_SCREENING_PROVIDER_NOT_CONFIGURED", 503);
      if (!input.name) throw new PortalError("SCREENING_NAME_REQUIRED", 400);
      const person = input.kind === "person";
      const properties: Record<string, string[]> = { name: [input.name] };
      if (input.country)
        properties[person ? "nationality" : "country"] = [input.country.toLowerCase()];
      const response = await http(baseUrl, {
        method: "POST",
        path: `/match/${encodeURIComponent(dataset)}?threshold=${threshold}`,
        headers: {
          Authorization: `ApiKey ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          queries: { q: { schema: person ? "Person" : "LegalEntity", properties } },
        }),
        timeoutMs: config.timeoutMs ?? 8000,
        maxResponseBytes: 524288,
      });
      if (response.status < 200 || response.status >= 300)
        throw new PortalError("ENTITY_SCREENING_UNAVAILABLE", 503);
      let body: { responses?: { q?: { results?: unknown } } };
      try {
        body = JSON.parse(response.body);
      } catch {
        throw new PortalError("ENTITY_SCREENING_UNAVAILABLE", 503);
      }
      const results = body.responses?.q?.results;
      if (!Array.isArray(results)) throw new PortalError("ENTITY_SCREENING_UNAVAILABLE", 503);
      const confident = results.filter((r) => r && r.match === true);
      return {
        verdict: openSanctionsVerdict(results),
        reference: confident
          .map((r) => String(r.id ?? ""))
          .filter(Boolean)
          .slice(0, 5)
          .join(",") || "no-match",
        matches: [
          ...new Set(
            confident.flatMap((r) =>
              Array.isArray(r.properties?.topics) ? r.properties.topics.map(String) : [],
            ),
          ),
        ].slice(0, 20),
      };
    },
  };
}
