import type { Registry } from "../../registry/types.ts";
import { MenvError } from "../errors.ts";
import type { ValueRecord } from "../refs.ts";
import { findDependents } from "../refs.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, newPlan, requireConsumer, requireVariable, requireVault } from "./util.ts";

export interface WireInput {
  name: string;
  vault: string;
  consumers: string[];
  shared?: boolean;
  key?: string;
  newKey: () => string; // injected (crypto.randomUUID in production) for deterministic tests
}

export function planWire(registry: Registry, input: WireInput): OpResult {
  requireVariable(registry, input.name);
  requireVault(registry, input.vault);
  for (const c of input.consumers) requireConsumer(registry, c);
  if (input.shared === true && input.key !== undefined) {
    throw new MenvError("VALIDATION", "--shared and --key are mutually exclusive");
  }
  const existing = registry.variables[input.name]?.vaultMapping[input.vault] ?? {};
  const already = input.consumers.filter((c) => existing[c] !== undefined);
  if (already.length > 0) {
    throw new MenvError(
      "VALIDATION",
      `"${input.name}" is already wired to ${already.join(", ")} in vault "${input.vault}" (unwire first)`,
    );
  }
  const sharedKey = input.key ?? (input.shared === true ? input.newKey() : undefined);
  const next = cloneRegistry(registry);
  const def = next.variables[input.name];
  const plan = newPlan();
  if (def !== undefined) {
    const mapping = def.vaultMapping[input.vault] ?? {};
    for (const c of input.consumers) {
      mapping[c] = { key: sharedKey ?? input.newKey() };
      plan.registry.push({
        action: "set",
        path: `variables.${input.name}.vaultMapping.${input.vault}.${c}`,
        summary: `wire "${input.name}" → "${c}" (vault "${input.vault}")`,
      });
    }
    def.vaultMapping[input.vault] = mapping;
  }
  return { next, plan };
}

export interface UnwireInput {
  name: string;
  vault: string;
  consumers: string[];
  records: ValueRecord[]; // pre-collected from `vault`
  unverified: string[];
  openable: Set<string>;
}

export function planUnwire(registry: Registry, input: UnwireInput): OpResult {
  const def = requireVariable(registry, input.name);
  requireVault(registry, input.vault);
  const mapping = def.vaultMapping[input.vault] ?? {};
  const missing = input.consumers.filter((c) => mapping[c] === undefined);
  if (missing.length > 0) {
    throw new MenvError(
      "VALIDATION",
      `"${input.name}" is not wired to ${missing.join(", ")} in vault "${input.vault}"`,
    );
  }

  const plan = newPlan();
  const dependents = findDependents(
    input.name,
    input.records.filter(
      (r) => r.vault === input.vault && input.consumers.includes(r.consumer) && r.variable !== input.name,
    ),
  );
  for (const d of dependents) {
    plan.blockers.push({
      code: "DEPENDENT_REFERENCE",
      message: `"${d.variable}" references \${${input.name}} (vault "${d.vault}", consumer "${d.consumer}")`,
    });
  }
  for (const v of input.unverified.filter((u) => u === input.vault)) {
    plan.blockers.push({
      code: "UNVERIFIED_REFERENCES",
      message: `vault "${v}" could not be opened — references to \${${input.name}} there are unverified`,
    });
  }

  const next = cloneRegistry(registry);
  const nextDef = next.variables[input.name];
  if (nextDef !== undefined) {
    const nextMapping = nextDef.vaultMapping[input.vault] ?? {};
    const removedKeys = new Set<string>();
    for (const c of input.consumers) {
      const entry = nextMapping[c];
      if (entry !== undefined) removedKeys.add(entry.key);
      delete nextMapping[c];
      plan.registry.push({
        action: "remove",
        path: `variables.${input.name}.vaultMapping.${input.vault}.${c}`,
        summary: `unwire "${input.name}" from "${c}" (vault "${input.vault}")`,
      });
    }
    const survivingKeys = new Set(Object.values(nextMapping).map((e) => e.key));
    for (const key of [...removedKeys].sort()) {
      if (survivingKeys.has(key)) continue;
      if (input.openable.has(input.vault)) {
        plan.vaults.push({ vault: input.vault, action: "remove", key });
      } else {
        plan.warnings.push({
          code: "ORPHANED_KEYS",
          message: `vault "${input.vault}" could not be opened — orphaned key remains (menv check will report it)`,
        });
      }
    }
    if (Object.keys(nextMapping).length === 0) delete nextDef.vaultMapping[input.vault];
  }
  return { next, plan };
}

export interface SetDisabledInput {
  name: string;
  vault: string;
  consumer: string;
  disabled: boolean;
}

export function planSetDisabled(registry: Registry, input: SetDisabledInput): OpResult {
  const def = requireVariable(registry, input.name);
  requireVault(registry, input.vault);
  requireConsumer(registry, input.consumer);
  const entry = def.vaultMapping[input.vault]?.[input.consumer];
  if (entry === undefined) {
    throw new MenvError(
      "NOT_FOUND",
      `"${input.name}" is not wired to "${input.consumer}" in vault "${input.vault}"`,
    );
  }
  const plan = newPlan();
  const current = entry.disabled === true;
  if (current === input.disabled) {
    plan.warnings.push({
      code: "NOOP",
      message: `"${input.name}" is already ${input.disabled ? "disabled" : "enabled"} for "${input.consumer}" in vault "${input.vault}"`,
    });
    return { next: registry, plan };
  }
  const next = cloneRegistry(registry);
  const nextEntry = next.variables[input.name]?.vaultMapping[input.vault]?.[input.consumer];
  if (nextEntry !== undefined) {
    if (input.disabled) nextEntry.disabled = true;
    else delete nextEntry.disabled;
  }
  plan.registry.push({
    action: "set",
    path: `variables.${input.name}.vaultMapping.${input.vault}.${input.consumer}.disabled`,
    summary: `${input.disabled ? "disable" : "enable"} "${input.name}" for "${input.consumer}" (vault "${input.vault}")`,
  });
  return { next, plan };
}
