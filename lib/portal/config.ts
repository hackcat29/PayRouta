import { PortalError } from "./domain";
export function validateRuntime() {
  if (
    !process.env.DATABASE_URL ||
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32 ||
    !process.env.BETTER_AUTH_URL
  )
    throw new PortalError(
      "Portal database, authentication URL, and strong secret must be configured",
      503,
    );
  const origin = new URL(process.env.BETTER_AUTH_URL);
  if (process.env.PORTAL_MODE === "local") {
    if (origin.hostname !== "127.0.0.1")
      throw new PortalError("Local mode requires a loopback origin", 503);
  } else if (
    process.env.PORTAL_MODE !== "production" ||
    origin.protocol !== "https:"
  )
    throw new PortalError(
      "Production portal requires an explicit production mode and HTTPS origin",
      503,
    );
  const retention = Number(process.env.EVIDENCE_RETENTION_DAYS || 90);
  if (!Number.isInteger(retention) || retention < 1 || retention > 3650)
    throw new PortalError(
      "Configure evidence retention between 1 and 3650 days",
      503,
    );
}
