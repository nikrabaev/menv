import type { GlobalValueDef, Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { ValueRecord } from "../refs.ts";
import { findDependents } from "../refs.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, NAME_RE, newPlan, requireVault } from "./util.ts";

export interface GlobalWriteInput {
  name: string;
  vault: string;
  source: "runtime" | "static";
  value?: string;
  description?: string;
}

function buildValueDef(input: GlobalWriteInput): GlobalValueDef {
  if (input.source === "static") {
    if (input.value === undefined) throw new MenvError("VALIDATION", "static global needs --value");
    return { source: "static", value: input.value };
  }
  return { source: "runtime" };
}

export function planGlobalDefine(registry: Registry, input: GlobalWriteInput): OpResult {
  if (!NAME_RE.test(input.name)) {
    throw new MenvError("VALIDATION", `invalid global name "${input.name}" (env-var style)`);
  }
  requireVault(registry, input.vault);
  if (registry.globals[input.name]?.values[input.vault] !== undefined) {
    throw new MenvError(
      "VALIDATION",
      `global "${input.name}" is already defined for vault "${input.vault}" — use \`menv global update\``,
    );
  }
  const valueDef = buildValueDef(input);
  const next = cloneRegistry(registry);
  const existing = next.globals[input.name];
  if (existing === undefined) {
    next.globals[input.name] = {
      ...(input.description !== undefined ? { description: input.description } : {}),
      values: { [input.vault]: valueDef },
    };
  } else {
    existing.values[input.vault] = valueDef;
    if (input.description !== undefined) existing.description = input.description;
  }
  const plan = newPlan();
  plan.registry.push({
    action: "set",
    path: `globals.${input.name}.values.${input.vault}`,
    summary: `define global "${input.name}" for vault "${input.vault}" (${input.source})`,
  });
  return { next, plan };
}

export function planGlobalUpdate(registry: Registry, input: GlobalWriteInput): OpResult {
  requireVault(registry, input.vault);
  if (registry.globals[input.name]?.values[input.vault] === undefined) {
    throw new MenvError(
      "NOT_FOUND",
      `global "${input.name}" is not defined for vault "${input.vault}" — use \`menv global define\``,
    );
  }
  const valueDef = buildValueDef(input);
  const next = cloneRegistry(registry);
  const def = next.globals[input.name];
  if (def !== undefined) {
    def.values[input.vault] = valueDef;
    if (input.description !== undefined) def.description = input.description;
  }
  const plan = newPlan();
  plan.registry.push({
    action: "set",
    path: `globals.${input.name}.values.${input.vault}`,
    summary: `update global "${input.name}" for vault "${input.vault}" (${input.source})`,
  });
  return { next, plan };
}

export interface GlobalRemoveInput {
  name: string;
  vault?: string; // omitted = remove the global from every vault
  records: ValueRecord[]; // pre-collected from the affected vaults
  unverified: string[]; // affected vaults that could not be opened
}

export function planGlobalRemove(registry: Registry, input: GlobalRemoveInput): OpResult {
  const def = registry.globals[input.name];
  if (def === undefined) throw new MenvError("NOT_FOUND", `unknown global "${input.name}"`);
  if (input.vault !== undefined && def.values[input.vault] === undefined) {
    throw new MenvError("NOT_FOUND", `global "${input.name}" is not defined for vault "${input.vault}"`);
  }
  const affected = input.vault !== undefined ? [input.vault] : Object.keys(def.values);

  const plan = newPlan();
  // A wired variable with the same name shadows the global in that scope, so
  // references there don't resolve to this global and removal can't break them.
  const shadowed = (r: ValueRecord) =>
    registry.variables[input.name]?.vaultMapping[r.vault]?.[r.consumer] !== undefined;
  const dependents = findDependents(
    input.name,
    input.records.filter((r) => affected.includes(r.vault) && !shadowed(r)),
  );
  for (const d of dependents) {
    plan.blockers.push({
      code: "DEPENDENT_REFERENCE",
      message: `"${d.variable}" references \${${input.name}} (vault "${d.vault}", consumer "${d.consumer}")`,
    });
  }
  for (const v of input.unverified.filter((u) => affected.includes(u)).sort()) {
    plan.blockers.push({
      code: "UNVERIFIED_REFERENCES",
      message: `vault "${v}" could not be opened — references to \${${input.name}} there are unverified`,
    });
  }

  const next = cloneRegistry(registry);
  const target = next.globals[input.name];
  if (target !== undefined) {
    for (const v of affected) {
      delete target.values[v];
      plan.registry.push({
        action: "remove",
        path: `globals.${input.name}.values.${v}`,
        summary: `remove global "${input.name}" from vault "${v}"`,
      });
    }
    if (Object.keys(target.values).length === 0) delete next.globals[input.name];
  }
  return { next, plan };
}
