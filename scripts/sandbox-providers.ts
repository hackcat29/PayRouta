// Seed the fictional simulator providers on a deployed sandbox. Requires
// HOSTED_SANDBOX=enabled. Creates no merchants or users; merchants sign up
// themselves and their sandbox payments route to these simulated providers.
import "dotenv/config";
import { db } from "../lib/portal/db";
import { sandboxSimulation } from "../lib/portal/adapters";
import { seedSandboxProviders } from "./payment-fixtures";

if (!sandboxSimulation()) throw new Error("Set HOSTED_SANDBOX=enabled first");
seedSandboxProviders()
  .then(() => console.log("Sandbox simulator providers ready."))
  .finally(() => db.$disconnect());
