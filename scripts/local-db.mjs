import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
const root = "/opt/homebrew/opt/postgresql@17/bin";
if (!existsSync(root)) {
  console.error(
    "Native PostgreSQL 17 not found. Use compose.portal.yaml and the database URL in docs/PROVIDER-PORTAL.md.",
  );
  process.exit(1);
}
const run = (name, args, allowed = [0]) => {
  const result = spawnSync(`${root}/${name}`, args, { stdio: "inherit" });
  if (!allowed.includes(result.status)) process.exit(result.status || 1);
};
mkdirSync(".local", { recursive: true });
if (!existsSync(".local/postgres/PG_VERSION"))
  run("initdb", ["-D", ".local/postgres", "-A", "trust", "-U", "payrouta"]);
const ready =
  spawnSync(`${root}/pg_isready`, ["-h", "127.0.0.1", "-p", "55432"], {
    stdio: "ignore",
  }).status === 0;
if (!ready)
  run("pg_ctl", [
    "-D",
    ".local/postgres",
    "-l",
    ".local/postgres.log",
    "-o",
    "-p 55432 -h 127.0.0.1 -k /private/tmp",
    "start",
  ]);
const check = spawnSync(
  `${root}/psql`,
  [
    "-h",
    "127.0.0.1",
    "-p",
    "55432",
    "-U",
    "payrouta",
    "-d",
    "postgres",
    "-tAc",
    "SELECT 1 FROM pg_database WHERE datname='payrouta'",
  ],
  { encoding: "utf8" },
);
if (check.stdout.trim() !== "1")
  run("createdb", [
    "-h",
    "127.0.0.1",
    "-p",
    "55432",
    "-U",
    "payrouta",
    "payrouta",
  ]);
console.log(
  "Isolated local PostgreSQL ready on 127.0.0.1:55432. Fictional data only.",
);
