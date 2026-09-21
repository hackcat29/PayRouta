// Any one valid submitted document can satisfy a requirement. Unrelated or
// expired alternatives must not erase the expiry of the supporting evidence.
export function assessEvidence(
  requirements: { id: string }[],
  evidence: {
    requirementId: string;
    reviewStatus: string;
    scanStatus: string;
    expiresAt: Date | null;
  }[],
  fictionalSandbox: boolean,
  now: Date,
) {
  const support = requirements.map((r) =>
    evidence.filter(
      (e) =>
        e.requirementId === r.id &&
        e.reviewStatus === "Accepted" &&
        (!e.expiresAt || e.expiresAt > now) &&
        (e.scanStatus === "Clean" ||
          (fictionalSandbox && e.scanStatus === "Fixture only")),
    ),
  );
  return {
    valid: support.every((rows) => rows.length > 0),
    expiresAt: Math.min(
      Infinity,
      ...support.map((rows) =>
        rows.length
          ? Math.max(...rows.map((e) => e.expiresAt?.getTime() ?? Infinity))
          : now.getTime(),
      ),
    ),
  };
}
