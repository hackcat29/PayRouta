// PM2 processes for a server deployment. They run from the active release
// (/opt/payrouta/current, a symlink switched atomically by the deploy) and
// read the single shared environment file.
const root = process.env.PAYROUTA_ROOT || "/opt/payrouta";
const envFile = `${root}/.env`;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- PM2 loads this as CommonJS
const fs = require("node:fs");
let env = "";
try {
  env = fs.readFileSync(envFile, "utf8");
} catch {}
module.exports = {
  apps: [
    {
      name: "payrouta-web",
      cwd: `${root}/current`,
      script: ".next/standalone/server.js",
      interpreter: "node",
      interpreter_args: `--env-file=${envFile}`,
      env: { NODE_ENV: "production", PORT: "3051", HOSTNAME: "127.0.0.1" },
      max_memory_restart: "1G",
      kill_timeout: 10000,
    },
    {
      // Payments, webhooks, partner provisioning, screening, scans and
      // reconciliation all run here; the site does not work without it.
      name: "payrouta-worker",
      cwd: `${root}/current`,
      script: "scripts/worker.ts",
      interpreter: "node",
      interpreter_args: `--env-file=${envFile} --import tsx`,
      env: { NODE_ENV: "production" },
      max_memory_restart: "512M",
      kill_timeout: 30000,
    },
    // PayRouta Checkout on NEAR AI Agent Market: answers hires with an
    // integration plan. Runs once the deploy has stored its API token.
    ...(/^AGENT_MARKET_TOKEN_REF=./m.test(env)
      ? [
          {
            name: "payrouta-agent-market",
            cwd: `${root}/current`,
            script: "scripts/agent-market.ts",
            args: "work",
            interpreter: "node",
            interpreter_args: `--env-file=${envFile} --import tsx`,
            env: { NODE_ENV: "production" },
            max_memory_restart: "256M",
            restart_delay: 30000,
          },
        ]
      : []),
  ],
};
