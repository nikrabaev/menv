import type { Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { ValueRecord } from "../refs.ts";
import { findDependents } from "../refs.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, NAME_RE, newPlan, requireGroup, requireVariable } from "./util.ts";

export interface VarDefineInput {
  name: string;
  groupKey?: string;
  secret?: boolean;
  description?: string;
  example?: string;
}

export function planVarDefine(registry: Registry, input: VarDefineInput): OpResult {
  if (!NAME_RE.test(input.name)) {
    throw new MenvError("VALIDATION", `invalid variable name "${input.name}" (env-var style)`);
  }
  if (registry.variables[input.name] !== undefined) {
    throw new MenvError("VALIDATION", `variable "${input.name}" already exists — use \`menv var update\``);
  }
  if (input.groupKey !== undefined) requireGroup(registry, input.groupKey);
  const next = cloneRegistry(registry);
  next.variables[input.name] = {
    ...(input.groupKey !== undefined ? { groupKey: input.groupKey } : {}),
    ...(input.secret !== undefined ? { secret: input.secret } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.example !== undefined ? { example: input.example } : {}),
    vaultMapping: {},
  };
  const plan = newPlan();
  plan.registry.push({
    action: "set",
    path: `variables.${input.name}`,
    summary: `define variable "${input.name}"`,
  });
  return { next, plan };
}

export interface VarUpdateInput {
  name: string;
  groupKey?: string;
  clearGroup?: boolean;
  secret?: boolean;
  description?: string;
  example?: string;
}

export function planVarUpdate(registry: Registry, input: VarUpdateInput): OpResult {
  requireVariable(registry, input.name);
  if (input.groupKey !== undefined) requireGroup(registry, input.groupKey);
  const next = cloneRegistry(registry);
  const def = next.variables[input.name];
  const changed: string[] = [];
  if (def !== undefined) {
    if (input.clearGroup === true) {
      def.groupKey = undefined;
      changed.push("groupKey cleared");
    } else if (input.groupKey !== undefined) {
      def.groupKey = input.groupKey;
      changed.push("groupKey");
    }
    if (input.secret !== undefined) {
      def.secret = input.secret;
      changed.push("secret");
    }
    if (input.description !== undefined) {
      def.description = input.description;
      changed.push("description");
    }
    if (input.example !== undefined) {
      def.example = input.example;
      changed.push("example");
    }
  }
  const plan = newPlan();
  if (changed.length > 0) {
    plan.registry.push({
      action: "set",
      path: `variables.${input.name}`,
      summary: `update variable "${input.name}" (${changed.join(", ")})`,
    });
  }
  return { next, plan };
}

export interface VarRemoveInput {
  name: string;
  records: ValueRecord[]; // collected from the vaults this variable is wired in
  unverified: string[]; // wired vaults that could not be opened
  openable: Set<string>;
}

export function planVarRemove(registry: Registry, input: VarRemoveInput): OpResult {
  const def = requireVariable(registry, input.name);
  const plan = newPlan();

  const dependents = findDependents(
    input.name,
    input.records.filter((r) => r.variable !== input.name),
  );
  for (const d of dependents) {
    plan.blockers.push({
      code: "DEPENDENT_REFERENCE",
      message: `"${d.variable}" references \${${input.name}} (vault "${d.vault}", consumer "${d.consumer}")`,
    });
  }
  for (const v of [...input.unverified].sort()) {
    plan.blockers.push({
      code: "UNVERIFIED_REFERENCES",
      message: `vault "${v}" could not be opened — references to \${${input.name}} there are unverified`,
    });
  }

  const lockedVaultsWithOrphans: string[] = [];
  for (const [vault, byConsumer] of Object.entries(def.vaultMapping)) {
    const keys = [...new Set(Object.values(byConsumer).map((e) => e.key))].sort();
    if (input.openable.has(vault)) {
      for (const key of keys) plan.vaults.push({ vault, action: "remove", key });
    } else {
      lockedVaultsWithOrphans.push(vault);
    }
  }
  for (const vault of lockedVaultsWithOrphans.sort()) {
    plan.warnings.push({
      code: "ORPHANED_KEYS",
      message: `vault "${vault}" could not be opened — keys for "${input.name}" remain (menv check will report them)`,
    });
  }

  const next = cloneRegistry(registry);
  delete next.variables[input.name];
  plan.registry.push({
    action: "remove",
    path: `variables.${input.name}`,
    summary: `remove variable "${input.name}"`,
  });
  return { next, plan };
}
