#!/usr/bin/env node
// `payrouta`: see index.ts. The saved login lives in
// $XDG_CONFIG_HOME/payrouta/config.json (~/.config/… by default), readable
// only by you.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { run, type Config } from "./index.js";

const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "payrouta");
const file = join(dir, "config.json");

const code = await run(process.argv.slice(2), {
  env: process.env,
  fetch,
  out: (t) => process.stdout.write(t + "\n"),
  err: (t) => process.stderr.write(t + "\n"),
  isTTY: !!process.stdout.isTTY,
  async readConfig() {
    try {
      return JSON.parse(await readFile(file, "utf8")) as Partial<Config>;
    } catch {
      return null;
    }
  },
  async writeConfig(config) {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(config.key ? config : { url: config.url }, null, 2) + "\n", { mode: 0o600 });
    await chmod(file, 0o600);
    return file;
  },
});
process.exitCode = code;
