// Re-encrypt every live secret under SECRET_ACTIVE_KEY_ID. Keep the old key in
// SECRET_MASTER_KEYS until this reports completion, then remove it.
import "dotenv/config";
import { db } from "../lib/portal/db";
import { rotateSecrets } from "../lib/portal/secret-store";

rotateSecrets()
  .then((n) => console.log(`${n} secret(s) re-encrypted under the active key.`))
  .finally(() => db.$disconnect());
