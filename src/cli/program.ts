import { join } from "node:path";
import { Command } from "@commander-js/extra-typings";
import pkg from "../../package.json";
import { MenvError } from "../core/errors.ts";
import { planComposeBind, planComposeUnbind } from "../core/ops/compose.ts";
import { planConsumerAdd, planConsumerRemove, planConsumerUpdate } from "../core/ops/consumer.ts";
import { planGlobalDefine, planGlobalRemove, planGlobalUpdate } from "../core/ops/global.ts";
import { planGroupAdd, planGroupRemove, planGroupUpdate } from "../core/ops/group.ts";
import { planVarDefine, planVarRemove, planVarUpdate } from "../core/ops/variable.ts";
import { planVaultAdd, planVaultRemove, planVaultUpdate } from "../core/ops/vault.ts";
import { planSetDisabled, planUnwire, planWire } from "../core/ops/wiring.ts";
import { applyFileOp } from "../generate/apply.ts";
import { consumerPaths } from "../generate/paths.ts";
import { upsertManagedBlock } from "../io/gitignore.ts";
import { loadRegistry } from "../registry/persist.ts";
import type { Registry } from "../registry/types.ts";
import { getProvider } from "../vault/registry.ts";
import { runImport } from "./importEnv.ts";
import { runInit } from "./init.ts";
import type { Io } from "./output.ts";
import { emitResult, resolveMode } from "./output.ts";
import { promptMasked } from "./prompt.ts";
import type { MutationFlags, PromptFn } from "./run.ts";
import { collectValueRecords, runMutation } from "./run.ts";
import { runGet, runSet } from "./value.ts";

export interface ProgramDeps {
  newKey: () => string;
}

// --config / --filenames pair parsing: "k=v,k2=v2". For --config, bare
// true/false become booleans (menv-local's `encryption` flag).
function parsePairs(raw: string | undefined, flag: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw === undefined || raw === "") return out;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 1) throw new MenvError("VALIDATION", `${flag} expects <key>=<value>[,…], got "${part}"`);
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function parseConfig(raw: string | undefined): Record<string, unknown> {
  const pairs = parsePairs(raw, "--config");
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(pairs)) out[k] = v === "true" ? true : v === "false" ? false : v;
  return out;
}

function parseVaultAuth(list: string[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of list ?? []) {
    const eq = pair.indexOf("=");
    if (eq < 1) throw new MenvError("VALIDATION", `--vault-auth expects <vault>=<secret>, got "${pair}"`);
    out[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return out;
}

const splitList = (s: string) => s.split(",").map((x) => x.trim()).filter((x) => x !== "");

export function buildProgram(root: string, io: Io, deps: ProgramDeps = { newKey: () => crypto.randomUUID() }): Command {
  const program = new Command()
    .name("menv")
    .description("environment variables across a monorepo — registry + pluggable vaults (v2)")
    .version(pkg.version)
    .option("-o, --output <mode>", "output mode: pretty | json")
    .option("--dry-run", "compute and print the plan without applying it")
    .option("--force", "override blockers (dependent references, unverified vaults, …)")
    // Repeatable but NOT variadic: a variadic <pairs...> placed before the
    // subcommand (its natural spot) greedily eats the command name. One value
    // per occurrence — `--vault-auth a=1 --vault-auth b=2` — cannot.
    .option(
      "--vault-auth <pair>",
      "vault auth as <vault>=<secret> (repeatable)",
      (val: string, acc: string[]) => [...acc, val],
      [] as string[],
    )
    .configureOutput({ writeOut: (s) => io.stdout(s), writeErr: (s) => io.stderr(s) });
  // exitOverride must be set BEFORE subcommands are attached: commander copies
  // _exitCallback into each child at .command() time (copyInheritedSettings), so
  // a later program.exitOverride() never reaches them — an unknown option on a
  // subcommand would call process.exit() instead of throwing a catchable error.
  program.exitOverride();

  const flags = (): MutationFlags => {
    const o = program.opts();
    return {
      dryRun: o.dryRun === true,
      force: o.force === true,
      mode: resolveMode(o.output, process.env),
      vaultAuth: parseVaultAuth(o.vaultAuth),
      env: process.env,
    };
  };
  const prompt: PromptFn | undefined =
    process.stdin.isTTY === true ? (vault) => promptMasked(`key for vault "${vault}": `) : undefined;
  const reg = () => loadRegistry(root);
  const emit = (result: unknown, pretty: string) => emitResult(io, flags().mode, result, pretty);

  // Vaults this consumer/variable touches — the session set dependency scans need.
  const vaultsWiring = (registry: Registry, predicate: (vault: string, consumer: string) => boolean): string[] => {
    const out = new Set<string>();
    for (const def of Object.values(registry.variables)) {
      for (const [vault, byConsumer] of Object.entries(def.vaultMapping)) {
        for (const consumer of Object.keys(byConsumer)) if (predicate(vault, consumer)) out.add(vault);
      }
    }
    return [...out];
  };

  program
    .command("init")
    .description("create an empty menv.json and the local vault config — no scanning")
    .option("--encrypt", "encrypt the local vault (default)", true)
    .option("--no-encrypt", "store the local vault as plaintext (git-ignored)")
    .action(async (o) => {
      const r = await runInit(root, { encrypt: o.encrypt });
      emit(r, `initialized: ${r.created.join(", ")}`);
    });

  // ── vault ──────────────────────────────────────────────────────────────
  const vault = program.command("vault").description("manage vaults (value stores = generation contexts)");
  vault
    .command("add <name>")
    .requiredOption("--type <vaultType>", "provider type (menv-local)")
    .option("--config <pairs>", "provider config as <key>=<value>[,…]")
    .action(async (name, o) => {
      getProvider(o.type); // unknown provider types fail here, listing known ones
      const registry = await reg();
      const config = parseConfig(o.config);
      const op = planVaultAdd(registry, { name, vaultType: o.type, vaultConfig: config });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
      if (!flags().dryRun && o.type === "menv-local" && config.encryption === false && typeof config.filename === "string") {
        await upsertManagedBlock(root, [config.filename]); // plaintext vault must never be committed
      }
    });
  vault
    .command("update <name>")
    .option("--config <pairs>", "provider config keys to merge")
    .option("--default", "make this the default vault")
    .action(async (name, o) => {
      const registry = await reg();
      const op = planVaultUpdate(registry, { name, config: o.config !== undefined ? parseConfig(o.config) : undefined, makeDefault: o.default });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
    });
  vault.command("remove <name>").action(async (name) => {
    const registry = await reg();
    await runMutation(root, registry, planVaultRemove(registry, { name }), flags(), io, new Map(), {}, prompt);
  });
  vault.command("list").action(async () => {
    const registry = await reg();
    const pretty = Object.entries(registry.vaults)
      .map(([n, d]) => `${n} (${d.vaultType})${registry.defaults.vault === n ? " [default]" : ""}`)
      .join("\n");
    emit({ defaults: registry.defaults, vaults: registry.vaults }, pretty || "no vaults");
  });
  vault.command("show <name>").action(async (name) => {
    const registry = await reg();
    const def = registry.vaults[name];
    if (def === undefined) throw new MenvError("NOT_FOUND", `unknown vault "${name}"`);
    emit({ name, ...def }, JSON.stringify(def, null, 2));
  });

  // ── consumer ───────────────────────────────────────────────────────────
  const consumer = program.command("consumer").description("manage consumers (recipients of generated files)");
  consumer
    .command("add <name>")
    .requiredOption("--strategy <type>", "single | per-vault")
    .requiredOption("--base-dir <dir>", "directory the files are generated into")
    .option("--filename <file>", "(single) the generated file name")
    .option("--filenames <pairs>", "(per-vault) <vault>=<file>[,…]")
    .option("--secrets-as-local-overrides", "write secret variables to <file>.local")
    .option("--example", "also emit a committed .env.example (takes effect with generate, Plan 3)")
    .option("--no-gitignore", "do not append generated paths to .gitignore (the .local companions are still added)")
    .action(async (name, o) => {
      if (o.strategy !== "single" && o.strategy !== "per-vault") {
        throw new MenvError("VALIDATION", `--strategy must be "single" or "per-vault", got "${o.strategy}"`);
      }
      const registry = await reg();
      const op = planConsumerAdd(registry, {
        name,
        strategyType: o.strategy,
        baseDir: o.baseDir,
        filename: o.filename,
        filenames: o.filenames !== undefined ? parsePairs(o.filenames, "--filenames") : undefined,
        secretsAsLocalOverrides: o.secretsAsLocalOverrides,
        example: o.example,
      });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
      if (!flags().dryRun) {
        const def = op.next.consumers[name];
        if (def !== undefined) {
          const paths = consumerPaths(def);
          const entries = o.gitignore === false ? paths.local : [...paths.main, ...paths.local];
          if (entries.length > 0) await upsertManagedBlock(root, entries);
        }
      }
    });
  consumer
    .command("update <name>")
    .option("--base-dir <dir>")
    .option("--filename <file>")
    .option("--filenames <pairs>")
    .option("--secrets-as-local-overrides")
    .option("--example")
    .option("--no-gitignore")
    .action(async (name, o) => {
      const registry = await reg();
      const op = planConsumerUpdate(registry, {
        name,
        baseDir: o.baseDir,
        filename: o.filename,
        filenames: o.filenames !== undefined ? parsePairs(o.filenames, "--filenames") : undefined,
        secretsAsLocalOverrides: o.secretsAsLocalOverrides,
        example: o.example,
      });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
      if (!flags().dryRun) {
        const def = op.next.consumers[name];
        if (def !== undefined) {
          const paths = consumerPaths(def);
          const entries = o.gitignore === false ? paths.local : [...paths.main, ...paths.local];
          if (entries.length > 0) await upsertManagedBlock(root, entries);
        }
      }
    });
  consumer
    .command("remove <name>")
    .option("--delete-files", "delete the consumer's generated files instead of releasing them")
    .action(async (name, o) => {
      const registry = await reg();
      const def = registry.consumers[name];
      const paths = def !== undefined ? (() => { const p = consumerPaths(def); return [...p.main, ...p.local, ...(p.example !== undefined ? [p.example] : [])]; })() : [];
      const wired = vaultsWiring(registry, (_v, c) => c === name);
      const scan = await collectValueRecords(root, registry, wired, flags(), prompt);
      const op = planConsumerRemove(registry, { name, openable: scan.openable, paths, deleteFiles: o.deleteFiles === true });
      await runMutation(root, registry, op, flags(), io, scan.sessions, { applyFileOp: (fop) => applyFileOp(root, fop) }, prompt);
    });
  consumer.command("list").action(async () => {
    const registry = await reg();
    const pretty = Object.entries(registry.consumers)
      .map(([n, d]) => `${n} — ${d.strategyType}, ${d.strategyConfig.baseDir}`)
      .join("\n");
    emit(registry.consumers, pretty || "no consumers");
  });
  consumer.command("show <name>").action(async (name) => {
    const registry = await reg();
    const def = registry.consumers[name];
    if (def === undefined) throw new MenvError("NOT_FOUND", `unknown consumer "${name}"`);
    emit({ name, ...def }, JSON.stringify(def, null, 2));
  });

  // ── group ──────────────────────────────────────────────────────────────
  const group = program.command("group").description("manage organizational groups");
  group
    .command("add <key>")
    .requiredOption("--title <text>")
    .action(async (key, o) => {
      const registry = await reg();
      await runMutation(root, registry, planGroupAdd(registry, { key, title: o.title }), flags(), io, new Map(), {}, prompt);
    });
  group
    .command("update <key>")
    .requiredOption("--title <text>")
    .action(async (key, o) => {
      const registry = await reg();
      await runMutation(root, registry, planGroupUpdate(registry, { key, title: o.title }), flags(), io, new Map(), {}, prompt);
    });
  group.command("remove <key>").action(async (key) => {
    const registry = await reg();
    await runMutation(root, registry, planGroupRemove(registry, { key }), flags(), io, new Map(), {}, prompt);
  });
  group.command("list").action(async () => {
    const registry = await reg();
    const pretty = Object.entries(registry.groups)
      .map(([k, g]) => `${k} — ${g.title}`)
      .join("\n");
    emit(registry.groups, pretty || "no groups");
  });

  // ── global ─────────────────────────────────────────────────────────────
  const globalCmd = program.command("global").description("manage globals (platform-provided or static names)");
  globalCmd
    .command("define <name>")
    .requiredOption("--vault <vault>")
    .option("--runtime", "the platform provides this name at run/deploy time")
    .option("--value <value>", "static value menv substitutes at generate time")
    .option("--description <text>")
    .action(async (name, o) => {
      const registry = await reg();
      if ((o.runtime === true) === (o.value !== undefined)) {
        throw new MenvError("VALIDATION", "pass exactly one of --runtime or --value");
      }
      const op = planGlobalDefine(registry, {
        name,
        vault: o.vault,
        source: o.runtime === true ? "runtime" : "static",
        value: o.value,
        description: o.description,
      });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
    });
  globalCmd
    .command("update <name>")
    .requiredOption("--vault <vault>")
    .option("--runtime", "the platform provides this name at run/deploy time")
    .option("--value <value>", "static value menv substitutes at generate time")
    .option("--description <text>")
    .action(async (name, o) => {
      const registry = await reg();
      if ((o.runtime === true) === (o.value !== undefined)) {
        throw new MenvError("VALIDATION", "pass exactly one of --runtime or --value");
      }
      const op = planGlobalUpdate(registry, {
        name,
        vault: o.vault,
        source: o.runtime === true ? "runtime" : "static",
        value: o.value,
        description: o.description,
      });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
    });
  globalCmd
    .command("remove <name>")
    .option("--vault <vault>", "remove only this vault's entry")
    .action(async (name, o) => {
      const registry = await reg();
      const affected = o.vault !== undefined ? [o.vault] : Object.keys(registry.globals[name]?.values ?? {});
      const scan = await collectValueRecords(root, registry, affected, flags(), prompt);
      const op = planGlobalRemove(registry, { name, vault: o.vault, records: scan.records, unverified: scan.unverified });
      await runMutation(root, registry, op, flags(), io, scan.sessions, {}, prompt);
    });
  globalCmd.command("list").action(async () => {
    const registry = await reg();
    const pretty = Object.entries(registry.globals)
      .map(([n, g]) =>
        `${n} — ${Object.entries(g.values)
          .map(([v, d]) => `${v}: ${d.source}`)
          .join(", ")}`,
      )
      .join("\n");
    emit(registry.globals, pretty || "no globals");
  });

  // ── compose ────────────────────────────────────────────────────────────
  const compose = program.command("compose").description("manage bound docker-compose files");
  compose.command("bind <file>").action(async (file) => {
    if (!(await Bun.file(join(root, file)).exists())) {
      throw new MenvError("NOT_FOUND", `no such file: ${file}`);
    }
    const registry = await reg();
    await runMutation(root, registry, planComposeBind(registry, { file }), flags(), io, new Map(), {}, prompt);
  });
  compose.command("unbind <file>").action(async (file) => {
    const registry = await reg();
    await runMutation(root, registry, planComposeUnbind(registry, { file }), flags(), io, new Map(), {}, prompt);
  });
  compose.command("list").action(async () => {
    const registry = await reg();
    emit(registry.compose, registry.compose.files.join("\n") || "no compose files bound");
  });

  // ── var ────────────────────────────────────────────────────────────────
  const varCmd = program.command("var").description("manage variable definitions");
  varCmd
    .command("define <name>")
    .option("--group <key>")
    .option("--secret")
    .option("--description <text>")
    .option("--example <text>")
    .action(async (name, o) => {
      const registry = await reg();
      const op = planVarDefine(registry, {
        name,
        groupKey: o.group,
        secret: o.secret,
        description: o.description,
        example: o.example,
      });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
    });
  varCmd
    .command("update <name>")
    .option("--group <key>", 'new group ("" clears it)')
    .option("--secret")
    .option("--no-secret")
    .option("--description <text>")
    .option("--example <text>")
    .action(async (name, o) => {
      const registry = await reg();
      const op = planVarUpdate(registry, {
        name,
        groupKey: o.group === "" ? undefined : o.group,
        clearGroup: o.group === "",
        secret: o.secret,
        description: o.description,
        example: o.example,
      });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
    });
  varCmd
    .command("remove <name>")
    .action(async (name) => {
      const registry = await reg();
      const wired = Object.keys(registry.variables[name]?.vaultMapping ?? {});
      const scan = await collectValueRecords(root, registry, wired, flags(), prompt);
      const op = planVarRemove(registry, { name, records: scan.records, unverified: scan.unverified, openable: scan.openable });
      await runMutation(root, registry, op, flags(), io, scan.sessions, {}, prompt);
    });
  varCmd
    .command("list")
    .option("--vault <vault>")
    .option("--consumer <consumer>")
    .option("--group <key>")
    .action(async (o) => {
      const registry = await reg();
      const entries = Object.entries(registry.variables).filter(([, def]) => {
        if (o.group !== undefined && def.groupKey !== o.group) return false;
        if (o.vault !== undefined && def.vaultMapping[o.vault] === undefined) return false;
        if (o.consumer !== undefined && !Object.values(def.vaultMapping).some((m) => m[o.consumer!] !== undefined)) return false;
        return true;
      });
      const pretty = entries
        .map(([n, def]) => {
          const wiring = Object.entries(def.vaultMapping)
            .map(([v, m]) => `${v}: ${Object.keys(m).sort().join(",")}`)
            .join(" · ");
          return `${n}${def.groupKey !== undefined ? ` [${def.groupKey}]` : ""}${def.secret === true ? " secret" : ""} — ${wiring || "unwired"}`;
        })
        .join("\n");
      emit(Object.fromEntries(entries), pretty || "no variables");
    });
  varCmd.command("show <name>").action(async (name) => {
    const registry = await reg();
    const def = registry.variables[name];
    if (def === undefined) throw new MenvError("NOT_FOUND", `unknown variable "${name}"`);
    emit({ name, ...def }, JSON.stringify(def, null, 2));
  });

  // ── wiring + values (top-level verbs) ──────────────────────────────────
  program
    .command("wire <name>")
    .requiredOption("--vault <vault>")
    .requiredOption("--consumers <list>", "comma-separated consumer names")
    .option("--shared", "one shared key for all listed consumers")
    .option("--key <key>", "use this existing vault key instead of allocating")
    .action(async (name, o) => {
      const registry = await reg();
      const op = planWire(registry, {
        name,
        vault: o.vault,
        consumers: splitList(o.consumers),
        shared: o.shared,
        key: o.key,
        newKey: deps.newKey,
      });
      await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
    });
  program
    .command("unwire <name>")
    .requiredOption("--vault <vault>")
    .requiredOption("--consumers <list>")
    .action(async (name, o) => {
      const registry = await reg();
      const scan = await collectValueRecords(root, registry, [o.vault], flags(), prompt);
      const op = planUnwire(registry, {
        name,
        vault: o.vault,
        consumers: splitList(o.consumers),
        records: scan.records,
        unverified: scan.unverified,
        openable: scan.openable,
      });
      await runMutation(root, registry, op, flags(), io, scan.sessions, {}, prompt);
    });
  for (const [verb, disabled] of [["enable", false], ["disable", true]] as const) {
    program
      .command(`${verb} <name>`)
      .requiredOption("--vault <vault>")
      .requiredOption("--consumer <consumer>")
      .action(async (name, o) => {
        const registry = await reg();
        const op = planSetDisabled(registry, { name, vault: o.vault, consumer: o.consumer, disabled });
        await runMutation(root, registry, op, flags(), io, new Map(), {}, prompt);
      });
  }
  program
    .command("set <name> [value]")
    .description("set a value — from the arg, piped stdin, or a masked TTY prompt")
    .option("--vault <vault>", "target vault (default: defaults.vault)")
    .option("--consumer <consumer>", "needed only when keys differ per consumer")
    .action(async (name, value, o) => {
      const registry = await reg();
      await runSet(root, registry, { name, vault: o.vault, consumer: o.consumer, valueArg: value }, flags(), io, undefined, prompt);
    });
  program
    .command("get <name>")
    .description("print the raw value (secrets included) — pipeable")
    .option("--vault <vault>")
    .option("--consumer <consumer>")
    .action(async (name, o) => {
      const registry = await reg();
      await runGet(root, registry, { name, vault: o.vault, consumer: o.consumer }, flags(), io, prompt);
    });
  program
    .command("import <file>")
    .description("explicitly ingest an existing dotenv file: define + wire + set")
    .requiredOption("--consumer <consumer>")
    .requiredOption("--vault <vault>")
    .action(async (file, o) => {
      const registry = await reg();
      await runImport(root, registry, { file, consumer: o.consumer, vault: o.vault }, flags(), io, deps.newKey, prompt);
    });

  return program;
}
