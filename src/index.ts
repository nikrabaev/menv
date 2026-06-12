#!/usr/bin/env bun
import { runAutoGroup } from "./cli/autoGroup.ts";
import { runBackup } from "./cli/backup.ts";
import { readValue } from "./cli/context.ts";
import { runDefine } from "./cli/define.ts";
import { runGenerate } from "./cli/generate.ts";
import { runGet } from "./cli/get.ts";
import { HELP_TEXT } from "./cli/help.ts";
import { runInit } from "./cli/init.ts";
import { runList } from "./cli/list.ts";
import { runMode } from "./cli/mode.ts";
import { runRestore } from "./cli/restore.ts";
import { runRm } from "./cli/rm.ts";
import { findRepoRoot } from "./cli/root.ts";
import { runSet } from "./cli/set.ts";
import { SKILL_REL_PATH } from "./cli/skill.ts";
import { runUnwire, runWire } from "./cli/wire.ts";
import type { KeyBackendKind } from "./core/types.ts";
import type { PassphraseProvider } from "./crypto/identity.ts";
import { backupKey } from "./io/backup.ts";
import { isMenvRepo } from "./store/load.ts";

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

// Minimal parser for the variable commands. `valueFlags` are `--flag value`
// pairs; any other `--flag`/`-x` is a boolean; everything else is positional.
function parseArgs(valueFlags: string[]): {
  positionals: string[];
  flags: Record<string, string>;
  bools: Set<string>;
} {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!;
    if (t.startsWith("--")) {
      const key = t.slice(2);
      if (valueFlags.includes(key)) flags[key] = rest[++i] ?? "";
      else bools.add(key);
    } else if (t.startsWith("-") && t.length > 1) {
      bools.add(t.slice(1));
    } else {
      positionals.push(t);
    }
  }
  return { positionals, flags, bools };
}

const splitScopes = (raw: string[]): string[] =>
  raw.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);

try {
  if (cmd === "init") {
    const backendRaw = flagValue("--backend");
    const VALID: KeyBackendKind[] = ["keychain", "1password", "password"];
    if (backendRaw && !VALID.includes(backendRaw as KeyBackendKind)) {
      console.error(`menv: unknown --backend "${backendRaw}" (use: ${VALID.join(", ")})`);
      process.exit(1);
    }
    const kind = backendRaw as KeyBackendKind | undefined;
    const vault = flagValue("--vault");
    // Optional default-environment name for single-mode consumers (defaults to
    // "dev"). Reject a present-but-empty flag rather than silently falling back.
    const defaultEnv = flagValue("--default-env");
    if (rest.includes("--default-env") && !defaultEnv?.trim()) {
      console.error("menv: --default-env requires a non-empty name");
      process.exit(1);
    }
    // Tri-state: an explicit flag wins; otherwise a TTY prompts and headless skips.
    const withSkill = rest.includes("--with-skill") ? true : rest.includes("--no-skill") ? false : undefined;

    // Lazy-load the Ink prompts only when we can actually prompt, keeping Ink out
    // of non-interactive runs. With no TTY, runInit defaults to keychain (or uses
    // --backend) and the password backend reads MENV_PASSPHRASE.
    let promptKind: (() => Promise<KeyBackendKind>) | undefined;
    let pass: PassphraseProvider | undefined;
    let promptSkill: (() => Promise<boolean>) | undefined;
    if (process.stdout.isTTY) {
      const ui = await import("./ui/initPrompts.tsx");
      promptKind = ui.promptBackendKind;
      pass = ui.interactivePassphraseProvider();
      if (withSkill === undefined) promptSkill = ui.promptScaffoldSkill;
    }

    const result = await runInit(root, { kind, vault, defaultEnv, stamp: stamp(), promptKind, pass, withSkill, promptSkill });
    console.log(`menv: initialized at ${root}`);
    if (result.skill === "written") console.log(`menv: scaffolded the menv-usage agent skill at ${SKILL_REL_PATH}`);
    else if (result.skill === "exists") console.log(`menv: ${SKILL_REL_PATH} already exists — left unchanged`);
    process.exit(0);
  } else if (cmd === "generate") {
    const envFlag = rest.includes("--env") ? rest[rest.indexOf("--env") + 1] : undefined;
    const files = await runGenerate(root, { env: envFlag, stamp: stamp() });
    console.log(`menv: generated ${files.length} files`);
    process.exit(0);
  } else if (cmd === "backup") {
    const { rel } = await runBackup(root, { key: backupKey(new Date()) });
    // The exact wording is part of the command's contract, so it intentionally
    // omits the `menv:` prefix the other commands use.
    console.log(`Backup saved in ${rel}`);
    process.exit(0);
  } else if (cmd === "restore") {
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
    // Each branch exits; an if/else chain (rather than a switch whose cases all
    // end in the never-returning process.exit) keeps the control flow explicit.
    if (result.kind === "not-found") {
      const have = result.available?.length ? ` (have: ${result.available.join(", ")})` : "";
      console.error(`menv: backup "${positional}" not found${have}`);
      process.exit(1);
    } else if (result.kind === "no-backups") {
      console.log("menv: no backups found");
      process.exit(0);
    } else if (result.kind === "cancelled") {
      console.log("menv: restore cancelled");
      process.exit(0);
    } else {
      console.log(`menv: restored ${result.restored?.length ?? 0} files (${result.skipped?.length ?? 0} skipped)`);
      process.exit(0);
    }
  } else if (cmd === "define") {
    const { positionals, flags, bools } = parseArgs(["description", "example", "group", "scope"]);
    const name = positionals[0];
    if (!name) throw new Error("menv: define requires a variable name");
    const secret = bools.has("no-secret") ? false : bools.has("secret") ? true : undefined;
    await runDefine(root, name, {
      secret,
      description: "description" in flags ? flags.description : undefined,
      example: "example" in flags ? flags.example : undefined,
      group: "group" in flags ? flags.group : undefined,
      scope: "scope" in flags ? splitScopes([flags.scope!]) : undefined,
      local: bools.has("local"),
      stamp: stamp(),
    });
    console.log(`menv: defined ${name}`);
    process.exit(0);
  } else if (cmd === "set") {
    const { positionals, flags, bools } = parseArgs(["env", "scope"]);
    const name = positionals[0];
    if (!name) throw new Error("menv: set requires a variable name");
    const value = await readValue(positionals[1], `Value for ${name}:`);
    await runSet(root, name, { env: flags.env, scope: flags.scope, local: bools.has("local") || undefined, value, stamp: stamp() });
    console.log(`menv: set ${name}`);
    process.exit(0);
  } else if (cmd === "get") {
    const { positionals, flags, bools } = parseArgs(["env", "scope"]);
    const name = positionals[0];
    if (!name) throw new Error("menv: get requires a variable name");
    const value = await runGet(root, name, { env: flags.env, scope: flags.scope, local: bools.has("local") || undefined });
    // Raw, no trailing newline, so `$(menv get X)` and pipes stay clean.
    process.stdout.write(value);
    process.exit(0);
  } else if (cmd === "list") {
    const { flags, bools } = parseArgs(["env", "scope", "group"]);
    const out = await runList(root, {
      env: flags.env,
      scope: "scope" in flags ? flags.scope : undefined,
      group: "group" in flags ? flags.group : undefined,
      local: bools.has("local") || undefined,
      json: bools.has("json"),
    });
    console.log(out);
    process.exit(0);
  } else if (cmd === "wire" || cmd === "unwire") {
    // "env" stays a value flag only so a stray `--env <env>` is swallowed as a
    // pair instead of leaking <env> into the scope positionals.
    const { positionals, bools } = parseArgs(["env"]);
    const name = positionals[0];
    if (!name) throw new Error(`menv: ${cmd} requires a variable name`);
    const scopes = splitScopes(positionals.slice(1));
    if (scopes.length === 0) throw new Error(`menv: ${cmd} requires at least one scope (e.g. an app name or "root")`);
    await (cmd === "wire" ? runWire : runUnwire)(root, name, scopes, { local: bools.has("local") || undefined, stamp: stamp() });
    console.log(`menv: ${cmd}d ${name} ${cmd === "wire" ? "to" : "from"} ${scopes.join(", ")}`);
    process.exit(0);
  } else if (cmd === "mode") {
    const { positionals } = parseArgs(["env"]);
    const consumer = positionals[0];
    const mode = positionals[1];
    if (!consumer) throw new Error("menv: mode requires a consumer (app name or id, or \"root\")");
    if (mode !== "single" && mode !== "perenv") {
      throw new Error(`menv: mode requires "single" or "perenv" (got ${mode ? `"${mode}"` : "nothing"})`);
    }
    await runMode(root, consumer, mode, { stamp: stamp() });
    console.log(`menv: set ${consumer} to ${mode}`);
    process.exit(0);
  } else if (cmd === "rm") {
    const { positionals, flags, bools } = parseArgs(["env", "scope"]);
    const name = positionals[0];
    if (!name) throw new Error("menv: rm requires a variable name");
    await runRm(root, name, { scope: flags.scope, local: bools.has("local") || undefined, stamp: stamp() });
    console.log(`menv: removed ${name}`);
    process.exit(0);
  } else if (cmd === "auto-group") {
    const { bools } = parseArgs(["env"]);
    const result = await runAutoGroup(root, {
      overwrite: bools.has("force") || bools.has("overwrite"),
      stamp: stamp(),
    });
    if (result.grouped === 0) {
      console.log("menv: nothing to auto-group (need 2+ variables sharing a name prefix)");
    } else {
      const n = result.grouped;
      const g = result.groups.length;
      console.log(
        `menv: grouped ${n} variable${n === 1 ? "" : "s"} into ${g} group${g === 1 ? "" : "s"} (${result.groups.join(", ")})`,
      );
    }
    process.exit(0);
  } else {
    if (!(await isMenvRepo(root))) {
      console.log("menv: no menv.toml found. Run `menv init` first.");
      process.exit(1);
    }
    const { launchTui } = await import("./ui/app.tsx");
    await launchTui(root);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
