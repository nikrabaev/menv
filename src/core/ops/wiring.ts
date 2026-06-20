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
  // With --key, an already-wired consumer is RE-KEYED onto that existing key
  // (rather than erroring), so it shares storage with the key's other holders.
  // A re-key can vacate the consumer's old key; if no consumer of this variable
  // still references it, it is orphaned — removed only when removeOrphans is set
  // and the vault is openable, otherwise kept with an ORPHANED_KEYS warning.
  removeOrphans?: boolean;
  openable?: Set<string>;
}

export function planWire(registry: Registry, input: WireInput): OpResult {
  requireVariable(registry, input.name);
  requireVault(registry, input.vault);
  for (const c of input.consumers) requireConsumer(registry, c);
  if (input.shared === true && input.key !== undefined) {
    throw new MenvError("VALIDATION", "--shared and --key are mutually exclusive");
  }
  const existing = registry.variables[input.name]?.vaultMapping[input.vault] ?? {};
  // Re-keying an already-wired consumer is only allowed in --key (join) mode;
  // the fresh/shared modes still demand an explicit unwire first.
  const rekeying = input.key !== undefined;
  const already = input.consumers.filter((c) => existing[c] !== undefined);
  if (!rekeying && already.length > 0) {
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
    const vacated = new Set<string>();
    for (const c of input.consumers) {
      const prev = mapping[c];
      const key = sharedKey ?? input.newKey();
      if (prev !== undefined) {
        if (prev.key === key) continue; // already on the target key — nothing to do
        vacated.add(prev.key);
        mapping[c] = { key, ...(prev.disabled === true ? { disabled: true } : {}) }; // preserve disabled
        plan.registry.push({
          action: "set",
          path: `variables.${input.name}.vaultMapping.${input.vault}.${c}.key`,
          summary: `re-key "${input.name}" → "${c}" to share key (vault "${input.vault}")`,
        });
      } else {
        mapping[c] = { key };
        plan.registry.push({
          action: "set",
          path: `variables.${input.name}.vaultMapping.${input.vault}.${c}`,
          summary: `wire "${input.name}" → "${c}" (vault "${input.vault}")`,
        });
      }
    }
    def.vaultMapping[input.vault] = mapping;
    const surviving = new Set(Object.values(mapping).map((e) => e.key));
    for (const key of [...vacated].sort()) {
      if (surviving.has(key)) continue;
      collectOrphan(plan, input.vault, key, input.name, input.removeOrphans === true, input.openable);
    }
  }
  return { next, plan };
}

// Shared orphaned-key policy: drop it only when removeOrphans is set and the
// vault can be opened; otherwise leave it and surface an ORPHANED_KEYS warning.
function collectOrphan(
  plan: OpResult["plan"],
  vault: string,
  key: string,
  name: string,
  removeOrphans: boolean,
  openable: Set<string> | undefined,
): void {
  if (!removeOrphans) {
    plan.warnings.push({
      code: "ORPHANED_KEYS",
      message: `key "${key}" for "${name}" is now unused in vault "${vault}" — left in place (use --remove-orphans to drop it)`,
    });
  } else if (openable?.has(vault) === true) {
    plan.vaults.push({ vault, action: "remove", key });
  } else {
    plan.warnings.push({
      code: "ORPHANED_KEYS",
      message: `vault "${vault}" could not be opened — orphaned key "${key}" remains (menv check will report it)`,
    });
  }
}

export interface UnwireInput {
  name: string;
  vault: string;
  consumers: string[];
  records: ValueRecord[]; // pre-collected from `vault`
  unverified: string[];
  openable: Set<string>;
  // Orphaned keys (no surviving consumer of this variable) are dropped only when
  // set and the vault is openable; otherwise kept with an ORPHANED_KEYS warning.
  removeOrphans?: boolean;
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
      collectOrphan(plan, input.vault, key, input.name, input.removeOrphans === true, input.openable);
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
