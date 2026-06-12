import type { DotenvEntry } from "../../io/dotenv.ts";
import type { Registry } from "../../registry/types.ts";
import type { OpResult } from "./util.ts";
import { cloneRegistry, NAME_RE, newPlan, requireConsumer, requireVault } from "./util.ts";

// Name-based secret heuristic, reported per variable and correctable later
// via `menv var update --no-secret`.
const SECRET_HINT_RE = /(SECRET|TOKEN|PASSWORD|PASS|KEY|DSN|PRIVATE)/;

export interface ImportInput {
  entries: DotenvEntry[];
  consumer: string;
  vault: string;
  // key → stored value, prefetched by the CLI for already-wired entries.
  currentValues: Map<string, string>;
  force: boolean;
  newKey: () => string;
}

export interface ImportReport {
  defined: string[];
  wired: string[];
  updated: string[];
  skipped: { key: string; reason: string }[];
}

export function planImportEntries(
  registry: Registry,
  input: ImportInput,
): { result: OpResult; report: ImportReport } {
  requireConsumer(registry, input.consumer);
  requireVault(registry, input.vault);
  const next = cloneRegistry(registry);
  const plan = newPlan();
  const report: ImportReport = { defined: [], wired: [], updated: [], skipped: [] };

  for (const { key: name, value } of input.entries) {
    if (!NAME_RE.test(name)) {
      report.skipped.push({ key: name, reason: "invalid variable name" });
      continue;
    }
    let def = next.variables[name];
    if (def === undefined) {
      def = { ...(SECRET_HINT_RE.test(name) ? { secret: true } : {}), vaultMapping: {} };
      next.variables[name] = def;
      plan.registry.push({ action: "set", path: `variables.${name}`, summary: `define variable "${name}"` });
      report.defined.push(name);
    }
    const mapping = def.vaultMapping[input.vault] ?? {};
    def.vaultMapping[input.vault] = mapping;
    const entry = mapping[input.consumer];
    if (entry === undefined) {
      const key = input.newKey();
      mapping[input.consumer] = { key };
      plan.registry.push({
        action: "set",
        path: `variables.${name}.vaultMapping.${input.vault}.${input.consumer}`,
        summary: `wire "${name}" → "${input.consumer}" (vault "${input.vault}")`,
      });
      plan.vaults.push({ vault: input.vault, action: "set", key, value });
      report.wired.push(name);
      continue;
    }
    const sharedWith = Object.entries(mapping)
      .filter(([c, e]) => c !== input.consumer && e.key === entry.key)
      .map(([c]) => c);
    const current = input.currentValues.get(entry.key);
    if (sharedWith.length > 0 && current !== undefined && current !== value) {
      // Forced outcome: split this consumer onto its own key (spec: import).
      const key = input.newKey();
      mapping[input.consumer] = { ...entry, key };
      plan.registry.push({
        action: "set",
        path: `variables.${name}.vaultMapping.${input.vault}.${input.consumer}`,
        summary: `split "${name}" onto its own key for "${input.consumer}" (vault "${input.vault}")`,
      });
      plan.vaults.push({ vault: input.vault, action: "set", key, value });
      plan.blockers.push({
        code: "SHARED_KEY_CONFLICT",
        message: `"${name}": incoming value differs from the value shared with ${sharedWith.sort().join(", ")} (vault "${input.vault}") — forcing splits "${input.consumer}" onto its own key`,
      });
      report.updated.push(name);
      continue;
    }
    plan.vaults.push({ vault: input.vault, action: "set", key: entry.key, value });
    report.updated.push(name);
  }
  return { result: { next, plan }, report };
}
