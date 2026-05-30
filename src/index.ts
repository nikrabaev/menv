#!/usr/bin/env bun
import { findRepoRoot } from "./cli/root.ts";
import { runInit } from "./cli/init.ts";
import { runGenerate } from "./cli/generate.ts";
import { isMenvRepo } from "./store/load.ts";

const VERSION = "0.1.0";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const [, , cmd, ...rest] = Bun.argv;

if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const root = await findRepoRoot(process.cwd());

if (cmd === "init") {
  await runInit(root, { stamp: stamp() });
  console.log(`menv: initialized at ${root}`);
  process.exit(0);
}

if (cmd === "generate") {
  const envFlag = rest.includes("--env") ? rest[rest.indexOf("--env") + 1] : undefined;
  const files = await runGenerate(root, { env: envFlag, stamp: stamp() });
  console.log(`menv: generated ${files.length} files`);
  process.exit(0);
}

if (!(await isMenvRepo(root))) {
  console.log("menv: no menv.toml found. Run `menv init` first.");
  process.exit(1);
}
const { launchTui } = await import("./ui/app.tsx");
await launchTui(root);
