import { db } from "../portal/db";
export function matchesMerchantRequirement(
  scope: unknown,
  application: { country?: string; methods?: string[] },
) {
  const value = scope as {
    audience?: string;
    countries?: string[];
    methods?: string[];
  };
  return (
    value?.audience === "merchant" &&
    (!value.countries?.length ||
      value.countries.includes(application.country || "")) &&
    (!value.methods?.length ||
      application.methods?.some((m) => value.methods!.includes(m)) === true)
  );
}
export async function merchantRequirements(application: {
  country?: string;
  methods?: string[];
}) {
  const rows = await db.requirement.findMany({
    where: { active: true },
    orderBy: [{ templateId: "asc" }, { version: "desc" }],
    take: 500,
  });
  return rows.filter((row) =>
    matchesMerchantRequirement(row.scope, application),
  );
}

// Submitted applications retain exact requirement versions until a revised draft is saved.
export async function applicationRequirements(application: {
  country?: string;
  methods?: string[];
  requirementIds?: string[];
}) {
  if (Array.isArray(application.requirementIds)) {
    const rows = await db.requirement.findMany({
      where: { id: { in: application.requirementIds } },
    });
    return rows.filter(
      (row) => (row.scope as { audience?: string })?.audience === "merchant",
    );
  }
  return merchantRequirements(application);
}
