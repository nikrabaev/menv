import type { ConsumerDef, Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, newPlan, requireConsumer, requireSlug, requireVault } from "./util.ts";

export interface ConsumerAddInput {
  name: string;
  strategyType: "single" | "per-vault";
  baseDir: string;
  filename?: string;
  filenames?: Record<string, string>;
  secretsAsLocalOverrides?: boolean;
  example?: boolean;
}

function buildDef(registry: Registry, input: ConsumerAddInput): ConsumerDef {
  const flags = {
    ...(input.secretsAsLocalOverrides ? { secretsAsLocalOverrides: true } : {}),
    ...(input.example ? { example: true } : {}),
  };
  if (input.strategyType === "single") {
    if (input.filename === undefined) {
      throw new MenvError("VALIDATION", "single strategy needs --filename");
    }
    return { strategyType: "single", strategyConfig: { baseDir: input.baseDir, filename: input.filename, ...flags } };
  }
  if (input.filenames === undefined || Object.keys(input.filenames).length === 0) {
    throw new MenvError("VALIDATION", "per-vault strategy needs --filenames <vault>=<file>,…");
  }
  for (const vault of Object.keys(input.filenames)) requireVault(registry, vault);
  return {
    strategyType: "per-vault",
    strategyConfig: { baseDir: input.baseDir, filenames: input.filenames, ...flags },
  };
}

export function planConsumerAdd(registry: Registry, input: ConsumerAddInput): OpResult {
  requireSlug("consumer", input.name);
  if (registry.consumers[input.name] !== undefined) {
    throw new MenvError("VALIDATION", `consumer "${input.name}" already exists`);
  }
  const def = buildDef(registry, input);
  const next = cloneRegistry(registry);
  next.consumers[input.name] = def;
  const plan = newPlan();
  plan.registry.push({
    action: "set",
    path: `consumers.${input.name}`,
    summary: `add consumer "${input.name}" (${input.strategyType}, ${input.baseDir})`,
  });
  return { next, plan };
}

export interface ConsumerUpdateInput {
  name: string;
  baseDir?: string;
  filename?: string;
  filenames?: Record<string, string>;
  secretsAsLocalOverrides?: boolean;
  example?: boolean;
}

export function planConsumerUpdate(registry: Registry, input: ConsumerUpdateInput): OpResult {
  const def = requireConsumer(registry, input.name);
  if (def.strategyType === "per-vault" && input.filename !== undefined) {
    throw new MenvError("VALIDATION", `"${input.name}" is per-vault — use --filenames, not --filename`);
  }
  if (def.strategyType === "single" && input.filenames !== undefined) {
    throw new MenvError("VALIDATION", `"${input.name}" is single — use --filename, not --filenames`);
  }
  if (input.filenames !== undefined) {
    for (const vault of Object.keys(input.filenames)) requireVault(registry, vault);
  }
  const next = cloneRegistry(registry);
  const target = next.consumers[input.name] as ConsumerDef;
  const changed: string[] = [];
  if (input.baseDir !== undefined) {
    target.strategyConfig.baseDir = input.baseDir;
    changed.push("baseDir");
  }
  if (target.strategyType === "single" && input.filename !== undefined) {
    target.strategyConfig.filename = input.filename;
    changed.push("filename");
  }
  if (target.strategyType === "per-vault" && input.filenames !== undefined) {
    target.strategyConfig.filenames = { ...target.strategyConfig.filenames, ...input.filenames };
    changed.push("filenames");
  }
  if (input.secretsAsLocalOverrides !== undefined) {
    target.strategyConfig.secretsAsLocalOverrides = input.secretsAsLocalOverrides;
    changed.push("secretsAsLocalOverrides");
  }
  if (input.example !== undefined) {
    target.strategyConfig.example = input.example;
    changed.push("example");
  }
  const plan = newPlan();
  if (changed.length > 0) {
    plan.registry.push({
      action: "set",
      path: `consumers.${input.name}`,
      summary: `update consumer "${input.name}" (${changed.join(", ")})`,
    });
  }
  return { next, plan };
}

export interface ConsumerRemoveInput {
  name: string;
  // Vaults a session could be opened for; orphaned keys elsewhere become a
  // warning (Plan 3's `check` reports lingering keys), never a blocker.
  openable: Set<string>;
  // The consumer's generated paths (main + .local + .env.example), computed by
  // the caller via consumerPaths. Released (disclaimer stripped) by default, or
  // deleted with --delete-files. Marker-guarded at apply time. OPTIONAL so the
  // Plan-2 unit tests (registry cascade only) keep calling without them.
  paths?: string[];
  deleteFiles?: boolean;
}

// Registry cascade + orphan-key cleanup. Generated-file release/deletion is
// Plan 3 (no generate yet, so no files exist to manage).
export function planConsumerRemove(registry: Registry, input: ConsumerRemoveInput): OpResult {
  requireConsumer(registry, input.name);
  const next = cloneRegistry(registry);
  const plan = newPlan();
  delete next.consumers[input.name];
  plan.registry.push({
    action: "remove",
    path: `consumers.${input.name}`,
    summary: `remove consumer "${input.name}"`,
  });

  const lockedVaultsWithOrphans = new Set<string>();
  for (const [varName, def] of Object.entries(next.variables)) {
    for (const [vault, byConsumer] of Object.entries(def.vaultMapping)) {
      const entry = byConsumer[input.name];
      if (entry === undefined) continue;
      delete byConsumer[input.name];
      plan.registry.push({
        action: "remove",
        path: `variables.${varName}.vaultMapping.${vault}.${input.name}`,
        summary: `unwire "${varName}" from "${input.name}" (vault "${vault}")`,
      });
      const stillUsed = Object.values(byConsumer).some((e) => e.key === entry.key);
      if (!stillUsed) {
        if (input.openable.has(vault)) {
          plan.vaults.push({ vault, action: "remove", key: entry.key });
        } else {
          lockedVaultsWithOrphans.add(vault);
        }
      }
      if (Object.keys(byConsumer).length === 0) delete def.vaultMapping[vault];
    }
  }
  for (const vault of [...lockedVaultsWithOrphans].sort()) {
    plan.warnings.push({
      code: "ORPHANED_KEYS",
      message: `vault "${vault}" could not be opened — keys orphaned by removing "${input.name}" remain (menv check will report them)`,
    });
  }
  for (const path of input.paths ?? []) {
    plan.files.push({ action: input.deleteFiles === true ? "delete" : "release", path });
  }
  return { next, plan };
}
