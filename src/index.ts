#!/usr/bin/env bun
import { findRepoRoot } from "./cli/root.ts";
import { runInit } from "./cli/init.ts";
import { runGenerate } from "./cli/generate.ts";
import { runBackup } from "./cli/backup.ts";
import { runRestore } from "./cli/restore.ts";
import { backupKey } from "./io/backup.ts";
import { HELP_TEXT } from "./cli/help.ts";
import { isMenvRepo } from "./store/load.ts";
import type { KeyBackendKind } from "./core/types.ts";

const VERSION = "0.1.0";

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

const [, , cmd, ...rest] = Bun.argv;

if (cmd === "--help" || cmd === "-h") {
  console.log(HELP_TEXT);
  process.exit(0);
}

if (cmd === "--version" || cmd === "-v") {
  console.log(VERSION);
  process.exit(0);
}

const root = await findRepoRoot(process.cwd());

function flagValue(flag: string): string | undefined {
  return rest.includes(flag) ? rest[rest.indexOf(flag) + 1] : undefined;
}

if (cmd === "init") {
  const backendRaw = flagValue("--backend");
  const VALID: KeyBackendKind[] = ["keychain", "1password", "password"];
  if (backendRaw && !VALID.includes(backendRaw as KeyBackendKind)) {
    console.error(`menv: unknown --backend "${backendRaw}" (use: ${VALID.join(", ")})`);
    process.exit(1);
  }
  const kind = backendRaw as KeyBackendKind | undefined;
  const vault = flagValue("--vault");

  // Lazy-load the Ink prompts only when we can actually prompt, keeping Ink out
  // of non-interactive runs. With no TTY, runInit defaults to keychain (or uses
  // --backend) and the password backend reads MENV_PASSPHRASE.
  let promptKind: (() => Promise<KeyBackendKind>) | undefined;
  let pass;
  if (process.stdout.isTTY) {
    const ui = await import("./ui/initPrompts.tsx");
    promptKind = ui.promptBackendKind;
    pass = ui.interactivePassphraseProvider();
  }

  await runInit(root, { kind, vault, stamp: stamp(), promptKind, pass });
  console.log(`menv: initialized at ${root}`);
  process.exit(0);
}

if (cmd === "generate") {
  const envFlag = rest.includes("--env") ? rest[rest.indexOf("--env") + 1] : undefined;
  const files = await runGenerate(root, { env: envFlag, stamp: stamp() });
  console.log(`menv: generated ${files.length} files`);
  process.exit(0);
}

if (cmd === "backup") {
  const { rel } = await runBackup(root, { key: backupKey(new Date()) });
  // The exact wording is part of the command's contract, so it intentionally
  // omits the `menv:` prefix the other commands use.
  console.log(`Backup saved in ${rel}`);
  process.exit(0);
}

if (cmd === "restore") {
  const positional = rest.find((a) => !a.startsWith("-"));
  const force = rest.includes("-f") || rest.includes("--force");
  if (force && !positional) {
    console.error("menv: --force requires a backup key");
    process.exit(1);
  }
  if (!positional && !process.stdout.isTTY) {
    console.error("menv: restore needs an interactive terminal (or pass a backup key)");
    process.exit(1);
  }
  // Lazy-load Ink only for the interactive flow, mirroring the TUI import.
  const { inkPrompts } = await import("./ui/restore.tsx");
  const result = await runRestore(root, { key: positional, force }, inkPrompts);
  switch (result.kind) {
    case "not-found": {
      const have = result.available?.length ? ` (have: ${result.available.join(", ")})` : "";
      console.error(`menv: backup "${positional}" not found${have}`);
      process.exit(1);
      break;
    }
    case "no-backups":
      console.log("menv: no backups found");
      process.exit(0);
      break;
    case "cancelled":
      console.log("menv: restore cancelled");
      process.exit(0);
      break;
    case "done":
      console.log(`menv: restored ${result.restored?.length ?? 0} files (${result.skipped?.length ?? 0} skipped)`);
      process.exit(0);
      break;
  }
}

if (!(await isMenvRepo(root))) {
  console.log("menv: no menv.toml found. Run `menv init` first.");
  process.exit(1);
}
const { launchTui } = await import("./ui/app.tsx");
await launchTui(root);
