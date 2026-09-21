import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const external = join(homedir(), ".local", "share", "payrouta");
mkdirSync(external, { recursive: true, mode: 0o700 });
const key = join(external, "master.key");
if (!existsSync(key)) writeFileSync(key, randomBytes(32), { mode: 0o600 });
if (!existsSync(".env"))
  writeFileSync(
    ".env",
    `DATABASE_URL=postgresql://payrouta@127.0.0.1:55432/payrouta\nBETTER_AUTH_URL=http://127.0.0.1:3000\nBETTER_AUTH_SECRET=${randomBytes(48).toString("base64url")}\nPORTAL_MODE=local\nLOCAL_VAULT_KEY_FILE=${key}\nLOCAL_DATA_DIR=.local/portal\nEVIDENCE_RETENTION_DAYS=90\n`,
    { mode: 0o600 },
  );
console.log("Local environment prepared. No production services enabled.");
