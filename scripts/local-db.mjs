// Starts the isolated local PostgreSQL (127.0.0.1:55432, user and database
// "payrouta", trust auth) that local mode and the database test suites use.
//
// In order:
//   1. Something already answers on 127.0.0.1:55432 (CI's service, or an
//      earlier run): use it.
//   2. PostgreSQL's own tools are installed (Homebrew on macOS, the Debian and
//      Ubuntu packages, or anything on PATH): a data directory in .local/.
//   3. Docker: a postgres:17 container with the same settings as CI.
// LOCAL_DB=native or LOCAL_DB=docker skips straight to that option.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const port = 55432;
const container = "payrouta-postgres";

const listening = () =>
  new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
async function waitForPort(seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await listening()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
const ready = (how) => {
  console.log(`Isolated local PostgreSQL ready on 127.0.0.1:${port} (${how}). Fictional data only.`);
  process.exit(0);
};

// PostgreSQL's tools: a known install location, or PATH.
function findBin() {
  const candidates = [
    "/opt/homebrew/opt/postgresql@17/bin",
    "/usr/local/opt/postgresql@17/bin",
    "/usr/lib/postgresql/17/bin",
  ];
  const known = candidates.find((dir) => existsSync(path.join(dir, "pg_ctl")));
  if (known) return known;
  const which = spawnSync("sh", ["-c", "command -v pg_ctl"], { encoding: "utf8" });
  return which.status === 0 && which.stdout.trim() ? path.dirname(which.stdout.trim()) : null;
}

async function native(bin) {
  const run = (name, args, allowed = [0]) => {
    const result = spawnSync(path.join(bin, name), args, { stdio: "inherit" });
    if (!allowed.includes(result.status)) process.exit(result.status || 1);
  };
  mkdirSync(".local", { recursive: true });
  if (!existsSync(".local/postgres/PG_VERSION"))
    run("initdb", ["-D", ".local/postgres", "-A", "trust", "-U", "payrouta"]);
  run("pg_ctl", ["-D", ".local/postgres", "-l", ".local/postgres.log", "-o", `-p ${port} -h 127.0.0.1 -k ${tmpdir()}`, "start"]);
  if (!(await waitForPort(30))) {
    console.error("PostgreSQL did not start; see .local/postgres.log.");
    process.exit(1);
  }
  const check = spawnSync(
    path.join(bin, "psql"),
    ["-h", "127.0.0.1", "-p", String(port), "-U", "payrouta", "-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname='payrouta'"],
    { encoding: "utf8" },
  );
  if (check.stdout.trim() !== "1") run("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "payrouta", "payrouta"]);
  ready(`native, ${bin}`);
}

async function docker() {
  const exists = spawnSync("docker", ["container", "inspect", container], { stdio: "ignore" }).status === 0;
  const result = exists
    ? spawnSync("docker", ["start", container], { stdio: "inherit" })
    : spawnSync(
        "docker",
        ["run", "-d", "--name", container, "-p", `127.0.0.1:${port}:5432`, "-e", "POSTGRES_USER=payrouta", "-e", "POSTGRES_DB=payrouta", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"],
        { stdio: "inherit" },
      );
  if (result.status !== 0) process.exit(result.status || 1);
  // The port opens before the server accepts queries; wait for pg_isready.
  for (let i = 0; i < 60; i++) {
    if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "payrouta", "-d", "payrouta"], { stdio: "ignore" }).status === 0) ready(`Docker container ${container}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`The ${container} container did not become ready; see: docker logs ${container}`);
  process.exit(1);
}

const choice = process.env.LOCAL_DB;
if (choice === "docker") await docker();
if (choice === "native") {
  const forced = findBin();
  if (!forced) {
    console.error("LOCAL_DB=native, but PostgreSQL's tools (pg_ctl) were not found.");
    process.exit(1);
  }
  await native(forced);
}
if (await listening()) ready("already running");
// PostgreSQL refuses to run as root, which is common in containers: use Docker there.
const bin = process.getuid?.() === 0 ? null : findBin();
if (bin) await native(bin);
else if (spawnSync("docker", ["version"], { stdio: "ignore" }).status === 0) await docker();
else {
  console.error(
    `No PostgreSQL found. Install PostgreSQL 17 (macOS: brew install postgresql@17; Debian or Ubuntu: apt install postgresql-17), or Docker, then run this again. Any PostgreSQL on 127.0.0.1:${port} with user and database "payrouta" and trust auth also works.`,
  );
  process.exit(1);
}
